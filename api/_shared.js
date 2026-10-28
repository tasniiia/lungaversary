// Helpers shared by the notes and donor routes. Files starting with "_" are not routes on Vercel.
import { createHash } from 'node:crypto';

// Each phone sends a random id it keeps in its own storage. We only store a hash of it.
// Everyone at the venue shares one Wi-Fi address, so limits go by phone, never by IP.
export function deviceKey(raw) {
  const id = typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : 'unknown';
  return createHash('sha256').update('lungaversary:' + id).digest('hex').slice(0, 24);
}

export function json(data, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache, 'X-Robots-Tag': 'noindex' },
  });
}

// Lets Vercel's edge answer repeat requests for a short while, so a room full of phones
// checking the count costs a few storage lookups a minute instead of hundreds.
export const SHARED_SHORT_CACHE = 'public, max-age=0, s-maxage=20, stale-while-revalidate=40';

export async function readBody(request) {
  try { return (await request.json()) || {}; } catch { return {}; }
}
