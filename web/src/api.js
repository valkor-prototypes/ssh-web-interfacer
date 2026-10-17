export async function getInfo() {
  const res = await fetch('/api/info', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}
