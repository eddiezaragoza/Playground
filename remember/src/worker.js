// Remember: a photo-sharing page and live slideshow for a celebration of life, at eddiezaragoza.com/<SLUG>.
//   /<slug>            guests (no account): pick photos on their phone, they upload and go into the album
//   /<slug>/show#<t>   full-screen slideshow of every shared photo; picks up new ones while it runs
//   /<slug>/admin      family: settings, cover photo, hide/approve/delete, download everything, slideshow link
//   /<slug>/card       printable QR card for the tables
// Secret (wrangler secret put ADMIN_KEY): the admin password. Everything else (slideshow link, cookie, hashed
// addresses) is derived from it, so changing it signs everyone out and invalidates old slideshow links.
import qrcode from 'qrcode-generator';
import GUEST_HTML from './client/guest.html';
import GUEST_JS from './client/guest.js';
import SHOW_HTML from './client/show.html';
import SHOW_JS from './client/show.js';
import ADMIN_HTML from './client/admin.html';
import ADMIN_JS from './client/admin.js';
import CARD_HTML from './client/card.html';
import STYLE_CSS from './client/style.css';
import SHARED_JS from './client/shared.js';

export { Memorial } from './memorial.js';

const MB = 1024 * 1024;
const LIMITS = {
  photoBytes: 10 * MB, // one photo after the phone shrinks it (usually 0.5-2 MB); originals that can't be shrunk up to this
  thumbBytes: 300 * 1024,
  bodyBytes: 11 * MB, // whole upload request (photo + preview + name + note)
  nameChars: 60,
  noteChars: 500,
  maxPhotos: 3000,
  maxBytes: 3 * 1024 * MB, // the free plan allows 5 GB of Durable Object storage for the whole account
};
const COOKIE = 'remember_admin';

const enc = new TextEncoder();
function b64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b));
}
const adminToken = (env) => hmac(env, 'admin-cookie:v1');
const showToken = (env) => hmac(env, 'slideshow-link:v1');
const personKey = (env, req) => hmac(env, `ip:${req.headers.get('CF-Connecting-IP') || 'local'}`).then((h) => h.slice(0, 22));

function headers(type, extra = {}) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', // the slideshow link carries its key after the #; never leak the page URL
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...extra,
  };
}
const respond = (body, status = 200, type = 'text/html; charset=utf-8', extra = {}) => new Response(body, { status, headers: headers(type, extra) });
const json = (obj, status = 200, extra = {}) => respond(JSON.stringify(obj), status, 'application/json; charset=utf-8', extra);
const fail = (status, error) => json({ error }, status);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// What the page shows. The family can change these on the admin page; the defaults come from wrangler.toml.
function pageSettings(env, s) {
  const name = s.name || env.NAME || 'our loved one';
  return {
    name,
    subtitle: s.subtitle ?? 'Celebration of Life',
    intro: s.intro || `Share your favorite photos of ${name}. They'll be part of the slideshow at the celebration of life. Thank you for sharing your memories.`,
    approval: s.approval === '1',
    coverVersion: s.coverVersion || '',
  };
}

function fill(html, base, settings, origin) {
  const guestUrl = `${origin}${base}`;
  return html
    .replaceAll('__BASE__', esc(base))
    .replaceAll('__NAME__', esc(settings.name))
    .replaceAll('__SUBTITLE__', esc(settings.subtitle))
    .replaceAll('__INTRO__', esc(settings.intro))
    .replaceAll('__COVER__', settings.coverVersion ? `${esc(base)}/cover?v=${esc(settings.coverVersion)}` : '')
    .replaceAll('__INITIAL__', esc([...settings.name.trim()][0] || '♥'))
    .replaceAll('__GUEST_URL__', esc(guestUrl))
    .replaceAll('__GUEST_URL_SHORT__', esc(guestUrl.replace(/^https?:\/\//, '')));
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  const size = n + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}

// Which kind of image the bytes really are (never trust the browser's label).
function sniff(u8) {
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return 'image/gif';
  if (String.fromCharCode(...u8.slice(0, 4)) === 'RIFF' && String.fromCharCode(...u8.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const cleanText = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

function cookieValue(req, name) {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

async function isAdmin(req, env) {
  return safeEq(cookieValue(req, COOKIE), await adminToken(env));
}

// Blocks other websites from posting to us with the family's cookie, or from scripting uploads into the album.
const sameOrigin = (req, url) => req.headers.get('Origin') === url.origin;

async function readJson(req, max = 8 * 1024) {
  const len = Number(req.headers.get('Content-Length'));
  if (!len || len > max) return null;
  try { return await req.json(); } catch { return null; }
}

async function readImage(file, max) {
  if (!file || typeof file === 'string' || file.size === 0 || file.size > max) return null;
  const bytes = await file.arrayBuffer();
  const type = sniff(new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)));
  return type ? { bytes, type } : null;
}

function photoResponse(p, cache) {
  return new Response(p.bytes, {
    headers: {
      'Content-Type': p.type,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const slug = (env.SLUG || 'vicky').toLowerCase();
    const base = `/${slug}`;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    // Old addresses (env OLD_SLUGS) keep working: 308 keeps the method and body, and browsers carry the #key along.
    for (const old of String(env.OLD_SLUGS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)) {
      if (old !== slug && (path === `/${old}` || path.startsWith(`/${old}/`))) {
        return Response.redirect(`${url.origin}${base}${path.slice(old.length + 1)}${url.search}`, 308);
      }
    }
    if (path !== base && !path.startsWith(`${base}/`)) return respond('Not found', 404, 'text/plain; charset=utf-8');
    if (!env.ADMIN_KEY) return respond('This page is not set up yet (ADMIN_KEY is missing).', 503, 'text/plain; charset=utf-8');
    const sub = path.slice(base.length) || '/';
    const stub = env.MEMORIAL.get(env.MEMORIAL.idFromName((env.STORE || slug).toLowerCase()));
    const settings = async () => pageSettings(env, await stub.getSettings());
    const method = req.method;

    // ---------- pages ----------
    if (method === 'GET') {
      if (sub === '/') return respond(fill(GUEST_HTML, base, await settings(), url.origin));
      if (sub === '/show') return respond(fill(SHOW_HTML, base, await settings(), url.origin));
      if (sub === '/admin') return respond(fill(ADMIN_HTML, base, await settings(), url.origin));
      if (sub === '/card') return respond(fill(CARD_HTML, base, await settings(), url.origin));
      const assets = { '/a/style.css': [STYLE_CSS, 'text/css'], '/a/guest.js': [GUEST_JS, 'text/javascript'],
        '/a/show.js': [SHOW_JS, 'text/javascript'], '/a/admin.js': [ADMIN_JS, 'text/javascript'], '/a/shared.js': [SHARED_JS, 'text/javascript'] };
      if (assets[sub]) return respond(assets[sub][0], 200, `${assets[sub][1]}; charset=utf-8`, { 'Cache-Control': 'public, max-age=300' });
      if (sub === '/qr.svg') return respond(qrSvg(`${url.origin}${base}`), 200, 'image/svg+xml', { 'Cache-Control': 'public, max-age=3600' });

      if (sub === '/cover') {
        const p = await stub.getPhoto('_cover', 'full', false);
        return p ? photoResponse(p, 'public, max-age=86400') : fail(404, 'No cover photo yet.');
      }
      const m = sub.match(/^\/(p|t)\/([a-f0-9]{32})$/);
      if (m) {
        const admin = await isAdmin(req, env);
        const p = await stub.getPhoto(m[2], m[1] === 't' ? 'thumb' : 'full', !admin);
        // private: browsers keep it (the slideshow loops without re-downloading); shared caches don't.
        return p ? photoResponse(p, 'private, max-age=604800') : fail(404, 'Photo not found.');
      }

      // Slideshow data: needs the slideshow link's key (or the family's admin cookie).
      if (sub === '/api/show') {
        const ok = safeEq(req.headers.get('X-Show-Key') || '', await showToken(env)) || (await isAdmin(req, env));
        if (!ok) return fail(403, 'This slideshow link is not valid. Copy it again from the admin page.');
        const s = await settings();
        const photos = (await stub.list(true)).map(({ id, ts, name, note }) => ({ id, ts, name, note }));
        return json({ name: s.name, subtitle: s.subtitle, coverVersion: s.coverVersion, photos });
      }

      if (sub === '/api/admin') {
        if (!(await isAdmin(req, env))) return fail(401, 'Please sign in.');
        const s = await settings();
        return json({ settings: s, stats: await stub.stats(), photos: await stub.list(false), showKey: await showToken(env), guestUrl: `${url.origin}${base}` });
      }
      return fail(404, 'Not found.');
    }

    if (method !== 'POST') return fail(405, 'Method not allowed.');
    if (!sameOrigin(req, url)) return fail(403, 'Please use the page on this website.');

    // ---------- guests: share a photo ----------
    if (sub === '/api/upload') {
      const len = Number(req.headers.get('Content-Length'));
      if (!len) return fail(411, 'Please try again.');
      if (len > LIMITS.bodyBytes) return fail(413, 'That photo is too large.');
      let form;
      try { form = await req.formData(); } catch { return fail(400, 'That upload did not come through. Please try again.'); }
      const photo = await readImage(form.get('photo'), LIMITS.photoBytes);
      if (!photo) return fail(415, "That file isn't a photo we can show. Try a screenshot of it instead.");
      const thumb = await readImage(form.get('thumb'), LIMITS.thumbBytes);
      const r = await stub.addPhoto({
        who: await personKey(env, req),
        bytes: photo.bytes,
        type: photo.type,
        thumb: thumb && thumb.type === 'image/jpeg' ? thumb.bytes : null,
        name: cleanText(form.get('name'), LIMITS.nameChars),
        note: cleanText(form.get('note'), LIMITS.noteChars),
      }, {
        perPerson: Number(env.UPLOADS_PER_PERSON) || 400,
        siteWide: Number(env.UPLOADS_SITE_WIDE) || 4000,
        maxPhotos: LIMITS.maxPhotos,
        maxBytes: LIMITS.maxBytes,
      });
      return r.error ? fail(r.status, r.error) : json({ ok: true, id: r.id, status: r.photoStatus });
    }

    // ---------- family ----------
    if (sub === '/api/login') {
      const body = await readJson(req);
      const who = await personKey(env, req);
      if (!(await stub.loginAttempt(who, 20, 200))) return fail(429, 'Too many wrong passwords today. Try again tomorrow.');
      if (!body || !safeEq(String(body.password || '').trim(), env.ADMIN_KEY.trim())) return fail(401, "That password isn't right.");
      await stub.loginRefund(who);
      const cookie = `${COOKIE}=${await adminToken(env)}; Path=${base}; Max-Age=${90 * 86400}; HttpOnly; Secure; SameSite=Strict`;
      return json({ ok: true }, 200, { 'Set-Cookie': cookie });
    }
    if (sub === '/api/logout') {
      return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=${base}; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
    }

    if (!(await isAdmin(req, env))) return fail(401, 'Please sign in.');

    if (sub === '/api/settings') {
      const b = await readJson(req);
      if (!b) return fail(400, 'Bad request.');
      const out = {};
      if (b.name !== undefined) out.name = cleanText(b.name, 60);
      if (b.subtitle !== undefined) out.subtitle = cleanText(b.subtitle, 120);
      if (b.intro !== undefined) out.intro = cleanText(b.intro, 600);
      if (b.approval !== undefined) out.approval = b.approval ? '1' : '0';
      return json({ settings: pageSettings(env, await stub.setSettings(out)) });
    }
    if (sub === '/api/cover') {
      const len = Number(req.headers.get('Content-Length'));
      if (!len || len > LIMITS.bodyBytes) return fail(413, 'That photo is too large.');
      const form = await req.formData().catch(() => null);
      if (form && form.get('remove') === '1') return json({ settings: pageSettings(env, await stub.removeCover()) });
      const photo = form && (await readImage(form.get('photo'), LIMITS.photoBytes));
      if (!photo) return fail(415, "That file isn't a photo we can show.");
      return json({ settings: pageSettings(env, await stub.setCover(photo.bytes, photo.type)) });
    }
    const pm = sub.match(/^\/api\/photo\/([a-f0-9]{32})$/);
    if (pm) {
      const b = await readJson(req);
      if (!b) return fail(400, 'Bad request.');
      const done = b.action === 'delete' ? await stub.remove(pm[1]) : await stub.setStatus(pm[1], b.status);
      return done ? json({ ok: true }) : fail(404, 'Photo not found.');
    }
    return fail(404, 'Not found.');
  },
};
