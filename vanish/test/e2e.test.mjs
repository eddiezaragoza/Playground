// End-to-end test against a running `wrangler dev` (default http://localhost:8787).
// Needs .dev.vars with CREATE_CODE=test-code-123 and TEST_HOUR_MS=4000 (one "hour" = 4 seconds).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/client/crypto.js';

const BASE = process.env.BASE || 'http://localhost:8787';
const CODE = process.env.CODE || 'test-code-123';
const HOUR = Number(process.env.HOUR_MS || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
async function call(path, { method = 'GET', body, headers = {}, origin = BASE, auth = true } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (auth && cookie) h.Cookie = cookie;
  let payload;
  if (body instanceof Uint8Array) { payload = body; h['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data, res };
}

async function makeSecret({ text = 'p@ssw0rd!', pass = '', maxViews = 2, hours = 100, files = [] } = {}) {
  const linkKey = C.newLinkKey();
  const { key, verifier } = await C.deriveKeys(linkKey, pass);
  const names = await Promise.all(files.map((f) => C.sealJson(key, { name: f.name, type: 'application/octet-stream' })));
  const r = await call('/secret/api/create', {
    method: 'POST', body: { text: await C.sealText(key, text), verifier, hasPass: !!pass, maxViews, hours, files: names.map((name) => ({ name })) },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const { id, manage } = r.data;
  for (let i = 0; i < files.length; i++) {
    const up = await call(`/secret/api/s/${id}/file/${i}`, { method: 'PUT', body: await C.seal(key, files[i].bytes), headers: { 'X-Manage-Token': manage } });
    assert.equal(up.status, 200, JSON.stringify(up.data));
  }
  const fin = await call(`/secret/api/s/${id}/finalize`, { method: 'POST', headers: { 'X-Manage-Token': manage } });
  assert.equal(fin.status, 200);
  return { id, manage, linkKey, key, verifier };
}

test('pages and assets are served with a strict CSP', async () => {
  const r = await fetch(`${BASE}/secret`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Security-Policy'), /script-src 'self'/);
  assert.match(await r.text(), /data-page="login"/);
  assert.equal((await fetch(`${BASE}/secret/assets/app.js`)).status, 200);
  assert.equal((await fetch(`${BASE}/secret/s/AAAAAAAAAAAAAAAAAAAAAA`)).status, 200); // viewer page needs no login
  assert.equal((await fetch(`${BASE}/nope`)).status, 404);
});

test('login: wrong code refused, right code gives a cookie, create needs it', async () => {
  assert.equal((await call('/secret/api/login', { method: 'POST', body: { code: 'nope' } })).status, 401);
  const noAuth = await call('/secret/api/create', { method: 'POST', body: {}, auth: false });
  assert.equal(noAuth.status, 401);
  const bad = await call('/secret/api/login', { method: 'POST', body: { code: CODE }, origin: 'https://evil.example' });
  assert.equal(bad.status, 403, 'cross-origin POST must be refused');
  const r = await call('/secret/api/login', { method: 'POST', body: { code: CODE } });
  assert.equal(r.status, 200);
  cookie = r.res.headers.get('Set-Cookie').split(';')[0];
  assert.match(cookie, /^vanish_session=\d+\.[0-9a-f]{64}$/);
  const page = await fetch(`${BASE}/secret`, { headers: { Cookie: cookie } });
  assert.match(await page.text(), /data-page="create-secret"/);
});

test('secret with passphrase + attachment: wrong pass costs no view, views count down, then it is gone', async () => {
  const fileBytes = new Uint8Array(2.5 * 1024 * 1024); // spans 3 storage chunks
  for (let i = 0; i < fileBytes.length; i += 65536) crypto.getRandomValues(fileBytes.subarray(i, i + 65536));
  const s = await makeSecret({ pass: 'blue-horse', maxViews: 2, files: [{ name: 'creds.txt', bytes: fileBytes }] });

  let info = await call(`/secret/api/s/${s.id}`, { auth: false });
  assert.deepEqual({ ...info.data, expiresAt: 0 }, { hasPass: true, viewsLeft: 2, expiresAt: 0, files: 1 });

  const wrong = await C.deriveKeys(s.linkKey, 'blue-house');
  const w = await call(`/secret/api/s/${s.id}/open`, { method: 'POST', body: { verifier: wrong.verifier }, auth: false });
  assert.equal(w.status, 403);
  assert.equal(w.data.triesLeft, 4);
  info = await call(`/secret/api/s/${s.id}`, { auth: false });
  assert.equal(info.data.viewsLeft, 2, 'a wrong passphrase must not use a view');

  const o1 = await call(`/secret/api/s/${s.id}/open`, { method: 'POST', body: { verifier: s.verifier }, auth: false });
  assert.equal(o1.status, 200);
  assert.equal(await C.unsealText(s.key, o1.data.text), 'p@ssw0rd!');
  assert.equal(o1.data.viewsLeft, 1);
  assert.deepEqual(await C.unsealJson(s.key, o1.data.files[0].name), { name: 'creds.txt', type: 'application/octet-stream' });
  const f1 = await call(`/secret/api/s/${s.id}/file/0?t=${o1.data.ticket}`, { auth: false });
  assert.equal(f1.status, 200);
  assert.deepEqual(await C.unseal(s.key, f1.data), fileBytes);

  const badTicket = await call(`/secret/api/s/${s.id}/file/0?t=__proto__`, { auth: false });
  assert.equal(badTicket.status, 403);

  const o2 = await call(`/secret/api/s/${s.id}/open`, { method: 'POST', body: { verifier: s.verifier }, auth: false });
  assert.equal(o2.data.viewsLeft, 0);
  assert.equal((await call(`/secret/api/s/${s.id}`, { auth: false })).status, 404, 'gone after last view');
  assert.equal((await call(`/secret/api/s/${s.id}/open`, { method: 'POST', body: { verifier: s.verifier }, auth: false })).status, 404);
  const late = await call(`/secret/api/s/${s.id}/file/0?t=${o2.data.ticket}`, { auth: false });
  assert.equal(late.status, 200, 'last viewer can still download attachments during the grace period');
});

test('five wrong passphrases destroy it', async () => {
  const s = await makeSecret({ pass: 'right' });
  const wrong = await C.deriveKeys(s.linkKey, 'wrong');
  let r;
  for (let i = 0; i < 5; i++) r = await call(`/secret/api/s/${s.id}/open`, { method: 'POST', body: { verifier: wrong.verifier }, auth: false });
  assert.equal(r.status, 410);
  assert.equal((await call(`/secret/api/s/${s.id}`, { auth: false })).status, 404);
});

test('one-view secret: simultaneous opens, exactly one wins', async () => {
  const s = await makeSecret({ maxViews: 1 });
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    call(`/secret/api/s/${s.id}/open`, { method: 'POST', body: { verifier: s.verifier }, auth: false })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
});

test('expires on time', async () => {
  const s = await makeSecret({ hours: 1 }); // 1 test "hour"
  assert.equal((await call(`/secret/api/s/${s.id}`, { auth: false })).status, 200);
  await sleep(HOUR + 1500);
  assert.equal((await call(`/secret/api/s/${s.id}`, { auth: false })).status, 404);
});

test('unfinished upload is not viewable; creator can delete; validation rejects junk', async () => {
  const linkKey = C.newLinkKey();
  const { key, verifier } = await C.deriveKeys(linkKey);
  const r = await call('/secret/api/create', {
    method: 'POST', body: { text: await C.sealText(key, 'x'), verifier, hasPass: false, maxViews: 1, hours: 100, files: [{ name: 'abc' }] },
  });
  assert.equal((await call(`/secret/api/s/${r.data.id}`, { auth: false })).status, 404, 'pending is hidden');
  assert.equal((await call(`/secret/api/s/${r.data.id}/finalize`, { method: 'POST', headers: { 'X-Manage-Token': r.data.manage } })).status, 400);

  const s = await makeSecret();
  assert.equal((await call(`/secret/api/s/${s.id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': 'AAAAAAAAAAAAAAAAAAAAAA' } })).status, 404);
  assert.equal((await call(`/secret/api/s/${s.id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': s.manage } })).status, 200);
  assert.equal((await call(`/secret/api/s/${s.id}`, { auth: false })).status, 404);

  for (const body of [{}, { text: 'x', verifier: 'short', hasPass: false, maxViews: 1, hours: 1, files: [] },
    { text: 'x', verifier, hasPass: false, maxViews: 21, hours: 1, files: [] },
    { text: 'x', verifier, hasPass: false, maxViews: 1, hours: 1, files: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }]) {
    assert.equal((await call('/secret/api/create', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
});

// ---------- chat ----------
function socket(id, verifier, origin = BASE) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/chat/api/r/${id}/ws`, { protocols: ['poof', verifier], headers: { Origin: origin } });
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    const m = ev.data === 'pong' ? { type: 'pong' } : JSON.parse(ev.data);
    inbox.push(m);
    waiters.splice(0).forEach((w) => w());
  });
  ws.next = async (type, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      if (Date.now() > end) throw new Error(`timed out waiting for ${type}`);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 200); });
    }
  };
  ws.ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.closed = new Promise((res) => ws.addEventListener('close', res));
  return ws;
}

test('chat: two people exchange encrypted messages, history, presence, delete', async () => {
  const linkKey = C.newLinkKey();
  const { key, verifier } = await C.deriveKeys(linkKey, 'pw');
  const r = await call('/chat/api/create', { method: 'POST', body: { verifier, hasPass: true, hours: 24 } });
  assert.equal(r.status, 200);
  const { id, manage } = r.data;
  assert.equal((await call(`/chat/api/create`, { method: 'POST', body: { verifier, hasPass: true, hours: 24 }, auth: false })).status, 401);

  const info = await call(`/chat/api/r/${id}`, { auth: false });
  assert.equal(info.data.hasPass, true);
  const wrong = await C.deriveKeys(linkKey, 'nope');
  assert.equal((await call(`/chat/api/r/${id}/check`, { method: 'POST', body: { verifier: wrong.verifier }, auth: false })).status, 403);
  assert.equal((await call(`/chat/api/r/${id}/check`, { method: 'POST', body: { verifier }, auth: false })).status, 200);

  const a = socket(id, verifier);
  const b = socket(id, verifier);
  await Promise.all([a.ready, b.ready]);
  assert.deepEqual((await a.next('history')).msgs, []);
  await b.next('history');
  a.send(JSON.stringify({ type: 'hello', data: await C.sealJson(key, { n: 'Eddie', s: 'a' }) }));
  b.send(JSON.stringify({ type: 'hello', data: await C.sealJson(key, { n: 'Sam', s: 'b' }) }));
  let pres;
  for (let i = 0; i < 6; i++) { pres = await b.next('presence'); if (pres.list.length === 2) break; }
  const names = await Promise.all(pres.list.map(async (h) => (await C.unsealJson(key, h)).n));
  assert.deepEqual(names.sort(), ['Eddie', 'Sam']);

  a.send(JSON.stringify({ type: 'msg', data: await C.sealJson(key, { n: 'Eddie', s: 'a', t: 'hey <b>there</b>' }) }));
  const got = await b.next('msg');
  assert.equal((await C.unsealJson(key, got.data)).t, 'hey <b>there</b>');
  await a.next('msg'); // sender gets its own echo

  a.send('ping');
  await a.next('pong');

  const c = socket(id, verifier);
  await c.ready;
  const hist = await c.next('history');
  assert.equal(hist.msgs.length, 1);
  assert.equal((await C.unsealJson(key, hist.msgs[0].data)).t, 'hey <b>there</b>');

  // Wrong verifier and wrong origin can't join.
  const bad = socket(id, wrong.verifier);
  await assert.rejects(bad.ready);
  const evil = socket(id, verifier, 'https://evil.example');
  await assert.rejects(evil.ready);

  // Rate limit kicks in.
  for (let i = 0; i < 25; i++) c.send(JSON.stringify({ type: 'msg', data: 'x' }));
  assert.equal((await c.next('error')).error, 'Slow down a little.');

  await new Promise((r) => setTimeout(r, 10500)); // let c's rate-limit window clear
  // Reactions: relayed, stored, included in history; a reaction to a message that doesn't exist is ignored.
  c.send(JSON.stringify({ type: 'react', target: got.id, data: await C.sealJson(key, { s: 'b', n: 'Sam', e: '👍', on: true }) }));
  const r1 = await a.next('react');
  assert.equal(r1.target, got.id);
  assert.deepEqual(await C.unsealJson(key, r1.data), { s: 'b', n: 'Sam', e: '👍', on: true });
  c.send(JSON.stringify({ type: 'react', target: 999999, data: 'x' }));
  const d = socket(id, verifier);
  await d.ready;
  const h2 = await d.next('history');
  assert.equal(h2.reacts.length, 1, 'history carries reactions; bogus target ignored');
  assert.equal(h2.reacts[0].target, got.id);
  d.close();

  // Deleting closes everyone with code 4001.
  const del = await call(`/chat/api/r/${id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': manage }, auth: false });
  assert.equal(del.status, 200);
  const closes = await Promise.all([a.closed, b.closed, c.closed]);
  assert.deepEqual(closes.map((e) => e.code), [4001, 4001, 4001]);
  assert.equal((await call(`/chat/api/r/${id}`, { auth: false })).status, 404);
});

test('chat photos: encrypted upload/download, key required, size cap, oldest evicted past the limit', async () => {
  const linkKey = C.newLinkKey();
  const { key, verifier } = await C.deriveKeys(linkKey);
  const { id } = (await call('/chat/api/create', { method: 'POST', body: { verifier, hasPass: false, hours: 24 } })).data;
  const photo = new Uint8Array(1.5 * 1024 * 1024); // spans 2 storage rows
  for (let i = 0; i < photo.length; i += 65536) crypto.getRandomValues(photo.subarray(i, i + 65536));
  const sealed = await C.seal(key, photo);
  const put = (body, v = verifier, origin = BASE) =>
    call(`/chat/api/r/${id}/img`, { method: 'PUT', body, headers: { 'X-Room-Verifier': v }, auth: false, origin });

  const wrong = await C.deriveKeys(C.newLinkKey());
  assert.equal((await put(sealed, wrong.verifier)).status, 403, 'needs the room key');
  assert.equal((await put(sealed, verifier, 'https://evil.example')).status, 403, 'cross-site upload refused');
  assert.equal((await put(new Uint8Array(2.5 * 1024 * 1024 + 100))).status, 413, 'too big refused');

  const up = await put(sealed);
  assert.equal(up.status, 200);
  const imgId = up.data.id;
  const get = (v = verifier, i = imgId) => call(`/chat/api/r/${id}/img/${i}`, { headers: { 'X-Room-Verifier': v }, auth: false, origin: null });
  assert.equal((await get(wrong.verifier)).status, 403);
  const got = await get();
  assert.equal(got.status, 200);
  assert.ok(!Buffer.from(got.data).includes(Buffer.from(photo.subarray(0, 64))), 'server copy is not the plain photo');
  assert.deepEqual(await C.unseal(key, got.data), photo);

  // Fill past the 150-photo cap with tiny photos: the first (big) one is evicted.
  const tiny = await C.seal(key, new Uint8Array(10));
  for (let i = 0; i < 150; i++) assert.equal((await put(tiny)).status, 200);
  assert.equal((await get()).status, 404, 'oldest photo evicted');

  // Upload rate limit (TEST_ROOM_UPLOADS=200 locally, 30 in production): keep going until refused.
  let last;
  for (let i = 0; i < 60; i++) { last = await put(tiny); if (last.status !== 200) break; }
  assert.equal(last.status, 429, 'photo flood is refused');
});
