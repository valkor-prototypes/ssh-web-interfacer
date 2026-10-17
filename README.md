# ssh-web-interfacer

A glass-styled, Apple-inspired web terminal for your homelab. Open a real bash shell on your home server from a phone or laptop, anywhere, **without opening a single port on your router**.

```
 Phone / laptop ──HTTPS/WSS──▶ Cloudflare edge ──(outbound tunnel)──▶ cloudflared ──▶ Node server ──SSH (private key)──▶ sshd
                                                                      └──────────── all on the home server ────────────┘
```

- **Frontend** — Vue 3 + [xterm.js](https://xtermjs.org/), frosted-glass UI, macOS-style window, extra-keys bar (Esc, Tab, Ctrl, arrows…) on touch devices.
- **Backend** — a small Node server (`server/`) that serves the built frontend, handles login, and bridges a WebSocket to an SSH shell using [`ssh2`](https://github.com/mscdex/ssh2).
- **Transport** — a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/): `cloudflared` makes an *outbound* connection to Cloudflare, so the server can stay on its reserved LAN IP.

The SSH private key **never leaves the server** and is never sent to the browser: it's read by the backend from a path (or value) in `.env`, which is git-ignored.

## Requirements

- Linux home server running `sshd`
- Node.js ≥ 20.12 (22 LTS recommended)
- A domain on a (free) Cloudflare account, for the tunnel hostname
- `cloudflared` ([install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/))

## Setup

### 1. Install and build

```bash
git clone https://github.com/valkor-prototypes/ssh-web-interfacer.git
cd ssh-web-interfacer
npm install
npm run build
```

### 2. Create a dedicated SSH key

Use a key that exists only for this app, so you can revoke it independently:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ssh-web-interfacer -C "ssh-web-interfacer"
cat ~/.ssh/ssh-web-interfacer.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/ssh-web-interfacer ~/.ssh/authorized_keys
```

Optionally restrict it to connections from the server itself by prefixing its line in `authorized_keys` with `from="127.0.0.1,::1" `.

### 3. Configure `.env`

```bash
cp .env.example .env
chmod 600 .env
npm run hash-password          # paste the printed APP_PASSWORD_HASH line into .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # → SESSION_SECRET
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub                                    # → SSH_HOST_KEY_SHA256
```

| Variable | Description |
| --- | --- |
| `HOST`, `PORT` | Where the Node server listens. Keep `HOST=127.0.0.1` — only `cloudflared` needs to reach it. Default port `8022`. |
| `PUBLIC_ORIGIN` | The public URL, e.g. `https://terminal.example.com`. WebSocket connections from any other origin are refused. |
| `APP_PASSWORD_HASH` | scrypt hash of the login password (`npm run hash-password`). |
| `SESSION_SECRET` | ≥ 32 random characters used to sign session cookies. Changing it logs everyone out. |
| `SESSION_TTL_HOURS` | How long a login lasts (default 12). |
| `SSH_HOST`, `SSH_PORT`, `SSH_USERNAME` | SSH target — normally `127.0.0.1`, `22` and your user. |
| `SSH_PRIVATE_KEY_PATH` | Path to the private key (preferred). |
| `SSH_PRIVATE_KEY_BASE64` | Alternatively, the key inline as single-line base64 (`base64 -w0 ~/.ssh/ssh-web-interfacer`). |
| `SSH_PRIVATE_KEY_PASSPHRASE` | Key passphrase, if any. |
| `SSH_HOST_KEY_SHA256` | Optional host-key pin; the connection is refused if the server's key doesn't match. |

### 4. Run the backend

```bash
npm start            # serves http://127.0.0.1:8022
```

To keep it running across reboots, install the bundled systemd user service:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/ssh-web-interfacer.service ~/.config/systemd/user/
# Edit WorkingDirectory if the repo lives elsewhere. If node isn't in /usr/bin
# (e.g. installed with nvm), put its absolute path in ExecStart.
systemctl --user daemon-reload
systemctl --user enable --now ssh-web-interfacer
sudo loginctl enable-linger "$USER"   # keep user services running while logged out
journalctl --user -u ssh-web-interfacer -f
```

### 5. Create the Cloudflare Tunnel

```bash
scripts/setup-tunnel.sh terminal.example.com
```

The script will:

1. run `cloudflared tunnel login` (once — opens a link to pick your domain),
2. create a named tunnel (`homelab-terminal` by default),
3. add a DNS record `terminal.example.com → <tunnel>.cfargotunnel.com`,
4. write `cloudflared/config.yml` pointing that hostname at `http://127.0.0.1:$PORT`.

Then make sure `PUBLIC_ORIGIN=https://terminal.example.com` is in `.env`, restart the backend, and start the tunnel:

```bash
cloudflared tunnel --config cloudflared/config.yml run           # foreground, to test
```

The script prints the commands to install it as a system service (`sudo cloudflared service install`) so it starts on boot. See `cloudflared/config.example.yml` if you prefer to write the config by hand.

Open `https://terminal.example.com`, enter your password, and you're in.

### 6. Lock it down with Cloudflare Access (strongly recommended)

This page is a shell on your server, so add a second, independent gate in front of it. In the Cloudflare dashboard → **Zero Trust → Access → Applications → Add an application → Self-hosted**:

- **Application domain:** `terminal.example.com`
- **Policy:** *Allow* → *Emails* → your email address (login via one-time PIN, Google, GitHub, …)

Unauthenticated visitors are now stopped at Cloudflare's edge and never reach your server. It's free for up to 50 users.

## Usage

- **Log in** with the password you hashed in step 3. The session is an `HttpOnly`, `Secure`, `SameSite=Strict` cookie valid for `SESSION_TTL_HOURS`.
- **Every browser tab gets its own fresh shell.** Closing the tab ends that shell, so for long-running work use `tmux` (`tmux new -A -s main` re-attaches to the same session from any device).
- **Text size:** `A−` / `A+` in the title bar (remembered per device).
- **On a phone:** the bar under the terminal provides Esc, Tab, arrows, `|`, `~`, `^C` and a sticky **ctrl** key (tap *ctrl*, then a letter → e.g. Ctrl-R). Add the page to your home screen for a full-screen app feel.
- **Disconnected?** Hit *Reconnect*. If your session expired you're sent back to the login screen.

## Development

```bash
npm run dev     # Node backend on :8022 (auto-restart) + Vite on http://localhost:5173 with hot reload
```

Vite proxies `/api` and `/ws` to the backend. In development (`NODE_ENV` not `production`) WebSocket origins from `localhost` are accepted and the session cookie isn't marked `Secure`.

```
server/          Node backend: config, auth (scrypt + signed cookies), SSH ⇄ WebSocket bridge
web/             Vue 3 frontend (Vite root)
cloudflared/     Tunnel config example (generated config.yml is git-ignored)
scripts/         setup-tunnel.sh, hash-password.js
deploy/          systemd user service
```

## Security notes

- The private key, password hash and session secret live only in `.env` (git-ignored, `chmod 600`). The browser only ever receives terminal output.
- The backend binds to loopback; the only way in from outside is the Cloudflare Tunnel.
- Login is rate-limited (5 failures per IP per 15 minutes, using Cloudflare's `CF-Connecting-IP`), passwords are verified with scrypt in constant time, and WebSocket upgrades require both a valid session cookie and an allowed `Origin`.
- Strict CSP, `frame-ancestors 'none'`, and no third-party scripts or fonts.
- Use a dedicated key for this app and remove its line from `authorized_keys` to revoke access instantly.
