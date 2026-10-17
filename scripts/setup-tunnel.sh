#!/usr/bin/env bash
# Creates a named Cloudflare Tunnel that publishes the web terminal at a
# hostname on a domain managed by your Cloudflare account. No router ports
# are opened: cloudflared dials out to Cloudflare.
#
#   usage: scripts/setup-tunnel.sh <hostname> [tunnel-name]
#   e.g.   scripts/setup-tunnel.sh terminal.example.com homelab-terminal
set -euo pipefail

HOSTNAME_FQDN="${1:?usage: $0 <hostname> [tunnel-name]}"
TUNNEL_NAME="${2:-homelab-terminal}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-8022}"
CF_DIR="$HOME/.cloudflared"

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared is not installed. On Debian/Ubuntu:"
  echo "  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null"
  echo "  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list"
  echo "  sudo apt update && sudo apt install cloudflared"
  exit 1
fi

if [[ ! -f "$CF_DIR/cert.pem" ]]; then
  echo "==> Authorising cloudflared with your Cloudflare account (opens a browser link)"
  cloudflared tunnel login
fi

if cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
  echo "==> Tunnel '$TUNNEL_NAME' already exists"
else
  echo "==> Creating tunnel '$TUNNEL_NAME'"
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID="$(cloudflared tunnel list --output json | python3 -c "import json,sys; print(next(t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL_NAME'))")"

echo "==> Routing $HOSTNAME_FQDN to the tunnel"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$HOSTNAME_FQDN"

CONFIG="$ROOT/cloudflared/config.yml"
cat >"$CONFIG" <<YAML
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json

ingress:
  - hostname: $HOSTNAME_FQDN
    service: http://127.0.0.1:$PORT
  - service: http_status:404
YAML
echo "==> Wrote $CONFIG"

cat <<MSG

Done. Next steps:
  1. Set PUBLIC_ORIGIN=https://$HOSTNAME_FQDN in .env
  2. Try it in the foreground:
       cloudflared tunnel --config "$CONFIG" run
  3. Or install it as a system service so it survives reboots:
       sudo mkdir -p /etc/cloudflared
       sudo cp "$CONFIG" /etc/cloudflared/config.yml
       sudo cp "$CF_DIR/$TUNNEL_ID.json" /etc/cloudflared/
       sudo sed -i "s#$CF_DIR#/etc/cloudflared#" /etc/cloudflared/config.yml
       sudo cloudflared service install
  4. Strongly recommended: put a Cloudflare Access policy in front of
     https://$HOSTNAME_FQDN (see README → "Lock it down with Cloudflare Access").
MSG
