import crypto from 'node:crypto';

const COOKIE_NAME = 'swi_session';

// ─── Password hashing (scrypt, no native deps) ───────────────────────────

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

// Fields are ':'-separated (not '$') so the hash survives being sourced by a shell.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join(':');
}

export function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(N) * Number(r) * 2,
  });
  return crypto.timingSafeEqual(expected, actual);
}

// ─── Signed session tokens ───────────────────────────────────────────────

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSession(secret, ttlMs) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + ttlMs, nonce: crypto.randomBytes(8).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// ─── Cookies ─────────────────────────────────────────────────────────────

export function readSessionCookie(cookieHeader = '') {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token, { maxAgeMs, secure }) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// ─── Login rate limiting ─────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map();

export function clientIp(req) {
  // cloudflared sets CF-Connecting-IP to the real visitor address.
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
}

export function isRateLimited(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failures.set(ip, { first: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }
}

export function clearFailures(ip) {
  failures.delete(ip);
}
