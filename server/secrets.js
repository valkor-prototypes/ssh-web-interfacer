import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

// Everything secret lives in config.secretsDir (default ~/.config/ssh-web-interfacer),
// outside the repository, readable only by the owner.

const file = (name) => path.join(config.secretsDir, name);

function readTrimmed(name) {
  try {
    return fs.readFileSync(file(name), 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

/** Salted password hash written by scripts/set-password.sh. Read on every call so a reset needs no restart. */
export function readPasswordHash() {
  const salt = readTrimmed('password.salt');
  const hash = readTrimmed('password.sha256').toLowerCase();
  return salt && /^[0-9a-f]{64}$/.test(hash) ? { salt, hash } : null;
}

/** Key used to sign session cookies; generated on first start. */
export function loadSessionKey() {
  fs.mkdirSync(config.secretsDir, { recursive: true, mode: 0o700 });
  const existing = readTrimmed('session.key');
  if (existing) return existing;
  const key = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file('session.key'), `${key}\n`, { mode: 0o600 });
  log.info('auth', 'generated new session key', { file: file('session.key') });
  return key;
}
