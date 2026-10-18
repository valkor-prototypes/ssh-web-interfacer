# Operations

Day-to-day running of the server. First-time setup is in the [README](../README.md#setup).

## Processes

| Process | How it runs | Logs |
| --- | --- | --- |
| Node server | `systemctl --user … ssh-web-interfacer` (or `npm start`, or inside `scripts/quick-tunnel.sh`) | `logs/server.log` + `journalctl --user -u ssh-web-interfacer` |
| cloudflared (named tunnel) | `sudo systemctl … cloudflared` after `cloudflared service install` | `journalctl -u cloudflared` |
| cloudflared (quick tunnel) | inside `scripts/quick-tunnel.sh` | captured by the script |

```bash
systemctl --user status ssh-web-interfacer
systemctl --user restart ssh-web-interfacer
sudo systemctl status cloudflared
```

## Updating the app

```bash
git pull
npm ci
npm run build
systemctl --user restart ssh-web-interfacer
```

Open browsers and installed PWAs show an **Update** toast. Tapping it reloads into the new version.

## Secrets

| Task | Command | Effect |
| --- | --- | --- |
| Change the password | `scripts/set-password.sh` | immediate, logs out every session, no restart |
| Hash a string with your salt | `scripts/set-password.sh --hash 'text'` | prints only |
| Log everyone out without changing the password | `rm ~/.config/ssh-web-interfacer/session.key && systemctl --user restart ssh-web-interfacer` | new key generated on start |
| Change the salt | delete `password.salt`, then run `set-password.sh` | new salt + hash |
| Revoke one device's SSH key | delete its line in `~/.ssh/authorized_keys` | immediate, for new connections |

Back up `~/.config/ssh-web-interfacer/` if you don't want to reset the password after a reinstall. The session key can always be regenerated.

## Logs

```bash
scripts/show-warnings.sh           # what went wrong, with a per-IP summary
scripts/show-warnings.sh -f        # watch live
scripts/show-warnings.sh -a -n 50  # last 50 events of any level
```

- Rotation: at 5 MB, `server.log` → `server.log.1` … `.5`. The oldest is deleted.
- Nothing deletes logs by age. To keep less history, add a cron job such as `find ~/Documents/Project/ssh-web-interfacer/logs -name 'server.log.*' -mtime +90 -delete`.

### Reading an incident

1. `scripts/show-warnings.sh -A`: any ALERT means an IP hit the rate limit, or the SSH host key changed.
2. Check the IP: is it yours? Home IPv6 addresses share your prefix, and mobile carriers rotate addresses.
3. If it's hostile and recurring, block it in Cloudflare (**Security → WAF → Tools → IP Access Rules**) or enable Cloudflare Access.
4. A **host key ALERT** with no planned change to the SSH server is serious. Don't connect until you understand why. If the change was legitimate (for example, after a reinstall), update `SSH_HOST_KEY_SHA256`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `npm run build`: `SyntaxError: Unexpected reserved word` | Node < 20.12 (Ubuntu's apt package is Node 12) | install Node 22 from NodeSource; `rm -rf node_modules && npm ci` |
| `npm install`: `EBADENGINE` | same | same |
| Login page says "No password has been set" | `password.sha256` missing | `scripts/set-password.sh` |
| Terminal: "rejected the login for …" | wrong **username** (the server account, not the key's name), or the key isn't in `authorized_keys` | use e.g. `vitto`; check `ssh-keygen -lf ~/.ssh/authorized_keys` against the key's `.pub` |
| Terminal closes immediately, `rejected origin` in the log | the browser's address isn't in `PUBLIC_ORIGIN` | fix `.env` and restart; `quick-tunnel.sh` sets it automatically |
| Terminal closes after a big paste | paste > 64 KB (known issue #1) | paste in smaller parts |
| Bounced to login while working | session expired or password reset | log in again; raise `SESSION_TTL_HOURS` if needed |
| "Too many failed attempts" | 5 failures in 15 min from your IP | wait, or restart the server (limits are in memory) |
| Installed PWA can't connect after `quick-tunnel.sh` restart | quick-tunnel addresses change every run | use the new link; install only once on a permanent domain |
| `Port 8022 is already in use` from `quick-tunnel.sh` | systemd service already running | `systemctl --user stop ssh-web-interfacer` |
| sshd side of a failure | — | `journalctl -u ssh --since -1h` (shows e.g. `Invalid user Desktop`) |
