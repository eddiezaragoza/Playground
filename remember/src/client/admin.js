// Family page: sign in, edit the page, set the cover, approve/hide/delete photos, download everything.
import { BASE, api, postJson, renderCover, shrink } from './shared.js';

const $ = (id) => document.getElementById(id);
let state = null;
let filter = 'all';

async function refresh() {
  try {
    state = await api('/api/admin');
  } catch (e) {
    if (e.status === 401) { $('login').hidden = false; $('panel').hidden = true; $('logout').hidden = true; return; }
    alert(e.message);
    return;
  }
  $('login').hidden = true;
  $('panel').hidden = false;
  $('logout').hidden = false;
  render();
}

function render() {
  const { settings, stats, guestUrl, showKey } = state;
  const mb = (stats.bytes / 1048576).toFixed(0);
  $('stats').innerHTML = '';
  for (const [n, label] of [[stats.photos, 'photos shared'], [stats.pending, 'waiting for you'], [stats.hidden, 'hidden'], [`${mb} MB`, 'of 3,000 MB used']]) {
    const d = document.createElement('div');
    d.innerHTML = '<strong></strong><span></span>';
    d.querySelector('strong').textContent = n;
    d.querySelector('span').textContent = label;
    $('stats').append(d);
  }
  $('guest-url').textContent = guestUrl;
  $('open-show').href = `${BASE}/show#${showKey}`;
  if (document.activeElement?.closest('#settings-form') == null) {
    $('s-name').value = settings.name;
    $('s-subtitle').value = settings.subtitle;
    $('s-intro').value = settings.intro;
    $('s-approval').checked = settings.approval;
  }
  const cp = $('cover-preview');
  cp.dataset.cover = settings.coverVersion ? `${BASE}/cover?v=${settings.coverVersion}` : '';
  renderCover(cp);
  renderGrid();
}

function renderGrid() {
  const grid = $('grid');
  grid.textContent = '';
  const list = state.photos.filter((p) => filter === 'all' || p.status === filter);
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = filter === 'all' ? 'No photos yet. Share the guest link and they will show up here.' : 'Nothing here.';
    grid.append(p);
    return;
  }
  for (const p of list) {
    const fig = document.createElement('figure');
    fig.className = `tile ${p.status}`;
    fig.innerHTML = `<a target="_blank" rel="noopener"><img loading="lazy" alt=""></a><figcaption><b></b><span class="when"></span><span class="note"></span></figcaption><div class="actions"></div>`;
    fig.querySelector('a').href = `${BASE}/p/${p.id}`;
    fig.querySelector('img').src = `${BASE}/t/${p.id}`;
    fig.querySelector('b').textContent = p.name || 'Someone';
    fig.querySelector('.when').textContent = new Date(p.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    fig.querySelector('.note').textContent = p.note;
    const actions = fig.querySelector('.actions');
    const add = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `button tiny ${cls}`;
      b.textContent = label;
      b.onclick = async () => { b.disabled = true; try { await fn(); await refresh(); } catch (e) { alert(e.message); b.disabled = false; } };
      actions.append(b);
    };
    if (p.status === 'pending') add('Approve', () => postJson(`/api/photo/${p.id}`, { status: 'live' }));
    if (p.status === 'hidden') add('Show again', () => postJson(`/api/photo/${p.id}`, { status: 'live' }));
    if (p.status !== 'hidden') add('Hide', () => postJson(`/api/photo/${p.id}`, { status: 'hidden' }), 'secondary');
    add('Delete', async () => {
      if (!confirm('Delete this photo for good? This cannot be undone.')) throw new Error('Not deleted.');
      await postJson(`/api/photo/${p.id}`, { action: 'delete' });
    }, 'danger');
    if (p.status !== 'live') {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = p.status === 'pending' ? 'Waiting for you' : 'Hidden';
      fig.prepend(tag);
    }
    grid.append(fig);
  }
}

// ---------- sign in / out ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await postJson('/api/login', { password: $('password').value });
    $('password').value = '';
    refresh();
  } catch (err) { $('login-error').textContent = err.message; }
});
$('logout').addEventListener('click', async () => { await postJson('/api/logout', {}); location.reload(); });

// ---------- links ----------
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = t; }, 1500); } catch { prompt('Copy this link:', text); }
}
$('copy-guest').addEventListener('click', (e) => copy(state.guestUrl, e.target));
$('copy-show').addEventListener('click', (e) => copy(`${location.origin}${BASE}/show#${state.showKey}`, e.target));

// ---------- settings ----------
$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await postJson('/api/settings', {
      name: $('s-name').value, subtitle: $('s-subtitle').value, intro: $('s-intro').value, approval: $('s-approval').checked,
    });
    state.settings = r.settings;
    $('saved').textContent = 'Saved ✓';
    setTimeout(() => { $('saved').textContent = ''; }, 2000);
    document.activeElement?.blur();
    refresh();
  } catch (err) { alert(err.message); }
});

$('cover-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const small = await shrink(file, 1600, 0.9);
  const form = new FormData();
  form.append('photo', small ? small.photo : file, 'cover.jpg');
  try { await api('/api/cover', { method: 'POST', body: form }); refresh(); } catch (err) { alert(err.message); }
});
$('cover-remove').addEventListener('click', async () => {
  if (!confirm('Remove the cover photo?')) return;
  const form = new FormData();
  form.append('remove', '1');
  try { await api('/api/cover', { method: 'POST', body: form }); refresh(); } catch (err) { alert(err.message); }
});

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    for (const o of document.querySelectorAll('.tabs button')) o.classList.toggle('on', o === b);
    renderGrid();
  });
}

// ---------- download everything as .zip files ----------
// Photos are already compressed, so the zip just stores them (no extra squeezing): fast, and no library needed.
// Big albums are split into parts so a phone or older laptop doesn't run out of memory.
const PART_BYTES = 400 * 1048576;
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function makeZip(files) { // files: [{ name, data: Uint8Array, date: Date }]
  const te = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = te.encode(f.name);
    const crc = crc32(f.data);
    const d = f.date;
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(local, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, p) => a + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const safeName = (s) => (s || 'someone').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 30) || 'someone';
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

$('download').addEventListener('click', async (e) => {
  const btn = e.target;
  const list = [...state.photos].sort((a, b) => a.ts - b.ts); // oldest first, numbered in the order they were shared
  if (!list.length) return alert('No photos yet.');
  btn.disabled = true;
  const status = $('download-status');
  const slug = BASE.slice(1);
  const rows = [['File', 'Shared by', 'Note', 'Shared at', 'Status']];
  let batch = [];
  let batchBytes = 0;
  let part = 1;
  const flush = (last) => {
    if (!batch.length) return;
    if (last) batch.push({ name: 'memories.csv', data: new TextEncoder().encode('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')), date: new Date() });
    const multi = !(last && part === 1);
    saveBlob(makeZip(batch), multi ? `${slug}-photos-part-${part}.zip` : `${slug}-photos.zip`);
    part++;
    batch = [];
    batchBytes = 0;
  };
  try {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      status.textContent = `Getting photo ${i + 1} of ${list.length}…`;
      const res = await fetch(`${BASE}/p/${p.id}`, { credentials: 'same-origin' });
      if (!res.ok) continue;
      const type = res.headers.get('Content-Type') || 'image/jpeg';
      const data = new Uint8Array(await res.arrayBuffer());
      const when = new Date(p.ts);
      const file = `${String(i + 1).padStart(4, '0')}-${safeName(p.name)}.${EXT[type] || 'jpg'}`;
      rows.push([file, p.name, p.note, when.toLocaleString(), p.status]);
      if (batchBytes + data.length > PART_BYTES) flush(false);
      batch.push({ name: file, data, date: when });
      batchBytes += data.length;
    }
    flush(true);
    status.textContent = part > 2 ? `Done. Saved in ${part - 1} parts (the last one also has memories.csv with everyone's notes).` : "Done. The zip also has memories.csv with everyone's notes.";
  } catch (err) {
    status.textContent = `Download stopped: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

refresh();
