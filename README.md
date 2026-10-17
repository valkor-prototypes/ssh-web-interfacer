# ssh-web-interfacer

A glass-styled, Apple-inspired web terminal for your homelab, installable as an app. Open a real bash shell on your home server from a phone or laptop, anywhere, **without opening a single port on your router**.

```
 Phone / laptop ──HTTPS/WSS──▶ Cloudflare edge ──(outbound tunnel)──▶ cloudflared ──▶ Node server ──SSH──▶ sshd
  (your SSH key)                                                       └──────────── on the home server ────────────┘
```

- **Frontend:** Vue 3 + [xterm.js](https://xtermjs.org/), frosted-glass UI, macOS-style window, extra-keys bar (Esc, Tab, Ctrl, arrows…) on touch devices. It's a **Progressive Web App**, so you can install it from the site to your home screen, dock or desktop.
- **Backend:** a small Node server (`server/`) that serves the frontend and relays a WebSocket to an SSH shell using [`ssh2`](https://github.com/mscdex/ssh2).
- **Transport:** a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). `cloudflared` makes an *outbound* connection to Cloudflare, so the server stays on its reserved LAN IP.

**Two locks.** The site first asks for a **password**, checked on the server against a salted SHA-256 hash. Then **you bring the key**: you choose (or paste) your SSH private key and enter a username. The key goes over the encrypted WebSocket to the backend, which uses it for that one SSH login. It is never written to disk, logged, or kept after the connection closes. SSH access itself is controlled by `~/.ssh/authorized_keys`, exactly like normal SSH.

The code is all in the repository. The only secrets (password hash, salt, session-signing key) live on the server in `~/.config/ssh-web-interfacer/`, outside the repo, readable only by your user.

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

### 2. Authorise a key for each device

On each device you'll connect from (or on the server, then copy the private key to the device), create a key, ideally **one per device and protected by a passphrase**, so a lost phone can be revoked on its own:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/homelab-phone -C "phone"
```

Then add the **public** key on the server:

```bash
cat homelab-phone.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Because the backend connects from the server itself, you can limit a key to the web terminal by prefixing its line in `authorized_keys` with `from="127.0.0.1,::1" `.

Supported formats: OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`) and PEM (RSA/ECDSA), with or without a passphrase. Ed25519, ECDSA and RSA all work.

### 3. Configure `.env`

```bash
cp .env.example .env
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub     # optional → SSH_HOST_KEY_SHA256
```

| Variable | Description |
| --- | --- |
| `HOST`, `PORT` | Where the Node server listens. Keep `HOST=127.0.0.1`, since only `cloudflared` needs to reach it. Default port `8022`. |
| `PUBLIC_ORIGIN` | The public URL, e.g. `https://terminal.example.com`. WebSocket connections from any other origin are refused. Required in production. |
| `SECRETS_DIR` | Where the password hash, salt and session key are stored. Default `~/.config/ssh-web-interfacer`. |
| `SESSION_TTL_HOURS` | How long a login lasts (default 12). |
| `SSH_HOST`, `SSH_PORT` | SSH target, normally `127.0.0.1` and `22`. |
| `SSH_DEFAULT_USERNAME` | Optional. Pre-fills the username field. |
| `SSH_HOST_KEY_SHA256` | Optional host-key pin. The connection is refused if the server's key doesn't match. |

### 4. Set the login password

```bash
scripts/set-password.sh
```

It prompts twice (input hidden), then writes to the secrets directory (created with mode `700`, files `600`):

| File | Contents |
| --- | --- |
| `password.salt` | random 32-byte salt (hex), created once |
| `password.sha256` | `sha256(salt + password)` (hex) |
| `session.key` | random key that signs login cookies, created by the server on first start |

**To reset the password**, run the script again. It takes effect immediately (no restart) and signs out every open session. To print the hash of any string with your salt without saving it, run `scripts/set-password.sh --hash 'some text'`.

Until a password is set, the server refuses all logins.

### 5. Run the backend

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

### 6. Create the Cloudflare Tunnel

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

Open `https://terminal.example.com`, enter your password, pick your key, and you're in.

### 7. Lock it down with Cloudflare Access (strongly recommended)

This page is a shell on your server, so add a second, independent gate in front of it. In the Cloudflare dashboard → **Zero Trust → Access → Applications → Add an application → Self-hosted**:

- **Application domain:** `terminal.example.com`
- **Policy:** *Allow* → *Emails* → your email address (login via one-time PIN, Google, GitHub, …)

Unauthenticated visitors are now stopped at Cloudflare's edge and never reach your server. It's free for up to 50 users.

## Usage

1. Open the site and enter the **password**. The login lasts `SESSION_TTL_HOURS` on that device (an `HttpOnly`, `Secure`, `SameSite=Strict` cookie).
2. Enter your **username**, then **choose your private key file** (or drag it onto the card, or tap *Paste key text instead*), and add the **passphrase** if the key has one.
3. Hit **Connect**. If the server rejects the key, you're sent back to the form with the error; the username and key stay filled in.
4. **Disconnect** closes the shell and forgets the key, leaving you on the key screen. Closing or reloading the tab also forgets the key, so you'll pick it again next time (the password login and the username are remembered). **Log out** ends the password session too.

Tips:

- **Every connection gets a fresh shell.** For long-running work use `tmux` (`tmux new -A -s main` re-attaches to the same session from any device).
- **Text size:** `A−` / `A+` in the title bar (remembered per device).
- **On a phone:** the bar under the terminal provides Esc, Tab, arrows, `|`, `~`, `^C` and a sticky **ctrl** key (tap *ctrl*, then a letter, e.g. Ctrl-R).
- **Getting the key onto a phone:** save the private key file to the phone's Files app (iOS) or storage (Android), e.g. via AirDrop or a USB cable, and pick it from the file chooser. Avoid sending private keys through chat or email.

### Install as an app (PWA)

The site is a Progressive Web App. Installing it gives you a home-screen/dock icon and a full-screen window without browser chrome.

- **Android / Chrome / Edge (desktop):** tap **Install app** on the login or connect screen, or use the install icon in the address bar / *⋮ → Install app*.
- **iPhone / iPad (Safari):** tap **Install app** for instructions, or tap **Share → Add to Home Screen**.
- **macOS Safari 17+:** *File → Add to Dock*.

The app shell is cached by a service worker, so it opens instantly. You still need a connection to reach the server. When a new version is deployed, the app shows an **Update** button instead of reloading under your open shell.

PWAs need HTTPS. The Cloudflare Tunnel provides it automatically (`localhost` also works for development).

## Development

```bash
npm run dev     # Node backend on :8022 (auto-restart) + Vite on http://localhost:5173 with hot reload
```

Vite proxies `/api` and `/ws` to the backend. In development (`NODE_ENV` not `production`) WebSocket origins from `localhost` are accepted. The service worker is only generated by `npm run build`; use `npm run build && npm start` to test the PWA.

```
server/          Node backend: config, secrets, password + session auth, rate limiting, SSH ⇄ WebSocket bridge
web/             Vue 3 PWA frontend (Vite root; icons and favicon in web/public/)
cloudflared/     Tunnel config example (generated config.yml is git-ignored)
scripts/         setup-tunnel.sh, set-password.sh
deploy/          systemd user service
```

## Security notes

- **Secrets stay on the server, outside git.** The password hash, salt and session key are in `SECRETS_DIR` (`~/.config/ssh-web-interfacer`, mode `700`). `.env` holds no secrets. SSH private keys are supplied per connection from the browser, held only in that tab's memory and in the backend's memory for that single SSH connection, and never saved or logged. Remove a key's line from `authorized_keys` to revoke that device instantly.
- **Two independent checks:** the password gates the whole site, including the WebSocket (no valid session cookie → `401`), and the SSH key gates the shell.
- The password is sent over HTTPS and hashed on the server as `sha256(salt + password)`, compared in constant time. SHA-256 is fast, so if the hash file ever leaked, a weak password could be brute-forced offline. Use a long passphrase (the script requires ≥ 12 characters).
- Session cookies are HMAC-signed with `session.key` and bound to the current password hash, so resetting the password signs everyone out. Deleting `session.key` (then restarting) does the same.
- Built-in mitigations: the backend binds to loopback, so the only way in from outside is the Cloudflare Tunnel. Failed logins and failed SSH authentications are each limited to 5 per IP per 15 minutes (using Cloudflare's `CF-Connecting-IP`). WebSocket upgrades also require an allowed `Origin`, usernames are validated, SSH host-key pinning is optional, and a strict CSP (`frame-ancestors 'none'`, no third-party scripts or fonts) keeps anything else on the page from reading the key.
- **Add Cloudflare Access (step 7)** so strangers are stopped at Cloudflare's edge before they even see the login page. Use passphrase-protected keys, one per device.
