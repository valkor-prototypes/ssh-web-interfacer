# Testing

There's no automated suite yet (see [code-review-guide.md](code-review-guide.md#known-issues-and-improvement-ideas) #7). These are the manual end-to-end checks used during development. They exercise the real server against a **mock SSH server**, so you never need to touch your real `authorized_keys` or expose anything publicly.

Run everything from the project root, using a throwaway directory for keys, secrets and logs:

```bash
export T=$(mktemp -d)
```

## 1. Build

```bash
npm ci && npm run build
ls dist/sw.js dist/manifest.webmanifest   # PWA files generated
```

## 2. Mock SSH server

Accepts only the listed public keys for user `tester` and echoes input back:

```bash
ssh-keygen -q -t ed25519 -N ''           -f $T/host     # mock server's host key
ssh-keygen -q -t ed25519 -N ''           -f $T/client   # authorised, no passphrase
ssh-keygen -q -t ed25519 -N 'secretpass' -f $T/enc      # authorised, with passphrase
ssh-keygen -q -t ed25519 -N ''           -f $T/other    # NOT authorised

cat > $T/mockssh.cjs <<'EOF'
const { Server, utils } = require(process.cwd() + '/node_modules/ssh2');
const fs = require('fs');
const [hostKey, ...pubs] = process.argv.slice(2);
const allowed = pubs.map((p) => utils.parseKey(fs.readFileSync(p)).getPublicSSH());
new Server({ hostKeys: [fs.readFileSync(hostKey)] }, (c) => {
  c.on('error', () => {});
  c.on('authentication', (ctx) => {
    const ok = ctx.method === 'publickey' && ctx.username === 'tester' && allowed.some((k) => k.equals(ctx.key.data));
    ok ? ctx.accept() : ctx.reject(['publickey']);
  }).on('ready', () => c.on('session', (accept) => {
    const s = accept();
    s.on('pty', (a) => a && a()).on('window-change', (a) => a && a());
    s.on('shell', (a) => { const st = a(); st.write('mock$ '); st.on('data', (d) => st.write('echo:' + d)); });
  }));
}).listen(2222, '127.0.0.1', () => console.log('mock ssh on :2222'));
EOF
node $T/mockssh.cjs $T/host $T/client.pub $T/enc.pub &
```

## 3. Server under test

```bash
export SECRETS_DIR=$T/secrets LOG_DIR=$T/logs
printf 'test-password-123\ntest-password-123\n' | scripts/set-password.sh
PORT=8099 PUBLIC_ORIGIN=https://terminal.example.com SSH_PORT=2222 \
SSH_HOST_KEY_SHA256=$(ssh-keygen -lf $T/host.pub | awk '{print $2}') \
NODE_ENV=production node server/index.js &
```

## 4. HTTP checks

```bash
J='content-type: application/json'
curl -s localhost:8099/api/session                                                  # {"authenticated":false}
curl -s -XPOST localhost:8099/api/login -H "$J" -d '{"password":"nope"}'            # 401
curl -s -c $T/jar -XPOST localhost:8099/api/login -H "$J" -d '{"password":"test-password-123"}'   # ok + cookie
curl -s -b $T/jar localhost:8099/api/session                                        # authenticated:true
grep swi_session $T/jar                                                             # HttpOnly cookie present
curl -sI localhost:8099/sw.js | grep -i cache-control                               # no-cache
```

## 5. WebSocket checks

```bash
cat > $T/ws.mjs <<'EOF'
import fs from 'fs';
import WebSocket from 'ws';
const [cookie, T] = process.argv.slice(2);
const key = (n) => fs.readFileSync(`${T}/${n}`, 'utf8');
const run = (auth, { origin = 'https://terminal.example.com', c = cookie } = {}) => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:8099/ws', { headers: { Origin: origin, Cookie: `swi_session=${c}` } });
  let out = '';
  ws.on('error', () => {});
  ws.on('unexpected-response', (_, r) => res(`rejected ${r.statusCode}`));
  ws.on('message', (d, bin) => { out += bin ? d.toString() : `[${d}]`; });
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', cols: 100, rows: 30, ...auth }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'input', data: 'hi' })), 500);
  });
  setTimeout(() => { ws.close(); res(out); }, 1300);
});
console.log('foreign origin  ', await run({}, { origin: 'https://evil.example' }));          // rejected 403
console.log('no session      ', await run({}, { c: 'forged' }));                             // rejected 401
console.log('good key        ', await run({ username: 'tester', privateKey: key('client') }));  // connected … echo:hi
console.log('passphrase ok   ', await run({ username: 'tester', privateKey: key('enc'), passphrase: 'secretpass' }));
console.log('passphrase miss ', await run({ username: 'tester', privateKey: key('enc') }));     // Wrong or missing passphrase
console.log('wrong user      ', await run({ username: 'root', privateKey: key('client') }));    // rejected the login
console.log('bad username    ', await run({ username: 'a b;rm', privateKey: key('client') }));  // Invalid username
for (let i = 0; i < 3; i++) console.log('unknown key     ', await run({ username: 'tester', privateKey: key('other') }));
console.log('after 5 fails   ', await run({ username: 'tester', privateKey: key('client') }));  // ratelimit
EOF
cp $T/ws.mjs ./.ws-test.mjs   # must run from the project so `ws` resolves
node .ws-test.mjs "$(awk '/swi_session/{print $7}' $T/jar)" $T; rm .ws-test.mjs
```

## 6. Password reset invalidates sessions

```bash
printf 'another-password-99\nanother-password-99\n' | scripts/set-password.sh
curl -s -b $T/jar localhost:8099/api/session        # {"authenticated":false}, no restart needed
```

## 7. Logs and the warnings script

```bash
LOG_DIR=$T/logs scripts/show-warnings.sh       # WARNs, ALERTs, top-IP summary
LOG_DIR=$T/logs scripts/show-warnings.sh -A    # ALERT lines only
for i in 1 2 3 4 5 6; do curl -s -XPOST localhost:8099/api/login -H "$J" \
  -H 'CF-Connecting-IP: 198.51.100.23' -d '{"password":"x"}' >/dev/null; done
LOG_DIR=$T/logs scripts/show-warnings.sh -A    # "possible brute force … ip=198.51.100.23"
```

Log injection: send a username containing `\n2026-… INFO …`. It must stay on one line, quoted, and the summary must not count any `ip=` inside it.

## 8. Browser checks (manual)

On a phone over mobile data via `scripts/quick-tunnel.sh`:

- [ ] Login → wrong password shakes and shows the error; the right one goes to the key screen.
- [ ] Pick a key file; the chip shows its name. Paste mode works.
- [ ] Wrong username → back to the form with a clear message; the key is still selected.
- [ ] Terminal: typing, `htop`/`vim` render, resize on rotation, KeyBar Ctrl + C, arrows.
- [ ] Disconnect → key screen. Log out → login screen.
- [ ] **Install app** appears (Android/Chrome) or shows iOS instructions. The installed app opens full-screen.
- [ ] After `npm run build` + restart, an open app shows the **Update** toast.

## Cleanup

```bash
kill %1 %2; rm -rf "$T"; unset SECRETS_DIR LOG_DIR
```
