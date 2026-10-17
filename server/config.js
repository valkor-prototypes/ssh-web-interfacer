import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env from the project root if present. Real environment variables win.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
}

function loadPrivateKey() {
  if (process.env.SSH_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.SSH_PRIVATE_KEY_BASE64, 'base64');
  }
  const keyPath = required('SSH_PRIVATE_KEY_PATH');
  return fs.readFileSync(keyPath);
}

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  root,
  isProduction,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8022),
  publicOrigins: (process.env.PUBLIC_ORIGIN || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  passwordHash: required('APP_PASSWORD_HASH'),
  sessionSecret: required('SESSION_SECRET'),
  sessionTtlMs: Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
  ssh: {
    host: process.env.SSH_HOST || '127.0.0.1',
    port: Number(process.env.SSH_PORT || 22),
    username: required('SSH_USERNAME'),
    privateKey: loadPrivateKey(),
    passphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE || undefined,
    hostKeySha256: process.env.SSH_HOST_KEY_SHA256 || '',
  },
};

if (config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long');
}
