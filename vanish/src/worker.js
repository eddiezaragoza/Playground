// Poof (code name vanish): self-destructing secrets (/secret, short link /poof) and end-to-end encrypted chat rooms (/chat) on eddiezaragoza.com.
// Everything is encrypted in the browser. The key lives after the # in the link, which browsers never send
// to a server, so this Worker and its Durable Objects only ever hold ciphertext.
// Secrets (wrangler secret put): CREATE_CODE (access code needed to CREATE items/rooms), COOKIE_SECRET.
import SHELL_HTML from './client/shell.html';
import APP_JS from './client/app.js';
import CRYPTO_JS from './client/crypto.js';
import APP_CSS from './client/app.css';
import ICON_SVG from './client/icon.svg';
import MANIFEST from './client/manifest.webmanifest';
import ICON_180 from './client/icon-180.png';
import ICON_192 from './client/icon-192.png';
import ICON_512 from './client/icon-512.png';
import ICON_MASKABLE from './client/icon-maskable.png';
import { LIMITS, hourMs, isId, randomId, VERIFIER_RE } from './common.js';

export { SecretBox } from './vault.js';
export { ChatRoom } from './chat-room.js';
export { LoginGuard } from './login-guard.js';

const COOKIE = 'vanish_session';
const COOKIE_DAYS = 180;
const FAILS_PER_PERSON = 20; // wrong access codes per person (internet address) per UTC day
const FAILS_SITE_WIDE = 1000; // backstop across everyone, against guessing from many computers

function headers(url, type) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', // the key is in the #fragment, which is never sent anyway; this is belt and braces
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy':
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; ` +
      `connect-src 'self' wss://${url.host}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  };
}
const respond = (url, body, status = 200, type = 'text/html; charset=utf-8', extra = {}) =>
  new Response(body, { status, headers: { ...headers(url, type), ...extra } });
const json = (url, obj, status = 200, extra = {}) =>
  respond(url, JSON.stringify(obj), status, 'application/json; charset=utf-8', extra);
const fromDO = (url, r) => json(url, r.body, r.status);

const PAGE_TITLES = {
  login: 'Sign in', 'create-secret': 'Send a poof', 'view-secret': 'A poof for you',
  'create-room': 'Start a chat', room: 'Chat room',
};
// Chat rooms may show GIFs from Giphy's image servers; every other page stays locked to our own origin.
const GIPHY_IMG = 'https://*.giphy.com';
const page = (url, name) => {
  const res = respond(url, SHELL_HTML.replaceAll('__PAGE__', name).replace('__TITLE__', `${PAGE_TITLES[name]} - Poof`));
  if (name === 'room') {
    res.headers.set('Content-Security-Policy', res.headers.get('Content-Security-Policy').replace("img-src 'self' data: blob:;", `img-src 'self' data: blob: ${GIPHY_IMG};`));
  }
  return res;
};

// ---------- GIF search (Giphy) ----------
// The browser asks us, we ask Giphy: the API key stays secret and Giphy never sees who searched.
// Results are cached for 5 minutes so popular searches don't burn the Giphy rate limit.
async function giphy(env, q, offset) {
  if (env.GIPHY_FAKE) { // local tests only: fake results that point at our own icon
    const u = '/secret/assets/icon.svg';
    return Array.from({ length: 6 }, (_, i) => ({ id: `fake${i}`, title: `${q || 'trending'} ${i}`, p: u, pw: 100, ph: 100, u, w: 200, h: 200 }));
  }
  const api = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
  api.searchParams.set('api_key', env.GIPHY_KEY);
  if (q) api.searchParams.set('q', q);
  api.searchParams.set('limit', '24');
  api.searchParams.set('offset', String(offset));
  api.searchParams.set('rating', 'pg-13');
  const cacheKey = new Request(`https://giphy-cache.invalid/${encodeURIComponent(q)}/${offset}`);
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (!res) {
    const r = await fetch(api, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    res = new Response(await r.text(), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
    await cache.put(cacheKey, res.clone());
  }
  const data = (await res.json()).data || [];
  return data.map((g) => {
    const pv = g.images?.fixed_width || g.images?.fixed_width_downsampled;
    const big = g.images?.fixed_height || g.images?.downsized || pv;
    if (!pv?.url || !big?.url) return null;
    return { id: String(g.id), title: String(g.title || '').slice(0, 80), p: pv.url, pw: Number(pv.width) || 200, ph: Number(pv.height) || 200,
      u: big.url, w: Number(big.width) || 200, h: Number(big.height) || 200 };
  }).filter(Boolean);
}

// ---------- auth (only needed to CREATE things; opening a link never needs it) ----------
const enc = new TextEncoder();
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sessionValue(env) {
  const exp = Date.now() + COOKIE_DAYS * 864e5;
  return `${exp}.${hex(await hmac(env.COOKIE_SECRET, `vanish:${exp}`))}`;
}
async function isAuthed(req, env) {
  const raw = (req.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!(Number(exp) > Date.now()) || typeof sig !== 'string' || sig.length !== 64) return false;
  const want = await hmac(env.COOKIE_SECRET, `vanish:${exp}`);
  return crypto.subtle.timingSafeEqual(enc.encode(sig), enc.encode(hex(want)));
}
// Forgiving about how the words are typed: "Button Glacier basket-lagoon" == "button-glacier-basket-lagoon".
// Phones capitalize the first letter on their own, and ignoring case costs almost nothing against a 20-tries-a-day lock.
const normCode = (c) => String(c).trim().toLowerCase().replace(/[\s_-]+/g, '-');
// HMAC both sides first so the comparison is constant-time even when lengths differ.
async function codeMatches(env, code) {
  const [a, b] = await Promise.all([hmac(env.COOKIE_SECRET, `code:${normCode(code)}`), hmac(env.COOKIE_SECRET, `code:${normCode(env.CREATE_CODE)}`)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Bodies must say how big they are up front, so an oversized upload is refused before it is read into memory.
const declaredLength = (req) => {
  const h = req.headers.get('Content-Length');
  return h !== null && /^\d+$/.test(h) ? Number(h) : null;
};
async function readJson(req, max) {
  const len = declaredLength(req);
  if (len === null || len > max) return null;
  const text = await req.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}
const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

const vault = (env, id) => env.SECRETS.get(env.SECRETS.idFromName(id));
const room = (env, id) => env.ROOMS.get(env.ROOMS.idFromName(id));

// ---------- routes ----------
export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      console.error(e);
      return json(new URL(req.url), { error: 'Something went wrong on the server.' }, 500);
    }
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  // Never run with missing secrets: an unset CREATE_CODE must not become the literal string "undefined".
  if (!env.CREATE_CODE || !env.COOKIE_SECRET || env.COOKIE_SECRET.length < 16) {
    return json(url, { error: 'Vanish is not configured yet.' }, 503);
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const parts = path.split('/').filter(Boolean); // e.g. ['secret','api','s',id,'file','0']

  // Poof lives on its own origin. Anything arriving at the old eddiezaragoza.com paths is sent there; browsers keep
  // the #key part of a link across a redirect, so old links still open. The old login cookie is cleared on the way.
  if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST) {
    let to = path;
    if (path === '/poof') to = '/secret';
    if (path === '/poof/chat') to = '/chat';
    return new Response(null, { status: 301, headers: {
      Location: `https://${env.CANONICAL_HOST}${to}${url.search}`,
      'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      'Cache-Control': 'no-store',
    } });
  }
  if (path === '/' || path === '/poof') return Response.redirect(`${url.origin}/secret`, 302);
  if (path === '/poof/chat') return Response.redirect(`${url.origin}/chat`, 302);

  // Static assets (shared by both apps).
  const ASSETS = {
    '/secret/assets/app.js': [APP_JS, 'text/javascript; charset=utf-8'],
    '/secret/assets/crypto.js': [CRYPTO_JS, 'text/javascript; charset=utf-8'],
    '/secret/assets/app.css': [APP_CSS, 'text/css; charset=utf-8'],
    '/secret/assets/icon.svg': [ICON_SVG, 'image/svg+xml'],
    '/secret/assets/manifest.webmanifest': [MANIFEST, 'application/manifest+json'],
    '/secret/assets/icon-180.png': [ICON_180, 'image/png'],
    '/secret/assets/icon-192.png': [ICON_192, 'image/png'],
    '/secret/assets/icon-512.png': [ICON_512, 'image/png'],
    '/secret/assets/icon-maskable.png': [ICON_MASKABLE, 'image/png'],
  };
  if (method === 'GET' && ASSETS[path]) return respond(url, ASSETS[path][0], 200, ASSETS[path][1]);

  // Anything that changes state must come from our own pages (blocks cross-site form posts / socket hijacks).
  const wantsOrigin = method !== 'GET' || req.headers.get('Upgrade') === 'websocket';
  if (wantsOrigin && req.headers.get('Origin') !== url.origin) return json(url, { error: 'Bad origin.' }, 403);

  // Pages
  if (method === 'GET') {
    if (path === '/secret') return page(url, (await isAuthed(req, env)) ? 'create-secret' : 'login');
    if (path === '/chat') return page(url, (await isAuthed(req, env)) ? 'create-room' : 'login');
    if (parts[0] === 'secret' && parts[1] === 's' && isId(parts[2]) && parts.length === 3) return page(url, 'view-secret');
    if (parts[0] === 'chat' && parts[1] === 'r' && isId(parts[2]) && parts.length === 3) return page(url, 'room');
  }

  // Login / logout
  if (path === '/secret/api/login' && method === 'POST') {
    // One counter per person (their internet address, set by Cloudflare and not forgeable), so a stranger's wrong
    // guesses never lock anyone else out, plus a large site-wide backstop. Addresses are HMAC'd, never stored.
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    const person = env.GUARD.get(env.GUARD.idFromName(`ip:${hex(await hmac(env.COOKIE_SECRET, `ip:${ip}`))}`));
    const site = env.GUARD.get(env.GUARD.idFromName('login'));
    if (!(await person.attempt(FAILS_PER_PERSON))) return json(url, { error: 'Too many wrong codes today. Try again tomorrow.' }, 429);
    if (!(await site.attempt(FAILS_SITE_WIDE))) { await person.refund(); return json(url, { error: 'Too many wrong codes today. Try again tomorrow.' }, 429); }
    const b = await readJson(req, 1000);
    if (b && typeof b.code === 'string' && b.code.length <= 200 && (await codeMatches(env, b.code))) {
      await Promise.all([person.refund(), site.refund()]);
      const cookie = `${COOKIE}=${await sessionValue(env)}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
      return json(url, { ok: true }, 200, { 'Set-Cookie': cookie });
    }
    return json(url, { error: 'Wrong access code.' }, 401);
  }
  if (path === '/secret/api/logout' && method === 'POST') {
    return json(url, { ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }

  // ----- secrets -----
  if (path === '/secret/api/create' && method === 'POST') {
    if (!(await isAuthed(req, env))) return json(url, { error: 'Sign in first.' }, 401);
    const b = await readJson(req, LIMITS.textChars + LIMITS.files * LIMITS.fileNameChars + 2000);
    const maxViews = intIn(b?.maxViews, 1, LIMITS.maxViews);
    const hours = intIn(b?.hours, 1, LIMITS.maxHours);
    const files = Array.isArray(b?.files) ? b.files : null;
    const valid = b && typeof b.text === 'string' && b.text.length > 0 && b.text.length <= LIMITS.textChars &&
      VERIFIER_RE.test(b.verifier || '') && typeof b.hasPass === 'boolean' && maxViews && hours &&
      files && files.length <= LIMITS.files &&
      files.every((f) => typeof f?.name === 'string' && f.name.length > 0 && f.name.length <= LIMITS.fileNameChars);
    if (!valid) return json(url, { error: 'That request did not look right.' }, 400);
    const id = randomId();
    const manage = randomId();
    const r = await vault(env, id).init({
      text: b.text, verifier: b.verifier, hasPass: b.hasPass, maxViews, manage,
      expiresAt: Date.now() + hours * hourMs(env), files: files.map((f) => ({ name: f.name, size: 0 })),
    });
    return r.status === 200 ? json(url, { id, manage }) : fromDO(url, r);
  }

  if (parts[0] === 'secret' && parts[1] === 'api' && parts[2] === 's' && isId(parts[3])) {
    const stub = vault(env, parts[3]);
    const manage = req.headers.get('X-Manage-Token') || '';
    const rest = parts.slice(4).join('/');
    if (rest === '' && method === 'GET') return fromDO(url, await stub.info());
    if (rest === 'open' && method === 'POST') {
      const b = await readJson(req, 500);
      return fromDO(url, await stub.open(String(b?.verifier || '')));
    }
    if (rest === 'finalize' && method === 'POST') return fromDO(url, await stub.finalize(manage));
    if (rest === 'destroy' && method === 'POST') return fromDO(url, await stub.destroy(manage));
    if (parts[4] === 'file' && /^\d$/.test(parts[5] || '') && parts.length === 6) {
      const n = Number(parts[5]);
      if (method === 'PUT') {
        const len = declaredLength(req);
        if (len === null) return json(url, { error: 'Missing Content-Length.' }, 411);
        if (len > LIMITS.fileBytes) return json(url, { error: 'File is too large.' }, 413);
        const buf = await req.arrayBuffer();
        if (buf.byteLength > LIMITS.fileBytes) return json(url, { error: 'File is too large.' }, 413);
        return fromDO(url, await stub.upload(manage, n, buf));
      }
      if (method === 'GET') {
        const r = await stub.file(n, url.searchParams.get('t') || '');
        if (r.status !== 200) return fromDO(url, r);
        return respond(url, r.body, 200, 'application/octet-stream');
      }
    }
  }

  // ----- chat -----
  if (path === '/chat/api/create' && method === 'POST') {
    if (!(await isAuthed(req, env))) return json(url, { error: 'Sign in first.' }, 401);
    const b = await readJson(req, 2000);
    const name = b?.name ?? '';
    if (!b || !VERIFIER_RE.test(b.verifier || '') || typeof b.hasPass !== 'boolean' || !LIMITS.roomHours.includes(b.hours) ||
        typeof name !== 'string' || name.length > LIMITS.roomNameChars) {
      return json(url, { error: 'That request did not look right.' }, 400);
    }
    const id = randomId();
    const manage = randomId();
    // name is ciphertext (encrypted with the room key in the browser), or '' for no name.
    await room(env, id).init({ verifier: b.verifier, hasPass: b.hasPass, manage, name, expiresAt: Date.now() + b.hours * hourMs(env) });
    return json(url, { id, manage });
  }

  if (parts[0] === 'chat' && parts[1] === 'api' && parts[2] === 'r' && isId(parts[3])) {
    const stub = room(env, parts[3]);
    const rest = parts.slice(4).join('/');
    if (rest === '' && method === 'GET') return fromDO(url, await stub.info());
    if (rest === 'check' && method === 'POST') {
      const b = await readJson(req, 500);
      return fromDO(url, await stub.check(String(b?.verifier || '')));
    }
    if (rest === 'destroy' && method === 'POST') return fromDO(url, await stub.destroy(req.headers.get('X-Manage-Token') || ''));
    if (rest === 'rename' && method === 'POST') {
      const b = await readJson(req, 1000);
      if (typeof b?.name !== 'string' || b.name.length > LIMITS.roomNameChars) return json(url, { error: 'That name is too long.' }, 400);
      return fromDO(url, await stub.rename(req.headers.get('X-Manage-Token') || '', b.name));
    }
    if (rest === 'ws' && method === 'GET') return stub.fetch(req);
    if (rest === 'gifs' && method === 'GET') {
      if (!env.GIPHY_KEY && !env.GIPHY_FAKE) return json(url, { error: 'GIF search is not set up yet.' }, 503);
      const ok = await stub.gifAllowed(req.headers.get('X-Room-Verifier') || ''); // room members only, rate-limited per room
      if (ok.status !== 200) return fromDO(url, ok);
      const q = (url.searchParams.get('q') || '').trim().slice(0, 50);
      const offset = Math.min(Math.max(Number(url.searchParams.get('offset')) || 0, 0), 200);
      const results = await giphy(env, q, offset);
      return results ? json(url, { results }) : json(url, { error: 'GIF search is unavailable right now.' }, 502);
    }
    const verifier = req.headers.get('X-Room-Verifier') || '';
    if (rest === 'img' && method === 'PUT') {
      const len = declaredLength(req);
      if (len === null) return json(url, { error: 'Missing Content-Length.' }, 411);
      if (len > LIMITS.imgBytes) return json(url, { error: 'That photo is too large.' }, 413);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > LIMITS.imgBytes) return json(url, { error: 'That photo is too large.' }, 413);
      return fromDO(url, await stub.putImage(verifier, buf));
    }
    if (parts[4] === 'img' && parts.length === 6 && method === 'GET') {
      const r = await stub.getImage(verifier, parts[5]);
      if (r.status !== 200) return fromDO(url, r);
      return respond(url, r.body, 200, 'application/octet-stream');
    }
  }

  return json(url, { error: 'Not found.' }, 404);
}
