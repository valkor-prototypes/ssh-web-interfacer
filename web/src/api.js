async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const getSession = () => request('/api/session');
export const login = (password) => request('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
export const logout = () => request('/api/logout', { method: 'POST' });
