// Shared limits and helpers for the Worker and its Durable Objects.

export const LIMITS = {
  textChars: 200000, // base64 ciphertext of the secret's text (about 50,000 typed characters)
  fileNameChars: 2000, // base64 ciphertext of a file's name and type
  files: 3,
  fileBytes: 10 * 1024 * 1024 + 28, // 10 MB plus the 12-byte IV and 16-byte GCM tag
  maxViews: 20,
  maxHours: 720, // 30 days
  roomHours: [24, 168, 720],
  msgChars: 24000, // base64 ciphertext of one chat message (4,000 typed characters fits easily)
  helloChars: 600, // base64 ciphertext of a display name
  history: 200, // messages sent to someone joining a room
  keep: 1000, // messages a room keeps; older ones are deleted
  roomSockets: 50,
};

// Lets local tests shrink an "hour" so expiry can be watched. Unset in production.
export const hourMs = (env) => Number(env.TEST_HOUR_MS) || 3600000;

const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url
export const isId = (s) => typeof s === 'string' && ID_RE.test(s);
export const VERIFIER_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const randomId = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

// Constant-time string compare for tokens and verifiers (both sides are fixed-length).
export function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const e = new TextEncoder();
  return crypto.subtle.timingSafeEqual(e.encode(a), e.encode(b));
}

export const ok = (body = { ok: true }) => ({ status: 200, body });
export const err = (status, error, extra = {}) => ({ status, body: { error, ...extra } });
export const GONE = { status: 404, body: { error: 'gone' } };
