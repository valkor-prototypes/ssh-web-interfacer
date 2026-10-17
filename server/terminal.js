import crypto from 'node:crypto';
import { Client } from 'ssh2';
import { config } from './config.js';

const PING_INTERVAL_MS = 25_000;

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

/**
 * Bridges one authenticated WebSocket to one interactive SSH shell.
 * Client → server frames are JSON: {type:'input',data} | {type:'resize',cols,rows}.
 * Server → client frames are binary for terminal output and JSON for status.
 */
export function attachTerminal(ws, { cols = 80, rows = 24 } = {}) {
  const ssh = new Client();
  let stream = null;
  let alive = true;

  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, PING_INTERVAL_MS);
  ws.on('pong', () => {
    alive = true;
  });

  const cleanup = () => {
    clearInterval(ping);
    ssh.end();
  };

  ssh
    .on('ready', () => {
      send(ws, { type: 'status', state: 'connected', host: config.ssh.host, user: config.ssh.username });
      ssh.shell({ term: 'xterm-256color', cols, rows }, (err, s) => {
        if (err) {
          send(ws, { type: 'error', message: `Could not open shell: ${err.message}` });
          return ws.close(1011);
        }
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
      send(ws, { type: 'error', message: `SSH error: ${err.message}` });
      ws.close(1011);
    })
    .connect({
      host: config.ssh.host,
      port: config.ssh.port,
      username: config.ssh.username,
      privateKey: config.ssh.privateKey,
      passphrase: config.ssh.passphrase,
      keepaliveInterval: 15_000,
      readyTimeout: 15_000,
      hostVerifier: config.ssh.hostKeySha256
        ? (key) => {
            const fingerprint = crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
            return fingerprint === config.ssh.hostKeySha256.replace(/^SHA256:/, '').replace(/=+$/, '');
          }
        : undefined,
    });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
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
