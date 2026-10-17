import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env from the project root if present. Real environment variables win.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
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
  ssh: {
    host: process.env.SSH_HOST || '127.0.0.1',
    port: Number(process.env.SSH_PORT || 22),
    defaultUsername: process.env.SSH_DEFAULT_USERNAME || '',
    hostKeySha256: process.env.SSH_HOST_KEY_SHA256 || '',
  },
};

if (isProduction && config.publicOrigins.length === 0) {
  throw new Error('PUBLIC_ORIGIN must be set in production (see .env.example)');
}
