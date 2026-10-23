// Live count of guests who registered as organ donors tonight.
//
//   GET  /api/donors  -> { count }
//   POST /api/donors  -> records one registration, returns { count }
//
// Uses the same private Vercel Blob store as the notes. Each tap is one tiny
// file under donors/, so the count is simply how many files exist.

import { put, list } from '@vercel/blob';

export default async function handler(request) {
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }
    if (body && body.website) return json({ count: await countDonors() }); // bot trap

    await put(`donors/${Date.now()}.json`, JSON.stringify({ at: new Date().toISOString() }), {
      access: 'private',
      addRandomSuffix: true,
      contentType: 'application/json',
    });
    return json({ count: await countDonors() }, 201);
  }
  if (request.method === 'GET') return json({ count: await countDonors() });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
}

async function countDonors() {
  let count = 0;
  let cursor;
  do {
    const page = await list({ prefix: 'donors/', cursor });
    count += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return count;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
