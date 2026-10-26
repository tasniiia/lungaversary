// Guests' notes for Sheuli's keepsake book.
//
// Guests
//   POST /api/notes  { note, name, device }  -> saves a note (one every 20 seconds, 10 per phone)
//
// You (with NOTES_ADMIN_KEY)
//   GET  /api/notes?key=KEY&format=review  -> read every note and hide any you don't want in the book
//   GET  /api/notes?key=KEY                -> printable keepsake page (hidden notes left out)
//   GET  /api/notes?key=KEY&format=csv     -> spreadsheet (hidden notes left out)
//   GET  /api/notes?key=KEY&format=json    -> raw data (add &all=1 to include hidden notes)
//   POST /api/notes  { action: "hide" | "show", id, key }  -> used by the review page
//
// Needs a private Vercel Blob store connected to the project, and NOTES_ADMIN_KEY set.

import { put, list, get } from '@vercel/blob';
import { deviceKey, json, readBody } from './_shared.js';

const MAX_NOTE = 3000;
const MAX_NAME = 120;
const WAIT_SECONDS = 20;
const PER_PHONE = 10;
const HIDDEN_PATH = 'moderation/hidden.json';

export default async function handler(request) {
  if (request.method === 'POST') {
    const body = await readBody(request);
    if (body.action) return moderate(body);
    return saveNote(body);
  }
  if (request.method === 'GET') return exportNotes(request);
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
}

function isAdmin(key) {
  const adminKey = process.env.NOTES_ADMIN_KEY;
  return Boolean(adminKey) && key === adminKey;
}

async function saveNote(body) {
  if (body.website) return json({ ok: true }, 201); // bot trap: accept quietly, keep nothing

  const note = String(body.note ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!note) return json({ error: 'Please write a note.' }, 400);
  if (note.length > MAX_NOTE || name.length > MAX_NAME) return json({ error: 'That note is too long.' }, 400);

  const phone = deviceKey(body.device);
  const mine = await list({ prefix: `notes/${phone}/` });
  if (mine.blobs.length >= PER_PHONE) {
    return json({ error: 'You’ve shared a lot of love already. Thank you!' }, 429);
  }
  const latest = mine.blobs.reduce((t, b) => Math.max(t, new Date(b.uploadedAt).getTime()), 0);
  if (Date.now() - latest < WAIT_SECONDS * 1000) {
    return json({ error: 'Please wait a moment before adding another note.' }, 429);
  }

  const record = { name, note, createdAt: new Date().toISOString() };
  await put(`notes/${phone}/${Date.now()}.json`, JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: true,
    contentType: 'application/json',
  });
  return json({ ok: true }, 201);
}

async function readHidden() {
  try {
    const result = await get(HIDDEN_PATH, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return [];
    const list = JSON.parse(await new Response(result.stream).text());
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function moderate(body) {
  if (!isAdmin(body.key)) return new Response('Not found', { status: 404 });
  const id = String(body.id || '');
  if (!id.startsWith('notes/')) return json({ error: 'Unknown note' }, 400);

  const hidden = new Set(await readHidden());
  if (body.action === 'hide') hidden.add(id);
  else if (body.action === 'show') hidden.delete(id);
  else return json({ error: 'Unknown action' }, 400);

  await put(HIDDEN_PATH, JSON.stringify([...hidden]), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return json({ ok: true, hidden: hidden.has(id) });
}

async function loadNotes() {
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
          return { id: p, ...JSON.parse(await new Response(result.stream).text()) };
        } catch {
          return null;
        }
      }),
    );
    batch.forEach((n) => n && notes.push(n));
  }
  notes.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return notes;
}

async function exportNotes(request) {
  const url = new URL(request.url);
  if (!isAdmin(url.searchParams.get('key'))) return new Response('Not found', { status: 404 });

  const [notes, hiddenList] = await Promise.all([loadNotes(), readHidden()]);
  const hidden = new Set(hiddenList);
  const format = url.searchParams.get('format');
  const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

  if (format === 'review') {
    return new Response(reviewPage(notes, hidden), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const forBook = url.searchParams.get('all') === '1' ? notes : notes.filter((n) => !hidden.has(n.id));

  if (format === 'json') {
    const data = forBook.map(({ id, ...rest }) => ({ ...rest, hidden: hidden.has(id) }));
    return new Response(JSON.stringify(data, null, 2), { headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  if (format === 'csv') {
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = ['Name,Note,Written at', ...forBook.map((n) => [cell(n.name), cell(n.note), cell(n.createdAt)].join(','))].join('\r\n');
    return new Response('﻿' + csv, {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="notes-for-sheuli.csv"' },
    });
  }
  return new Response(printablePage(forBook), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const FONTS = `
@font-face{font-family:'Libre Baskerville';font-weight:400;src:url(/fonts/lb-regular.woff) format('woff')}
@font-face{font-family:'Libre Baskerville';font-style:italic;font-weight:400;src:url(/fonts/lb-italic.woff) format('woff')}`;

function printablePage(notes) {
  const items = notes
    .map((n) => `<article><p>${esc(n.note).replace(/\n/g, '<br>')}</p><footer>${n.name ? '— ' + esc(n.name) : '— with love'}</footer></article>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes for Sheuli</title><meta name="robots" content="noindex">
<style>${FONTS}
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

function reviewPage(notes, hidden) {
  const shown = notes.filter((n) => !hidden.has(n.id)).length;
  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  };
  const cards = notes
    .map((n) => {
      const off = hidden.has(n.id);
      return `<article class="${off ? 'off' : ''}" data-id="${esc(n.id)}">
  <div class="meta"><b>${n.name ? esc(n.name) : 'No name'}</b><span>${esc(fmt(n.createdAt))}</span><em class="flag">Hidden from the book</em></div>
  <p>${esc(n.note).replace(/\n/g, '<br>')}</p>
  <button type="button">${off ? 'Show in the book' : 'Hide from the book'}</button>
</article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review Notes · Sheuli</title><meta name="robots" content="noindex">
<style>${FONTS}
:root{--forest:#1E3A2A;--linen:#F6F2E9;--ink:#1B261E;--muted:#55604F;--gold:#7D6224;--hair:#D9CFB6}
*{box-sizing:border-box}
body{margin:0;background:var(--linen);color:var(--ink);font-family:'Libre Baskerville',Georgia,serif;line-height:1.6}
header{background:var(--forest);color:var(--linen);padding:32px max(20px,env(safe-area-inset-left,0px)) 28px}
header .in,main{max-width:680px;margin:0 auto}
h1{margin:0;font-weight:400;font-style:italic;font-size:30px}
.sum{margin:6px 0 16px;color:#D3DACB;font-size:14px}
.links{display:flex;flex-wrap:wrap;gap:10px}
.links a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #D4B46A;color:var(--linen);text-decoration:none;font-size:14px}
.links a:hover{background:#24432F}
main{padding:12px max(20px,env(safe-area-inset-left,0px)) 56px}
article{padding:20px 0;border-bottom:1px solid var(--hair)}
.meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;font-size:14px}
.meta span{color:var(--muted);font-size:13px}
.flag{display:none;color:#8A2A1E;font-size:13px}
article p{margin:8px 0 12px;font-size:16px}
article button{min-height:40px;padding:0 14px;border:1px solid var(--gold);background:transparent;color:var(--ink);font:inherit;font-size:13px;cursor:pointer}
article button:hover{background:#EFE9DB}
article.off p,article.off .meta b{opacity:.45;text-decoration:line-through;text-decoration-thickness:1px}
article.off .flag{display:inline}
article.busy button{opacity:.5;cursor:wait}
.empty{color:var(--muted);padding:32px 0;text-align:center}
</style></head><body>
<header><div class="in">
  <h1>Notes for Sheuli</h1>
  <p class="sum"><span id="total">${notes.length}</span> notes · <span id="shown">${shown}</span> in the keepsake book</p>
  <div class="links"><a id="print-link" href="#">Open the printable book</a><a id="csv-link" href="#">Download spreadsheet</a></div>
</div></header>
<main>${cards || '<p class="empty">No notes yet. They will appear here as guests write them.</p>'}</main>
<script>
(function () {
  var key = new URLSearchParams(location.search).get('key') || '';
  document.getElementById('print-link').href = '/api/notes?key=' + encodeURIComponent(key);
  document.getElementById('csv-link').href = '/api/notes?key=' + encodeURIComponent(key) + '&format=csv';
  var shownEl = document.getElementById('shown');
  document.querySelectorAll('article').forEach(function (card) {
    var btn = card.querySelector('button');
    btn.addEventListener('click', function () {
      var hide = !card.classList.contains('off');
      card.classList.add('busy'); btn.disabled = true;
      fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: hide ? 'hide' : 'show', id: card.getAttribute('data-id'), key: key }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          card.classList.toggle('off', d.hidden);
          btn.textContent = d.hidden ? 'Show in the book' : 'Hide from the book';
          shownEl.textContent = document.querySelectorAll('article:not(.off)').length;
        })
        .catch(function () { btn.textContent = 'Couldn’t save. Tap to try again'; })
        .finally(function () { card.classList.remove('busy'); btn.disabled = false; });
    });
  });
})();
</script>
</body></html>`;
}
