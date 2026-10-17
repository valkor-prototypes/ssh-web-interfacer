// Per-IP limits on failed attempts (logins and SSH authentications), so the
// tunnel can't be used to brute-force the password, keys or passphrases.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function clientIp(req) {
  // cloudflared sets CF-Connecting-IP to the real visitor address.
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
}

export function createLimiter({ windowMs = WINDOW_MS, maxFailures = MAX_FAILURES } = {}) {
  const failures = new Map();

  return {
    isLimited(ip) {
      const entry = failures.get(ip);
      if (!entry) return false;
      if (Date.now() - entry.first > windowMs) {
        failures.delete(ip);
        return false;
      }
      return entry.count >= maxFailures;
    },
    fail(ip) {
      const entry = failures.get(ip);
      if (!entry || Date.now() - entry.first > windowMs) {
        failures.set(ip, { first: Date.now(), count: 1 });
      } else {
        entry.count += 1;
      }
    },
    clear(ip) {
      failures.delete(ip);
    },
  };
}

export const loginLimiter = createLimiter();
export const sshLimiter = createLimiter();
