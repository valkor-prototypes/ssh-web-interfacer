import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import {
  clearFailures,
  clientIp,
  createSession,
  isRateLimited,
  readSessionCookie,
  recordFailure,
  sessionCookie,
  verifyPassword,
  verifySession,
} from './auth.js';
import { attachTerminal } from './terminal.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Older Safari versions don't treat wss:// as 'self', so list the public origins explicitly.
const wsOrigins = config.publicOrigins.map((o) => o.replace(/^http/, 'ws')).join(' ');
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self' ${wsOrigins}`.trim(),
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

app.use(express.json({ limit: '4kb' }));

const isAuthenticated = (req) => Boolean(verifySession(readSessionCookie(req.headers.cookie), config.sessionSecret));
const cookieOpts = { maxAgeMs: config.sessionTtlMs, secure: config.isProduction };

app.get('/api/session', (req, res) => {
  res.json({ authenticated: isAuthenticated(req), host: config.ssh.host, user: config.ssh.username });
});

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !verifyPassword(password, config.passwordHash)) {
    recordFailure(ip);
    console.warn(`[auth] failed login from ${ip}`);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  clearFailures(ip);
  console.log(`[auth] login from ${ip}`);
  res.set('Set-Cookie', sessionCookie(createSession(config.sessionSecret, config.sessionTtlMs), cookieOpts));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', sessionCookie('', { ...cookieOpts, maxAgeMs: 0 }));
  res.json({ ok: true });
});

const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
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
  const reject = (code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (url.pathname !== '/ws') return reject(404, 'Not Found');
  if (!originAllowed(req.headers.origin)) {
    console.warn(`[ws] rejected origin ${req.headers.origin}`);
    return reject(403, 'Forbidden');
  }
  if (!isAuthenticated(req)) return reject(401, 'Unauthorized');

  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log(`[ws] terminal opened for ${clientIp(req)}`);
    attachTerminal(ws, {
      cols: Number(url.searchParams.get('cols')) || 80,
      rows: Number(url.searchParams.get('rows')) || 24,
    });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`[web] listening on http://${config.host}:${config.port}`);
});
