// Adversarial checks: tries to break Poof the way an attacker would. Run against a LOCAL `wrangler dev`
// (it uses up creation limits on whatever server it targets, so never point it at production).
//   node test/attacks.mjs            (expects TEST_CREATES_PER_PERSON=5 in .dev.vars)
import * as C from '../src/client/crypto.js';

const B = process.env.BASE || 'http://localhost:8787';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(B)) { console.error('Refusing to run attacks against a non-local server.'); process.exit(2); }
const ip = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const O = { Origin: B, 'Content-Type': 'application/json' };
const res = [];
const check = (name, okay, detail = '') => res.push(`${okay ? 'BLOCKED ' : 'PROBLEM!'}  ${name}${detail ? `  (${detail})` : ''}`);
const post = (p, body, h = {}) => fetch(B + p, { method: 'POST', headers: { ...O, 'CF-Connecting-IP': ip(), ...h }, body: JSON.stringify(body) });
const ws = (url, protos, origin = B) => new Promise((r) => {
  const w = new WebSocket(url, { protocols: protos, headers: { Origin: origin } });
  w.onopen = () => { w.close(); r('OPEN'); };
  w.onerror = () => r('refused');
});

const A = {};

// 2. Cross-site request riding on a real login (CSRF)
{
  const r = await fetch(`${B}/chat/api/create`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  check('cross-site request (CSRF)', r.status === 403, `HTTP ${r.status}`);
}
// 3. Oversized and size-hiding bodies
{
  const r = await post('/secret/api/create', { text: 'x'.repeat(3_000_000) }, A);
  check('3 MB junk body to create', r.status === 400, `HTTP ${r.status}`);
  const s = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1000)); c.close(); } });
  const u = await fetch(`${B}/secret/api/s/AAAAAAAAAAAAAAAAAAAAAA/file/0`, { method: 'PUT', headers: { Origin: B }, body: s, duplex: 'half' });
  check('upload that hides its size (no Content-Length)', u.status === 411, `HTTP ${u.status}`);
}
// 4. Path / id trickery
for (const p of ['/secret/api/s/..%2F..%2Fchat', `/secret/api/s/${'A'.repeat(21)}!`, '/secret/api/s/AAAAAAAAAAAAAAAAAAAAAA/file/9',
  '/chat/api/r/AAAAAAAAAAAAAAAAAAAAAA/img/..%2Fdestroy', '/secret/assets/../../.dev.vars', '/secret/assets/app.js%00.txt']) {
  const r = await fetch(B + p);
  check(`weird path ${p}`, r.status === 404 || r.status === 400, `HTTP ${r.status}`);
}
// 5. Room: passphrase brute force with a leaked link; joining without proof; cross-site socket
{
  const link = C.newLinkKey();
  const { verifier } = await C.deriveKeys(link, 'correct horse');
  const { id } = await (await post('/chat/api/create', { verifier, hasPass: true, hours: 24 }, A)).json();
  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await post(`/chat/api/r/${id}/check`, { verifier: (await C.deriveKeys(link, `guess${i}`)).verifier })).status);
  const after = (await post(`/chat/api/r/${id}/check`, { verifier })).status;
  check('room passphrase guessing (14 tries)', statuses.filter((s) => s === 403).length === 10 && statuses.slice(10).every((s) => s === 429) && after === 429,
    `${statuses.join(',')}; then even the right pass -> ${after} for 15 min`);
  const wsUrl = `${B.replace('http', 'ws')}/chat/api/r/${id}/ws`;
  check('join chat with the verifier in the URL instead of the header', (await ws(`${wsUrl}?v=${verifier}`, [])) === 'refused');
  check('cross-site WebSocket', (await ws(wsUrl, ['poof', verifier], 'https://evil.example')) === 'refused');
  const g = await fetch(`${B}/chat/api/r/${id}/gifs?q=cat`, { headers: { 'X-Room-Verifier': 'x'.repeat(43) } });
  check('GIF search without being in the room', g.status === 429 || g.status === 403, `HTTP ${g.status}`);
}
// 6. Secret: forged tickets/tokens, views untouched, server holds only ciphertext
{
  const link = C.newLinkKey();
  const { key, verifier } = await C.deriveKeys(link);
  const { id, manage } = await (await post('/secret/api/create', { text: await C.sealText(key, 'top'), verifier, hasPass: false, maxViews: 3, hours: 10,
    files: [{ name: await C.sealText(key, '{}') }] }, A)).json();
  await fetch(`${B}/secret/api/s/${id}/file/0`, { method: 'PUT', headers: { Origin: B, 'X-Manage-Token': manage }, body: await C.seal(key, new Uint8Array(100)) });
  await fetch(`${B}/secret/api/s/${id}/finalize`, { method: 'POST', headers: { Origin: B, 'X-Manage-Token': manage } });
  const f = await fetch(`${B}/secret/api/s/${id}/file/0?t=AAAAAAAAAAAAAAAAAAAAAA`);
  check('download an attachment with a made-up ticket', f.status === 403, `HTTP ${f.status}`);
  const u = await fetch(`${B}/secret/api/s/${id}/file/0`, { method: 'PUT', headers: { Origin: B, 'X-Manage-Token': 'AAAAAAAAAAAAAAAAAAAAAA' }, body: new Uint8Array(100) });
  check('overwrite an attachment without the owner token', u.status === 404, `HTTP ${u.status}`);
  const d = await post(`/secret/api/s/${id}/destroy`, {}, { 'X-Manage-Token': 'AAAAAAAAAAAAAAAAAAAAAA' });
  check('delete someone else\'s poof', d.status === 404, `HTTP ${d.status}`);
  const info = await (await fetch(`${B}/secret/api/s/${id}`)).json();
  check('views untouched by all of the above', info.viewsLeft === 3, `viewsLeft ${info.viewsLeft}`);
  const stored = await (await post(`/secret/api/s/${id}/open`, { verifier })).json();
  check('server copy is ciphertext (no plaintext "top")', !JSON.stringify(stored).includes('top'));
}
// 7. Oversized photo
{
  const { verifier } = await C.deriveKeys(C.newLinkKey());
  const { id } = await (await post('/chat/api/create', { verifier, hasPass: false, hours: 24 }, A)).json();
  const big = await fetch(`${B}/chat/api/r/${id}/img`, { method: 'PUT', headers: { Origin: B, 'X-Room-Verifier': verifier }, body: new Uint8Array(6 * 1024 * 1024) });
  check('6 MB photo upload', big.status === 413, `HTTP ${big.status}`);
}
// 8. Security headers, and Giphy allowed only on chat-room pages
{
  const h = (await fetch(`${B}/secret`)).headers;
  for (const k of ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'referrer-policy', 'x-content-type-options', 'cross-origin-opener-policy', 'permissions-policy']) {
    check(`header ${k}`, !!h.get(k));
  }
  check('secret pages may not load Giphy images', !/giphy/.test(h.get('content-security-policy')));
}
// 9. Creation flood from one address: 40 rooms at once, then someone else
{
  const { verifier } = await C.deriveKeys(C.newLinkKey());
  const flooder = '203.0.113.99';
  const s = (await Promise.all(Array.from({ length: 40 }, () => post('/chat/api/create', { verifier, hasPass: false, hours: 24 }, { 'CF-Connecting-IP': flooder })))).map((r) => r.status);
  const made = s.filter((x) => x === 200).length;
  const other = (await post('/chat/api/create', { verifier, hasPass: false, hours: 24 })).status;
  check('40 simultaneous room creations from one address', made <= 5 && s.filter((x) => x === 429).length >= 35 && other === 200,
    `${made} created, ${s.filter((x) => x === 429).length} refused; someone else -> ${other}`);
}
console.log(res.join('\n'));
const bad = res.filter((r) => r.startsWith('PROBLEM')).length;
console.log(`\n${res.length - bad} blocked, ${bad} problems`);
process.exit(bad ? 1 : 0);
