import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { createSession, readSessionCookie, sessionCookie, verifyPassword, verifySession } from './auth.js';
import { log } from './logger.js';
import { clientIp, loginLimiter, sshLimiter } from './ratelimit.js';
import { loadSessionKey, readPasswordHash } from './secrets.js';
import { attachTerminal } from './terminal.js';

const sessionKey = loadSessionKey();
if (!readPasswordHash()) {
  log.warn('auth', 'no password set; run scripts/set-password.sh (logins are refused until then)', { dir: config.secretsDir });
}

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

app.use(express.json({ limit: '4kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const isAuthenticated = (req) => Boolean(verifySession(readSessionCookie(req.headers.cookie), sessionKey));
const cookieOpts = { maxAgeMs: config.sessionTtlMs, secure: config.isProduction };

app.get('/api/session', (req, res) => {
  if (!isAuthenticated(req)) return res.json({ authenticated: false });
  res.json({ authenticated: true, host: config.ssh.host, defaultUsername: config.ssh.defaultUsername });
});

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  const ua = req.headers['user-agent'];
  if (loginLimiter.isLimited(ip)) {
    log.warn('auth', 'login attempt while blocked', { ip, ua });
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  if (!readPasswordHash()) {
    return res.status(503).json({ error: 'No password has been set on the server yet.' });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !verifyPassword(password)) {
    log.warn('auth', 'failed login', { ip, ua });
    loginLimiter.fail(ip);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  loginLimiter.clear(ip);
  log.info('auth', 'login', { ip, ua });
  res.set('Set-Cookie', sessionCookie(createSession(sessionKey, config.sessionTtlMs), cookieOpts));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  if (isAuthenticated(req)) log.info('auth', 'logout', { ip: clientIp(req) });
  res.set('Set-Cookie', sessionCookie('', { ...cookieOpts, maxAgeMs: 0 }));
  res.json({ ok: true });
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
  log.warn('server', 'dist/ not found; run `npm run build` (or use `npm run dev` for the Vite dev server)');
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
    log.warn('ws', 'rejected origin', { ip, origin: req.headers.origin ?? 'none' });
    return reject(403, 'Forbidden');
  }
  if (!isAuthenticated(req)) {
    log.warn('ws', 'terminal connection without a valid session', { ip });
    return reject(401, 'Unauthorized');
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (sshLimiter.isLimited(ip)) {
      log.warn('ssh', 'connection attempt while blocked', { ip });
      ws.send(JSON.stringify({ type: 'error', code: 'ratelimit', message: 'Too many failed attempts. Try again in a few minutes.' }));
      return ws.close(1008);
    }
    attachTerminal(ws, ip);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('server', 'stopping', { signal });
    process.exit(0);
  });
}

server.listen(config.port, config.host, () => {
  log.info('server', 'started', { listen: `http://${config.host}:${config.port}`, ssh: `${config.ssh.host}:${config.ssh.port}`, pid: process.pid });
});
