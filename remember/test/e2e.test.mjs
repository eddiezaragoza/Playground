// Full flow against `npm run dev` (needs .dev.vars from .dev.vars.example: ADMIN_KEY=test-family-password, UPLOADS_PER_PERSON=12).
// Run: npm run dev   (in another terminal)   then: npm run test:e2e
// Each run uses fresh addresses (CF-Connecting-IP) so the daily counters from earlier runs don't get in the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = process.env.BASE_URL || 'http://localhost:8787';
const B = `${ORIGIN}/vicky`;
const PASSWORD = 'test-family-password';
const run = Math.floor(Math.random() * 200) + 20;
const ip = (n) => `10.${run}.0.${n}`;

const JPEG = (n = 2000) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const PNG = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function upload({ photo = JPEG(), thumb, name = '', note = '', from = ip(1), origin = ORIGIN } = {}) {
  const f = new FormData();
  f.append('photo', new Blob([photo]), 'p.jpg');
  if (thumb) f.append('thumb', new Blob([thumb]), 't.jpg');
  f.append('name', name);
  f.append('note', note);
  const res = await fetch(`${B}/api/upload`, { method: 'POST', body: f, headers: { Origin: origin, 'CF-Connecting-IP': from } });
  return { status: res.status, body: await res.json() };
}

let cookie = '';
async function admin(path, body, method = 'POST') {
  const res = await fetch(`${B}${path}`, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(99) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const state = () => admin('/api/admin', null, 'GET').then((r) => r.body);

test('pages render and unknown paths 404', async () => {
  for (const p of ['', '/', '/show', '/admin', '/card']) {
    const r = await fetch(B + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await fetch(`${ORIGIN}/vickyx`)).status, 404);
  assert.equal((await fetch(`${B}/nope`)).status, 404);
  const qr = await fetch(`${B}/qr.svg`);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /^<svg/);
});

test('admin login: wrong password refused, right one sets a cookie', async () => {
  let r = await fetch(`${B}/api/admin`);
  assert.equal(r.status, 401);
  r = await fetch(`${B}/api/login`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(98) }, body: JSON.stringify({ password: 'nope' }) });
  assert.equal(r.status, 401);
  r = await fetch(`${B}/api/login`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(r.status, 403, 'cross-site login refused');
  r = await fetch(`${B}/api/login`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(98) }, body: JSON.stringify({ password: ` ${PASSWORD} ` }) });
  assert.equal(r.status, 200);
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.match(set, /Path=\/vicky/);
  cookie = set.split(';')[0];
  const s = await state();
  assert.ok(s.showKey && s.showKey.length === 43);
  // a forged cookie is not an admin
  r = await fetch(`${B}/api/admin`, { headers: { Cookie: 'remember_admin=' + 'A'.repeat(43) } });
  assert.equal(r.status, 401);
  // make sure approval is off for the next tests
  await admin('/api/settings', { approval: false });
});

test('guests upload photos; the slideshow sees them with name and note', async () => {
  const { showKey } = await state();
  const a = await upload({ name: 'Aunt Linda', note: 'Lake Tahoe, 1987 <3', thumb: JPEG(300) });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.status, 'live');
  const b = await upload({ photo: PNG(), name: '', note: '' });
  assert.equal(b.status, 200);

  let r = await fetch(`${B}/api/show`);
  assert.equal(r.status, 403, 'slideshow data needs the key');
  r = await fetch(`${B}/api/show`, { headers: { 'X-Show-Key': 'x'.repeat(43) } });
  assert.equal(r.status, 403);
  r = await fetch(`${B}/api/show`, { headers: { 'X-Show-Key': showKey } });
  assert.equal(r.status, 200);
  const show = await r.json();
  const pa = show.photos.find((p) => p.id === a.body.id);
  assert.equal(pa.name, 'Aunt Linda');
  assert.equal(pa.note, 'Lake Tahoe, 1987 <3');
  assert.ok(show.photos.find((p) => p.id === b.body.id));

  r = await fetch(`${B}/p/${a.body.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal((await r.arrayBuffer()).byteLength, 2000);
  r = await fetch(`${B}/t/${a.body.id}`);
  assert.equal((await r.arrayBuffer()).byteLength, 300, 'preview served');
  r = await fetch(`${B}/t/${b.body.id}`);
  assert.equal(r.headers.get('content-type'), 'image/png', 'no preview: falls back to the photo');
});

test('big photos are stored in chunks and come back byte-for-byte', async () => {
  const big = JPEG(3.5 * 1024 * 1024);
  for (let i = 4; i < big.length; i += 997) big[i] = i % 251;
  const r = await upload({ photo: big, from: ip(2) });
  assert.equal(r.status, 200);
  const back = new Uint8Array(await (await fetch(`${B}/p/${r.body.id}`)).arrayBuffer());
  assert.equal(back.length, big.length);
  assert.ok(back.every((v, i) => v === big[i]));
});

test('uploads that are not photos, too big, or from other sites are refused', async () => {
  let r = await upload({ photo: new TextEncoder().encode('<html><script>alert(1)</script>') });
  assert.equal(r.status, 415);
  r = await upload({ photo: new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]) }); // HEIC header
  assert.equal(r.status, 415);
  r = await upload({ photo: JPEG(11.5 * 1024 * 1024) });
  assert.equal(r.status, 413);
  r = await upload({ origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const res = await fetch(`${B}/api/upload`, { method: 'PUT', headers: { Origin: ORIGIN } });
  assert.equal(res.status, 405);
});

test('names and notes are cleaned and capped', async () => {
  const r = await upload({ name: 'x'.repeat(200) + '\u0000', note: 'y'.repeat(900), from: ip(3) });
  const p = (await state()).photos.find((x) => x.id === r.body.id);
  assert.equal(p.name.length, 60);
  assert.equal(p.note.length, 500);
});

test('hiding a photo takes it out of the slideshow; admins can still see it; delete removes it', async () => {
  const r = await upload({ name: 'Hide me', from: ip(4) });
  const id = r.body.id;
  assert.equal((await admin(`/api/photo/${id}`, { status: 'hidden' })).status, 200);
  const { showKey } = await state();
  const show = await (await fetch(`${B}/api/show`, { headers: { 'X-Show-Key': showKey } })).json();
  assert.ok(!show.photos.some((p) => p.id === id));
  assert.equal((await fetch(`${B}/p/${id}`)).status, 404, 'hidden photo not served to guests');
  assert.equal((await fetch(`${B}/p/${id}`, { headers: { Cookie: cookie } })).status, 200, 'admin still sees it');
  assert.equal((await admin(`/api/photo/${id}`, { status: 'bogus' })).status, 404);
  assert.equal((await admin(`/api/photo/${id}`, { action: 'delete' })).status, 200);
  assert.equal((await fetch(`${B}/p/${id}`, { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await admin(`/api/photo/${id}`, { action: 'delete' })).status, 404);
  // admin actions need the cookie and our own origin
  let res = await fetch(`${B}/api/photo/${'a'.repeat(32)}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{"action":"delete"}' });
  assert.equal(res.status, 401);
  res = await fetch(`${B}/api/photo/${'a'.repeat(32)}`, { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"action":"delete"}' });
  assert.equal(res.status, 403);
});

test('approval mode: new photos wait until the family approves them', async () => {
  await admin('/api/settings', { approval: true });
  const r = await upload({ name: 'Needs approval', from: ip(5) });
  assert.equal(r.body.status, 'pending');
  const { showKey } = await state();
  let show = await (await fetch(`${B}/api/show`, { headers: { 'X-Show-Key': showKey } })).json();
  assert.ok(!show.photos.some((p) => p.id === r.body.id));
  await admin(`/api/photo/${r.body.id}`, { status: 'live' });
  show = await (await fetch(`${B}/api/show`, { headers: { 'X-Show-Key': showKey } })).json();
  assert.ok(show.photos.some((p) => p.id === r.body.id));
  await admin('/api/settings', { approval: false });
});

test('settings show on the pages and are escaped', async () => {
  const s = await admin('/api/settings', { name: 'Vicky <b>', subtitle: '1958 – 2026 · "Celebration" of Life', intro: '' });
  assert.equal(s.status, 200);
  const html = await (await fetch(B)).text();
  assert.match(html, /<h1>Vicky &lt;b&gt;<\/h1>/);
  assert.match(html, /&quot;Celebration&quot;/);
  assert.match(html, /Share your favorite photos of Vicky &lt;b&gt;/, 'empty message falls back to the default');
  await admin('/api/settings', { name: 'Vicky', subtitle: 'Celebration of Life' });
});

test('cover photo: set, served, removed', async () => {
  const f = new FormData();
  f.append('photo', new Blob([JPEG(5000)]), 'c.jpg');
  let r = await fetch(`${B}/api/cover`, { method: 'POST', body: f, headers: { Origin: ORIGIN, Cookie: cookie } });
  assert.equal(r.status, 200);
  const { settings } = await r.json();
  assert.ok(settings.coverVersion);
  assert.match(await (await fetch(B)).text(), /data-cover="\/vicky\/cover\?v=\d+"/);
  assert.equal((await (await fetch(`${B}/cover`)).arrayBuffer()).byteLength, 5000);
  assert.ok(!(await state()).photos.some((p) => p.id === '_cover'), 'cover is not one of the photos');
  const rm = new FormData();
  rm.append('remove', '1');
  r = await fetch(`${B}/api/cover`, { method: 'POST', body: rm, headers: { Origin: ORIGIN, Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${B}/cover`)).status, 404);
  // guests can't set the cover
  r = await fetch(`${B}/api/cover`, { method: 'POST', body: f, headers: { Origin: ORIGIN } });
  assert.equal(r.status, 401);
});

test('one person is limited per day (12 in the test setup), others are not', async () => {
  const who = ip(6);
  let last;
  for (let i = 0; i < 13; i++) last = await upload({ from: who, photo: JPEG(100) });
  assert.equal(last.status, 429);
  assert.match(last.body.error, /tomorrow/);
  assert.equal((await upload({ from: ip(7), photo: JPEG(100) })).status, 200);
});

test('logout clears the cookie', async () => {
  const r = await admin('/api/logout', {});
  assert.match(r.status === 200 ? 'ok' : '', /ok/);
});
