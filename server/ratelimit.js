// Per-IP limit on failed SSH authentications, so the tunnel can't be used
// to brute-force keys/passphrases against sshd.

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
