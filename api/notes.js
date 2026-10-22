// Saves guests' notes for Sheuli's keepsake book, and lets you export them afterwards.
//
//   POST /api/notes                      -> saves { note, name } as a private blob
//   GET  /api/notes?key=YOUR_KEY         -> printable page of every note (for the keepsake book)
//   GET  /api/notes?key=YOUR_KEY&format=csv   -> spreadsheet
//   GET  /api/notes?key=YOUR_KEY&format=json  -> raw data
//
// Needs: a *private* Vercel Blob store connected to the project, and an
// environment variable NOTES_ADMIN_KEY (any long secret you choose).

import { put, list, get } from '@vercel/blob';

const MAX_NOTE = 3000;
const MAX_NAME = 120;

export default async function handler(request) {
  if (request.method === 'POST') return saveNote(request);
  if (request.method === 'GET') return exportNotes(request);
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
}

async function saveNote(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  // Bots fill in the hidden "website" field; quietly accept and discard.
  if (body && body.website) return json({ ok: true }, 201);

  const note = String(body?.note ?? '').trim();
  const name = String(body?.name ?? '').trim();
  if (!note) return json({ error: 'Please write a note.' }, 400);
  if (note.length > MAX_NOTE || name.length > MAX_NAME) return json({ error: 'That note is too long.' }, 400);

  const record = { name, note, createdAt: new Date().toISOString() };
  await put(`notes/${Date.now()}.json`, JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: true,
    contentType: 'application/json',
  });
  return json({ ok: true }, 201);
}

async function exportNotes(request) {
  const url = new URL(request.url);
  const adminKey = process.env.NOTES_ADMIN_KEY;
  if (!adminKey || url.searchParams.get('key') !== adminKey) {
    return new Response('Not found', { status: 404 });
  }

  const pathnames = [];
  let cursor;
  do {
    const page = await list({ prefix: 'notes/', cursor });
    page.blobs.forEach((b) => pathnames.push(b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const notes = [];
  for (let i = 0; i < pathnames.length; i += 20) {
    const batch = await Promise.all(
      pathnames.slice(i, i + 20).map(async (p) => {
        const result = await get(p, { access: 'private' });
        if (!result || result.statusCode !== 200) return null;
        try {
          return JSON.parse(await new Response(result.stream).text());
        } catch {
          return null;
        }
      }),
    );
    batch.forEach((n) => n && notes.push(n));
  }
  notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const format = url.searchParams.get('format');
  const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

  if (format === 'json') {
    return new Response(JSON.stringify(notes, null, 2), { headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  if (format === 'csv') {
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = ['Name,Note,Written at', ...notes.map((n) => [cell(n.name), cell(n.note), cell(n.createdAt)].join(','))].join('\r\n');
    return new Response('﻿' + csv, {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="notes-for-sheuli.csv"' },
    });
  }

  return new Response(printablePage(notes), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function printablePage(notes) {
  const items = notes
    .map(
      (n) => `<article><p>${esc(n.note).replace(/\n/g, '<br>')}</p><footer>${n.name ? '— ' + esc(n.name) : '— with love'}</footer></article>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes for Sheuli</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;1,400&display=swap">
<style>
body{margin:0;background:#F6F2E9;color:#1B261E;font-family:'Libre Baskerville',Georgia,serif;line-height:1.7}
main{max-width:640px;margin:0 auto;padding:56px 24px}
h1{font-weight:400;font-style:italic;font-size:40px;text-align:center;margin:0 0 6px;color:#1E3A2A}
.count{text-align:center;color:#55604F;font-size:14px;margin:0 0 40px}
article{padding:28px 0;border-top:1px solid #D9CFB6;break-inside:avoid}
article p{margin:0;font-size:17px}
article footer{margin-top:10px;font-style:italic;color:#7D6224}
@media print{body{background:#fff}main{padding:0}article{page-break-inside:avoid}}
</style></head><body><main>
<h1>Notes for Sheuli</h1><p class="count">${notes.length} ${notes.length === 1 ? 'note' : 'notes'} from her celebration</p>
${items || '<p class="count">No notes yet.</p>'}
</main></body></html>`;
}
