import crypto from 'node:crypto';
import { Client } from 'ssh2';
import { config } from './config.js';
import { clearFailures, recordFailure } from './ratelimit.js';

const PING_INTERVAL_MS = 25_000;
const AUTH_TIMEOUT_MS = 30_000;
const USERNAME_RE = /^[a-z_][a-z0-9_.-]{0,31}$/i;

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

function hostVerifier() {
  if (!config.ssh.hostKeySha256) return undefined;
  const pinned = config.ssh.hostKeySha256.replace(/^SHA256:/, '').replace(/=+$/, '');
  return (key) => crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === pinned;
}

/**
 * Bridges one WebSocket to one interactive SSH shell.
 *
 * The first client frame must be the credentials, supplied by the user in the
 * browser: {type:'auth', username, privateKey, passphrase?, cols, rows}.
 * They are used for this one SSH connection and never stored or logged.
 *
 * Afterwards client → server frames are {type:'input',data} | {type:'resize',cols,rows};
 * server → client frames are binary for terminal output and JSON for status.
 */
export function attachTerminal(ws, ip) {
  const ssh = new Client();
  let stream = null;
  let started = false;
  let alive = true;

  const fail = (code, message, closeCode = 1011) => {
    send(ws, { type: 'error', code, message });
    ws.close(closeCode);
  };

  const authTimer = setTimeout(() => fail('timeout', 'No credentials received.', 1008), AUTH_TIMEOUT_MS);

  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, PING_INTERVAL_MS);
  ws.on('pong', () => {
    alive = true;
  });

  const cleanup = () => {
    clearTimeout(authTimer);
    clearInterval(ping);
    ssh.end();
  };

  function start({ username, privateKey, passphrase, cols, rows }) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return fail('auth', 'Invalid username.', 1008);
    }
    if (typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) {
      return fail('auth', 'That does not look like an OpenSSH/PEM private key.', 1008);
    }

    ssh
      .on('ready', () => {
        clearTimeout(authTimer);
        clearFailures(ip);
        console.log(`[ssh] ${username} authenticated from ${ip}`);
        send(ws, { type: 'status', state: 'connected', host: config.ssh.host, user: username });
        ssh.shell({ term: 'xterm-256color', cols: clamp(cols, 1, 1000) || 80, rows: clamp(rows, 1, 500) || 24 }, (err, s) => {
          if (err) return fail('shell', `Could not open shell: ${err.message}`);
          stream = s;
          stream.on('data', (chunk) => ws.readyState === ws.OPEN && ws.send(chunk));
          stream.stderr.on('data', (chunk) => ws.readyState === ws.OPEN && ws.send(chunk));
          stream.on('close', () => {
            send(ws, { type: 'status', state: 'closed' });
            ws.close(1000);
          });
        });
      })
      .on('error', (err) => {
        if (err.level === 'client-authentication') {
          recordFailure(ip);
          console.warn(`[ssh] authentication failed for ${username} from ${ip}`);
          return fail('auth', 'The server rejected this key for that user.', 1008);
        }
        // Wrong/missing passphrase or unparseable key surface as plain errors.
        if (/passphrase|parse|unsupported key/i.test(err.message)) {
          recordFailure(ip);
          return fail('auth', /passphrase/i.test(err.message) ? 'Wrong or missing passphrase.' : `Could not read key: ${err.message}`, 1008);
        }
        if (err.level === 'client-socket' || err.level === 'client-timeout') {
          return fail('network', `Could not reach the SSH server: ${err.message}`);
        }
        fail('ssh', `SSH error: ${err.message}`);
      });

    try {
      ssh.connect({
        host: config.ssh.host,
        port: config.ssh.port,
        username,
        privateKey,
        passphrase: passphrase || undefined,
        keepaliveInterval: 15_000,
        readyTimeout: 15_000,
        hostVerifier: hostVerifier(),
      });
    } catch (err) {
      // ssh2 throws synchronously for keys it can't parse or decrypt.
      recordFailure(ip);
      fail('auth', /passphrase|encrypted/i.test(err.message) ? 'Wrong or missing passphrase.' : `Could not read key: ${err.message}`, 1008);
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!started) {
      if (msg.type !== 'auth') return fail('auth', 'Expected credentials first.', 1008);
      started = true;
      return start(msg);
    }
    if (!stream) return;
    if (msg.type === 'input' && typeof msg.data === 'string') {
      stream.write(msg.data);
    } else if (msg.type === 'resize') {
      stream.setWindow(clamp(msg.rows, 1, 500), clamp(msg.cols, 1, 1000), 0, 0);
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
