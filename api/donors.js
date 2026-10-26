// Live count of guests who registered as organ donors tonight.
//
//   GET  /api/donors  -> { count }
//   POST /api/donors  -> records one registration per phone, returns { count }
//
// Each phone gets one file, donors/<phone>.json. A second tap from the same phone
// finds the file already there and is not counted again.

import { put, list } from '@vercel/blob';
import { deviceKey, json, readBody } from './_shared.js';

export default async function handler(request) {
  if (request.method === 'GET') return json({ count: await countDonors() });
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  }

  const body = await readBody(request);
  if (body.website) return json({ count: await countDonors() }); // bot trap

  const key = deviceKey(body.device);
  if (key === deviceKey('unknown')) return json({ error: 'Missing device' }, 400);

  let added = true;
  try {
    await put(`donors/${key}.json`, JSON.stringify({ at: new Date().toISOString() }), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json',
    });
  } catch (err) {
    // Either this phone was already counted (the file exists) or something went wrong.
    const existing = await list({ prefix: `donors/${key}.json`, limit: 1 });
    if (!existing.blobs.length) return json({ error: 'Could not record that' }, 500);
    added = false;
  }
  return json({ count: await countDonors(), added }, added ? 201 : 200);
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
