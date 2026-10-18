import crypto from 'node:crypto';
import { readPasswordHash } from './secrets.js';

const COOKIE_NAME = 'swi_session';

// ─── Password ────────────────────────────────────────────────────────────

/** Checks SHA-256(salt + password) against the stored hash, in constant time. */
export function verifyPassword(password) {
  const stored = readPasswordHash();
  if (!stored) return false;
  const actual = crypto.createHash('sha256').update(stored.salt + password, 'utf8').digest();
  return crypto.timingSafeEqual(actual, Buffer.from(stored.hash, 'hex'));
}

// ─── Signed session tokens ───────────────────────────────────────────────

// The current password hash is mixed into the signature, so resetting the
// password invalidates every existing session.
function sign(payload, key) {
  const stored = readPasswordHash();
  return crypto
    .createHmac('sha256', key)
    .update(`${payload}.${stored?.hash ?? ''}`)
    .digest('base64url');
}

export function createSession(key, ttlMs) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + ttlMs, nonce: crypto.randomBytes(8).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function verifySession(token, key) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, key));
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
