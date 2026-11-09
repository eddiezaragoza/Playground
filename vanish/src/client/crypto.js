// Browser-side crypto for Vanish. Runs in the browser (and in Node for tests). The server never sees
// the link key, the passphrase, or any plaintext.
//
// link key (32 random bytes, lives after the # in the link)
//   + optional passphrase  --PBKDF2-->  input key material
//   --HKDF "encrypt"-->  AES-256-GCM key (never leaves the browser)
//   --HKDF "verify"-->   verifier (sent to the server; proves you hold the key without revealing it)
const te = new TextEncoder();
const td = new TextDecoder();
const subtle = globalThis.crypto.subtle;
export const PBKDF2_ITER = 310000;

export function toB64u(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const newLinkKey = () => toB64u(crypto.getRandomValues(new Uint8Array(32)));

export async function deriveKeys(linkKey, passphrase = '') {
  const raw = fromB64u(linkKey);
  if (raw.length !== 32) throw new Error('This link is damaged. Ask for the full link again.');
  let ikm = raw;
  if (passphrase) {
    const pk = await subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    ikm = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: raw, iterations: PBKDF2_ITER }, pk, 256));
  }
  const hk = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) });
  const key = await subtle.deriveKey(hkdf('vanish v1 encrypt'), hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const verifier = toB64u(await subtle.deriveBits(hkdf('vanish v1 verify'), hk, 256));
  return { key, verifier };
}

// Output layout: 12-byte random IV, then ciphertext + 16-byte tag.
export async function seal(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
export async function unseal(key, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}
export const sealText = async (key, text) => toB64u(await seal(key, te.encode(text)));
export const unsealText = async (key, b64) => td.decode(await unseal(key, fromB64u(b64)));
export const sealJson = (key, obj) => sealText(key, JSON.stringify(obj));
export const unsealJson = async (key, b64) => JSON.parse(await unsealText(key, b64));
