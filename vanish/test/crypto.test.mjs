import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/client/crypto.js';

test('text round-trips and ciphertext differs each time', async () => {
  const { key } = await C.deriveKeys(C.newLinkKey());
  const a = await C.sealText(key, 'hunter2 ✓');
  const b = await C.sealText(key, 'hunter2 ✓');
  assert.notEqual(a, b);
  assert.equal(await C.unsealText(key, a), 'hunter2 ✓');
});

test('large binary round-trips (b64 helpers do not blow the stack)', async () => {
  const { key } = await C.deriveKeys(C.newLinkKey());
  const data = crypto.getRandomValues(new Uint8Array(65536));
  const big = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < big.length; i += data.length) big.set(data, i);
  assert.deepEqual(await C.unseal(key, await C.seal(key, big)), big);
  assert.deepEqual(C.fromB64u(C.toB64u(big)), big);
});

test('passphrase changes key and verifier; wrong one cannot decrypt', async () => {
  const link = C.newLinkKey();
  const right = await C.deriveKeys(link, 'blue-horse');
  const wrong = await C.deriveKeys(link, 'blue-house');
  const none = await C.deriveKeys(link);
  assert.notEqual(right.verifier, wrong.verifier);
  assert.notEqual(right.verifier, none.verifier);
  assert.equal(right.verifier, (await C.deriveKeys(link, 'blue-horse')).verifier);
  assert.match(right.verifier, /^[A-Za-z0-9_-]{43}$/);
  const sealed = await C.sealText(right.key, 'secret');
  await assert.rejects(C.unsealText(wrong.key, sealed));
});

test('damaged link key is rejected', async () => {
  await assert.rejects(C.deriveKeys('abc'), /damaged/);
});
