#!/usr/bin/env bash
# Sets (or resets) the web terminal's login password.
#
# The password is stored as SHA-256(salt + password), hex-encoded, next to a
# random per-install salt, in the secrets directory (outside the repo):
#
#   $SECRETS_DIR/password.salt     random salt (hex)
#   $SECRETS_DIR/password.sha256   sha256 of salt+password (hex)
#
# Changing the password also signs out every existing session. The server
# reads these files on each login, so no restart is needed.
#
#   usage: scripts/set-password.sh              # prompt for the new password
#          scripts/set-password.sh --hash TEXT  # just print SHA-256(salt + TEXT)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Same lookup order as the server: environment, then .env, then the default.
if [[ -z "${SECRETS_DIR:-}" && -f "$ROOT/.env" ]]; then
  SECRETS_DIR="$(grep -E '^SECRETS_DIR=' "$ROOT/.env" | tail -1 | cut -d= -f2- || true)"
fi
SECRETS_DIR="${SECRETS_DIR:-$HOME/.config/ssh-web-interfacer}"
SECRETS_DIR="${SECRETS_DIR/#\~/$HOME}"
SALT_FILE="$SECRETS_DIR/password.salt"
HASH_FILE="$SECRETS_DIR/password.sha256"

umask 077
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if [[ ! -s "$SALT_FILE" ]]; then
  openssl rand -hex 32 >"$SALT_FILE"
fi
SALT="$(tr -d '[:space:]' <"$SALT_FILE")"

hash() {
  printf '%s%s' "$SALT" "$1" | sha256sum | cut -d' ' -f1
}

if [[ "${1:-}" == "--hash" ]]; then
  hash "${2:?usage: $0 --hash TEXT}"
  exit 0
fi

read -rsp "New password: " PASSWORD; echo
read -rsp "Repeat password: " CONFIRM; echo

if [[ "$PASSWORD" != "$CONFIRM" ]]; then
  echo "Passwords don't match." >&2
  exit 1
fi
if (( ${#PASSWORD} < 12 )); then
  echo "Please use at least 12 characters; this password guards a shell on your server." >&2
  exit 1
fi

hash "$PASSWORD" >"$HASH_FILE"
chmod 600 "$SALT_FILE" "$HASH_FILE"
echo "Password saved to $HASH_FILE"
