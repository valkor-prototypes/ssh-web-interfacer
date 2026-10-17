import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { clientIp, isRateLimited } from './ratelimit.js';
import { attachTerminal } from './terminal.js';

const app = express();
app.disable('x-powered-by');

// Older Safari versions don't treat wss:// as 'self', so list the public origins explicitly.
const wsOrigins = config.publicOrigins.map((o) => o.replace(/^http/, 'ws')).join(' ');
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self' ${wsOrigins}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
});

app.get('/api/info', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ host: config.ssh.host, defaultUsername: config.ssh.defaultUsername });
});

const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, file) {
        // Hashed build assets never change; everything else (index.html, sw.js,
        // manifest) must be revalidated so PWA updates are picked up.
        const immutable = file.includes(`${path.sep}assets${path.sep}`);
        res.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  console.warn('[web] dist/ not found — run `npm run build` (or use `npm run dev` for the Vite dev server)');
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function originAllowed(origin) {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, '');
  if (config.publicOrigins.includes(normalized)) return true;
  // Local development (Vite dev server proxies to us).
  return !config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = clientIp(req);
  const reject = (code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (url.pathname !== '/ws') return reject(404, 'Not Found');
  if (!originAllowed(req.headers.origin)) {
    console.warn(`[ws] rejected origin ${req.headers.origin} from ${ip}`);
    return reject(403, 'Forbidden');
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (isRateLimited(ip)) {
      ws.send(JSON.stringify({ type: 'error', code: 'ratelimit', message: 'Too many failed attempts. Try again in a few minutes.' }));
      return ws.close(1008);
    }
    attachTerminal(ws, ip);
  });
});

server.listen(config.port, config.host, () => {
  console.log(`[web] listening on http://${config.host}:${config.port}`);
});
