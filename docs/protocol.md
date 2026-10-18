# Protocol

Everything is same-origin: the page, the API and the WebSocket share one hostname.

## HTTP API

All `/api/*` responses carry `Cache-Control: no-store`. Request bodies are JSON (`express.json`, 4 KB limit).

### `GET /api/session`

Returns whether the session cookie is valid.

```jsonc
// not logged in
{ "authenticated": false }
// logged in
{ "authenticated": true, "host": "127.0.0.1", "defaultUsername": "vitto" }
```

`host` and `defaultUsername` are only revealed to authenticated users.

### `POST /api/login`

```json
{ "password": "…" }
```

| Status | Body | When |
| --- | --- | --- |
| 200 | `{ "ok": true }` + `Set-Cookie: swi_session=…` | correct password |
| 401 | `{ "error": "Incorrect password." }` | wrong or empty password |
| 429 | `{ "error": "Too many attempts. Try again in a few minutes." }` | ≥ 5 failures from this IP in 15 min |
| 503 | `{ "error": "No password has been set on the server yet." }` | `password.sha256` missing |

Cookie attributes: `Path=/; HttpOnly; SameSite=Strict; Max-Age=<TTL>`, plus `Secure` when `NODE_ENV=production`.

### `POST /api/logout`

Always `200 { "ok": true }`. It clears the cookie with `Max-Age=0`. The token itself is not revoked server-side (see [security.md](security.md#known-limitations)).

### Static files

Anything else is served from `dist/`. Unknown paths fall back to `index.html` (SPA routing).

## Session token

```
swi_session = <payload>.<signature>

payload   = base64url(JSON.stringify({ exp: <ms epoch>, nonce: <16 hex chars> }))
signature = base64url(HMAC-SHA256(session.key, payload + "." + <current password hash hex>))
```

Verification (`auth.js → verifySession`) recomputes the signature with the **current** password hash, compares in constant time, then checks `exp > now`. Resetting the password therefore invalidates every token. So does replacing `session.key` and restarting.

## Password hash

```
password.salt    = 64 hex chars (32 random bytes), created once by set-password.sh
password.sha256  = hex( SHA-256( utf8(salt_hex + password) ) )
```

The salt is used as its **hex text**, concatenated before the password. `set-password.sh` (`printf '%s%s' "$SALT" "$PASSWORD" | sha256sum`) and `auth.js → verifyPassword` must agree on this byte-for-byte. Any change to one must be mirrored in the other.

## WebSocket `/ws`

### Upgrade checks (in order)

| Check | Failure |
| --- | --- |
| path is `/ws` | `404` |
| `Origin` header is in `PUBLIC_ORIGIN` (or localhost in dev) | `403`, logged WARN |
| valid `swi_session` cookie | `401`, logged WARN |
| IP not SSH-rate-limited | upgrade succeeds, then an `error` frame with `code: "ratelimit"` and close `1008` |

Max frame size is 64 KB (`maxPayload`).

### Client → server (text frames, JSON)

The **first** frame must be `auth`. Anything else closes with `code: "auth"`. If no frame arrives within 30 s, the server closes with `code: "timeout"`.

```jsonc
{ "type": "auth",
  "username": "vitto",              // /^[a-z_][a-z0-9_.-]{0,31}$/i
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
  "passphrase": "",                  // optional
  "cols": 120, "rows": 40 }          // initial PTY size (clamped 1..1000 / 1..500)

{ "type": "input",  "data": "ls -la\r" }   // keystrokes / paste, UTF-8 string
{ "type": "resize", "cols": 120, "rows": 40 }
```

Unknown types and invalid JSON after `auth` are ignored.

### Server → client

**Binary frames** carry raw terminal output (stdout and stderr of the shell). They are written straight into xterm.

**Text frames** are JSON:

```jsonc
{ "type": "status", "state": "connected", "host": "127.0.0.1", "user": "vitto" }
{ "type": "status", "state": "closed" }            // shell exited
{ "type": "error",  "code": "<code>", "message": "human readable" }
```

| `code` | Meaning | Frontend reaction |
| --- | --- | --- |
| `auth` | invalid username, not a key, key rejected, wrong passphrase | back to ConnectCard with message |
| `ratelimit` | too many SSH failures from this IP | back to ConnectCard with message |
| `timeout` | no `auth` frame within 30 s | back to ConnectCard with message |
| `network` | sshd unreachable or timed out | overlay with Reconnect |
| `shell` | authenticated but PTY/shell failed | overlay with Reconnect |
| `ssh` | anything else, including host-key mismatch | overlay with Reconnect |

### Close codes

| Code | Used for |
| --- | --- |
| `1000` | normal: shell exited |
| `1008` | policy: auth problems, rate limit, timeout |
| `1011` | server error: network/shell/ssh errors |

### Keepalive

The server pings every 25 s and terminates the socket if the previous ping got no pong. This keeps the connection alive through Cloudflare's ~100 s idle timeout and cleans up dead mobile connections. `ssh2` also sends SSH keepalives every 15 s.
