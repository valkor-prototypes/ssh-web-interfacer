#!/usr/bin/env bash
# Free, account-less test deployment: starts a Cloudflare Quick Tunnel
# (random https://<words>.trycloudflare.com address) and runs the server with
# that address allowed as PUBLIC_ORIGIN. The address changes on every run.
# Ctrl-C stops both.
#
#   usage: scripts/quick-tunnel.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 || true)"
PORT="${PORT:-8022}"

command -v cloudflared >/dev/null || { echo "cloudflared is not installed (see README)." >&2; exit 1; }
[[ -f dist/index.html ]] || { echo "No build found; run: npm run build" >&2; exit 1; }
if ss -ltn 2>/dev/null | grep -qE ":$PORT\b"; then
  echo "Port $PORT is already in use (is the server or its systemd service running?). Stop it first:" >&2
  echo "  systemctl --user stop ssh-web-interfacer" >&2
  exit 1
fi

TUNNEL_LOG="$(mktemp)"
cleanup() {
  [[ -n "${TUNNEL_PID:-}" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT

echo "==> Starting quick tunnel to http://127.0.0.1:$PORT"
# --config /dev/null: ignore any named-tunnel config in ~/.cloudflared.
cloudflared tunnel --no-autoupdate --config /dev/null --url "http://127.0.0.1:$PORT" >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

URL=''
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
  [[ -n "$URL" ]] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
  sleep 0.5
done
if [[ -z "$URL" ]]; then
  echo "Could not get a tunnel address. cloudflared said:" >&2
  cat "$TUNNEL_LOG" >&2
  exit 1
fi

cat <<MSG

  Your site is live at:  $URL

  (It can take ~30 seconds before the address resolves everywhere.)
  The address changes every time this script runs, so an installed PWA
  from a previous run won't connect. Open the new link instead.

MSG

# Real environment variables override .env, so the random origin wins.
PUBLIC_ORIGIN="$URL" NODE_ENV=production node server/index.js
