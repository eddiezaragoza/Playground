// Adversarial checks: tries to break Poof the way an attacker would. Run against a LOCAL `wrangler dev`
// (it locks the login for the rest of the UTC day on whatever server it targets, so never point it at production).
//   node test/attacks.mjs            (expects CREATE_CODE=test-code-123 in .dev.vars)
import * as C from '../src/client/crypto.js';

const B = process.env.BASE || 'http://localhost:8787';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(B)) { console.error('Refusing to run attacks against a non-local server.'); process.exit(2); }
const CODE = process.env.CODE || 'test-code-123';
const O = { Origin: B, 'Content-Type': 'application/json' };
const res = [];
const check = (name, okay, detail = '') => res.push(`${okay ? 'BLOCKED ' : 'PROBLEM!'}  ${name}${detail ? `  (${detail})` : ''}`);
const post = (p, body, h = {}) => fetch(B + p, { method: 'POST', headers: { ...O, ...h }, body: JSON.stringify(body) });
const ws = (url, protos, origin = B) => new Promise((r) => {
  const w = new WebSocket(url, { protocols: protos, headers: { Origin: origin } });
  w.onopen = () => { w.close(); r('OPEN'); };
  w.onerror = () => r('refused');
});

const lg = await post('/secret/api/login', { code: CODE });
if (lg.status !== 200) { console.error(`Login failed (${lg.status}); is the server fresh and CREATE_CODE=${CODE}?`); process.exit(2); }
const cookie = lg.headers.get('set-cookie').split(';')[0];
const A = { Cookie: cookie };

// 1. Forged / tampered / expired login cookies
for (const c of [`vanish_session=9999999999999.${'a'.repeat(64)}`, cookie.replace(/.$/, (x) => (x === 'a' ? 'b' : 'a')), `vanish_session=1.${cookie.split('.')[1]}`]) {
  const r = await post('/chat/api/create', { verifier: 'x'.repeat(43), hasPass: false, hours: 24 }, { Cookie: c });
  check('forged/tampered/expired login cookie', r.status === 401, `HTTP ${r.status}`);
}
// 2. Cross-site request riding on a real login (CSRF)
{
  const r = await fetch(`${B}/chat/api/create`, { method: 'POST', headers: { ...A, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  check('cross-site request using a login (CSRF)', r.status === 403, `HTTP ${r.status}`);
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
// 9. LAST (locks login until tomorrow on this server): 60 simultaneous wrong codes, then the right one
{
  const s = (await Promise.all(Array.from({ length: 60 }, (_, i) => post('/secret/api/login', { code: `guess-${i}` })))).map((r) => r.status);
  const wrong = s.filter((x) => x === 401).length;
  const locked = s.filter((x) => x === 429).length;
  const right = (await post('/secret/api/login', { code: CODE })).status;
  check('60 simultaneous code guesses', wrong <= 20 && locked >= 40 && right === 429, `${wrong} checked, ${locked} refused, real code now -> ${right} until tomorrow`);
}
console.log(res.join('\n'));
const bad = res.filter((r) => r.startsWith('PROBLEM')).length;
console.log(`\n${res.length - bad} blocked, ${bad} problems`);
process.exit(bad ? 1 : 0);
