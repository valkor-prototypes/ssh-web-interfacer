# Code review guide

A suggested reading order, what each file does, and what to look for. About 2,200 lines in total.

## Suggested order

1. `server/config.js`: all settings in one place.
2. `server/index.js`: the HTTP surface and the WebSocket gate.
3. `server/auth.js` + `server/secrets.js` + `scripts/set-password.sh`: gate 1.
4. `server/terminal.js`: gate 2 and the shell bridge. **The most important file.**
5. `server/ratelimit.js` + `server/logger.js` + `scripts/show-warnings.sh`: detection.
6. `web/src/App.vue`: the frontend state machine.
7. `web/src/components/TerminalWindow.vue`: the WebSocket client.
8. `web/src/components/ConnectCard.vue`, `LoginCard.vue`, `KeyBar.vue`, `InstallButton.vue`, `pwa.js`.
9. `vite.config.js`: build, dev proxy, PWA.
10. Scripts and deployment: `quick-tunnel.sh`, `setup-tunnel.sh`, `deploy/*.service`.

Read [architecture.md](architecture.md) and [protocol.md](protocol.md) first. They make the code much faster to follow.

## Server

### `server/config.js`

- Loads `.env` with `process.loadEnvFile` (Node ≥ 20.12, hence `engines` + `.npmrc engine-strict`). Existing env vars are **not** overwritten.
- `~` expansion is done manually for `SECRETS_DIR` and `LOG_DIR`. Relative `LOG_DIR` resolves from the project root, not the cwd.
- Refuses to start in production without `PUBLIC_ORIGIN`. Without it, every WebSocket would be rejected anyway.

Look for: new settings added here rather than read ad hoc from `process.env` elsewhere.

### `server/index.js`

- Security headers middleware first, then JSON body parsing, then `/api` no-store.
- `isAuthenticated` is the single gate helper. **Every new route that touches the server must use it.**
- Static serving: `/assets/*` immutable, everything else `no-cache` (PWA updates depend on this).
- `server.on('upgrade')` runs the order *path → Origin → session → rate limit → attachTerminal*. Order matters: the cheap rejects come first, and nothing reaches `ssh2` without both checks.
- The SIGINT/SIGTERM handlers only log and exit. Open shells are dropped (sshd cleans up).

### `server/auth.js`

- `verifyPassword` reads the hash from disk on every call, so `set-password.sh` takes effect without a restart. `timingSafeEqual` compares 32-byte buffers. The stored hash is validated as 64 hex chars in `secrets.js`, so the lengths always match.
- `sign()` mixes in the current password hash, which is what makes resets log everyone out.
- `verifySession` compares signature **strings** (as buffers) with a length check first, because `timingSafeEqual` throws on length mismatch.
- Cookie parsing is hand-rolled (no `cookie` dependency). It takes the first `swi_session`.

### `server/secrets.js`

- `loadSessionKey()` creates `SECRETS_DIR` (700) and `session.key` (600) on first run.
- `readPasswordHash()` returns `null` unless both files exist and the hash is well-formed. That's the fail-closed path (logins return 503).

### `server/terminal.js`

One `attachTerminal(ws, ip)` call per WebSocket. Read it as a small state machine:

```
awaiting auth ──auth frame──▶ connecting ──ready──▶ shell open ──close──▶ done
      │                           │
      └─30 s timeout─▶ closed     └─error──▶ classified → error frame → closed
```

Things to check:

- **First frame must be `auth`.** `started` flips once, so a second `auth` frame is treated as an unknown message and ignored.
- **Error classification** in `.on('error')`: `client-authentication` → `auth`, passphrase/parse → `auth`, host key → ALERT + falls through to `ssh`, socket/timeout → `network`, else `ssh`. Only auth-type failures count toward the rate limit.
- `ssh.connect` can **throw synchronously** for undecryptable keys. That's the `try/catch`.
- `cleanup` runs on both `close` and `error`. It's idempotent: `ssh.end()` is safe twice, and `session` is nulled after logging.
- Output is forwarded as binary frames without decoding, so multi-byte UTF-8 split across chunks is handled by xterm.
- Nothing logs `privateKey` or `passphrase`. Keep it that way.

### `server/ratelimit.js`

- `createLimiter(name)` returns `{ isLimited, fail, clear }`. There are two instances: `loginLimiter` and `sshLimiter`.
- The ALERT fires exactly once, when `count === maxFailures`.
- Success calls `clear(ip)`, so a legitimate user who typos 4 times isn't punished afterwards.

### `server/logger.js`

- Synchronous `appendFileSync`. It's simple and ordered, and the traffic is tiny. Rotation is checked before each write.
- `clean()` replaces control characters (newline injection), truncates to 200 chars, and quotes values with spaces, quotes or `=`.
- **The IP must stay the first field.** `show-warnings.sh` relies on the first ` ip=` match to resist values that contain fake `ip=` text.

## Frontend

### `web/src/App.vue`

- `credentials` is a `shallowRef` and is never written to storage.
- `onAuthFailed` keeps the username and key but drops the passphrase, and marks `failed: true` so the template shows ConnectCard pre-filled.
- `onUnauthorized` is triggered by TerminalWindow after a socket close when `/api/session` says the session is gone.

### `web/src/components/TerminalWindow.vue`

- Creates xterm with a transparent background (the glass shows through) and loads `FitAddon` and `WebLinksAddon`.
- The `auth` frame is sent in `ws.onopen` with the current `cols/rows`, then `fitAndResize` runs again after `connected`.
- `ResizeObserver` → `requestAnimationFrame` → `fit()` → `resize` frame. `fitAndResize` skips work when the element is hidden (`offsetParent` is null).
- `sendInput` applies the sticky Ctrl from KeyBar: a single character is mapped to its control code (`'c'` → `\x03`).
- On close it checks `/api/session` to tell "session expired" apart from "network dropped".

### `web/src/components/ConnectCard.vue`

- Key input: file picker, drag & drop, or paste. Files over 32 KB and files without a `BEGIN … PRIVATE KEY` header are refused in the browser. The server re-checks.
- The username priority is: pre-filled after a failure → `localStorage` → `SSH_DEFAULT_USERNAME`.

### `web/src/pwa.js`

- Module-level singletons: the service worker registration (`useRegisterSW`) runs once on import.
- `installMode` is `'prompt' | 'ios' | null`.

## Known issues and improvement ideas

Found while writing these docs. None block normal use.

| # | Severity | Issue | Where | Suggested fix |
| --- | --- | --- | --- | --- |
| 1 | Medium | **Pasting more than ~64 KB closes the terminal.** xterm sends a whole paste as one `input` frame, and the server's `maxPayload` is 64 KB, so `ws` closes with 1009. | `TerminalWindow.vue sendInput`, `index.js maxPayload` | Split `data` into ≤ 16 KB chunks in `sendInput` before sending. |
| 2 | Low | Rate-limit maps are never swept. See [security.md](security.md#known-limitations) #3. | `ratelimit.js` | `setInterval` sweep of expired entries. |
| 3 | Low | Logout doesn't revoke the token. See security limitation #2. | `auth.js` | Store a per-session id in a small deny-list until `exp`, or rotate on logout. |
| 4 | Low | The `invalid username` warning is logged before the username is length-checked. `clean()` truncates to 200 chars, so it's bounded but noisy. | `terminal.js start` | Fine as is; optionally log only the length. |
| 5 | Low | `SIGTERM` exits immediately without closing WebSockets gracefully. | `index.js` | Close `wss` clients with 1001 before exiting. |
| 6 | Low | `show-warnings.sh -s` compares timestamps as strings, so the date must be ISO-like (UTC). | `scripts/show-warnings.sh` | Document only, or parse with `date -d`. |
| 7 | Info | No automated test suite. The checks in [testing.md](testing.md) were run manually. | — | Add `node --test` cases around a mock SSH server. |
| 8 | Info | Password hashing is SHA-256 by design choice. | `auth.js`, `set-password.sh` | Move to scrypt if the threat model changes. |

## General checklist

- [ ] New server code imports settings from `config.js`, not `process.env`.
- [ ] New routes use `isAuthenticated`. New failure paths log WARN and update a limiter.
- [ ] No secrets, keys, passwords or request bodies are logged.
- [ ] New UI keeps keys in memory only.
- [ ] `npm run build` passes, and `sw.js` is still generated.
- [ ] `scripts/*.sh` pass `bash -n` and stay `set -euo pipefail`.
- [ ] README and these docs are updated when behaviour or configuration changes.
