import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Append-only security/execution log at $LOG_DIR/server.log, one event per line:
//
//   2026-10-17T15:30:00.000Z WARN  [auth] failed login ip=203.0.113.7 ua="Mozilla/5.0 …"
//
// Levels: INFO (normal activity), WARN (failed or rejected attempts) and ALERT
// (an IP got blocked for repeated failures, i.e. likely brute force).
// scripts/show-warnings.sh reads these files.

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_FILES = 5;
const logFile = path.join(config.logDir, 'server.log');

fs.mkdirSync(config.logDir, { recursive: true, mode: 0o750 });

function rotate() {
  try {
    if (fs.statSync(logFile).size < MAX_BYTES) return;
  } catch {
    return;
  }
  for (let i = KEEP_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? logFile : `${logFile}.${i - 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${logFile}.${i}`);
  }
}

// Values can come from clients (user agents, origins, usernames), so strip
// anything that could forge extra log lines and quote values with spaces.
function clean(value) {
  const s = String(value).replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 200);
  return /[\s"=]/.test(s) || s === '' ? `"${s.replace(/"/g, "'")}"` : s;
}

function write(level, category, message, fields = {}) {
  const extras = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${clean(v)}`)
    .join(' ');
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${category}] ${message}${extras ? ` ${extras}` : ''}`;

  (level === 'INFO' ? console.log : console.warn)(line);
  try {
    rotate();
    fs.appendFileSync(logFile, `${line}\n`, { mode: 0o640 });
  } catch (err) {
    console.error(`[log] could not write ${logFile}: ${err.message}`);
  }
}

export const log = {
  info: (category, message, fields) => write('INFO', category, message, fields),
  warn: (category, message, fields) => write('WARN', category, message, fields),
  alert: (category, message, fields) => write('ALERT', category, message, fields),
};
