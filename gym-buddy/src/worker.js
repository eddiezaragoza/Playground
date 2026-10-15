// Gym Buddy: serves /gym on eddiezaragoza.com and is the only thing that talks to Notion.
// Secrets (wrangler secret put): NOTION_TOKEN, APP_PASSWORD (Eddie's password), COOKIE_SECRET.
// Friends: KV key user:<username> = {name, ds, salt, hash, iter} (PBKDF2-SHA256), written by tools/add_friend.py.
import APP_HTML from './client/app.html';
import LOGIN_HTML from './client/login.html';
import APP_JS from './client/app.js';
import APP_CSS from './client/app.css';
import {
  normalizePlan, cleanResults, cleanExtras, buildSummary, cleanFields, richText, plainText, normalizeId, isNotionId,
  libraryEntry, buildLibraryIndex, findExercise, youtubeSearch,
} from './lib.js';

// Eddie's log. Each friend's log id lives in their KV user record; a user can only ever touch their own log.
const DATA_SOURCE_ID = '0d083beb-504f-4522-b761-d41fc5c9f561';
const OWNER = 'eddie'; // logs in with APP_PASSWORD
const USERNAME_RE = /^[a-z0-9-]{1,32}$/;
const PBKDF2_MAX_ITER = 100000; // Workers' WebCrypto ceiling
// Exercise Library: read-only. Nothing in this Worker writes to it.
const LIBRARY_SOURCE_ID = 'cf4fdd21-651b-4f8f-bfa8-baaf3fba7945';
const NOTION_VERSION = '2026-03-11';
const COOKIE = 'gb_session';
const COOKIE_DAYS = 180;
const BASE = '/gym';
const MAX_FAILS_PER_DAY = 20; // all logins refused after this many wrong guesses (UTC day)

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin', // no-referrer makes browsers send Origin: null, which breaks the Origin check
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const respond = (body, status = 200, type = 'text/html; charset=utf-8', extra = {}) =>
  new Response(body, { status, headers: { 'Content-Type': type, ...SECURITY_HEADERS, ...extra } });
const json = (obj, status = 200) => respond(JSON.stringify(obj), status, 'application/json; charset=utf-8');

const MANIFEST = JSON.stringify({
  name: 'Gym Buddy', short_name: 'Gym Buddy', start_url: `${BASE}`, scope: `${BASE}`,
  display: 'standalone', background_color: '#0f1115', theme_color: '#0f1115',
  icons: [{ src: `${BASE}/icon.svg`, sizes: 'any', type: 'image/svg+xml' }],
});
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0f1115"/><g fill="#7cf29c"><rect x="14" y="38" width="10" height="24" rx="3"/><rect x="76" y="38" width="10" height="24" rx="3"/><rect x="26" y="30" width="10" height="40" rx="3"/><rect x="64" y="30" width="10" height="40" rx="3"/><rect x="36" y="46" width="28" height="8" rx="2"/></g></svg>`;

// ---------- auth ----------
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function sign(secret, msg) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)));
}
// Compare two strings in constant time by HMAC-ing both to equal-length digests first.
async function safeEqual(secret, a, b) {
  const key = await hmacKey(secret);
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.sign('HMAC', key, enc.encode(String(s)))));
  return crypto.subtle.timingSafeEqual(x, y);
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// username -> {username, name, ds, salt?, hash?, iter?}, or null if unknown. Deleting the KV record revokes access.
async function loadUser(env, username) {
  if (username === OWNER) return { username: OWNER, name: 'Eddie', ds: DATA_SOURCE_ID };
  if (!USERNAME_RE.test(username || '')) return null;
  const rec = await env.GB_KV.get(`user:${username}`, 'json');
  if (!rec || !isNotionId(rec.ds) || !rec.salt || !rec.hash) return null;
  return { username, name: rec.name || username, ds: rec.ds, salt: rec.salt, hash: rec.hash, iter: Number(rec.iter) || PBKDF2_MAX_ITER };
}

async function pbkdf2(password, saltB64, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: Math.min(iter, PBKDF2_MAX_ITER) }, key, 256);
  return b64(bits);
}

async function checkPassword(env, user, password) {
  if (!user) {
    await safeEqual(env.COOKIE_SECRET, password, 'unknown-user'); // keep timing similar for unknown names
    return false;
  }
  if (user.username === OWNER) return safeEqual(env.COOKIE_SECRET, password, env.APP_PASSWORD);
  return safeEqual(env.COOKIE_SECRET, await pbkdf2(password, user.salt, user.iter), user.hash);
}

async function makeCookie(env, username) {
  const exp = Date.now() + COOKIE_DAYS * 864e5;
  const val = `${username}.${exp}.${await sign(env.COOKIE_SECRET, `gb:${username}:${exp}`)}`;
  return `${COOKIE}=${val}; Path=${BASE}; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

// Returns the logged-in user or null. Cookies from before multi-user ("exp.sig") belong to Eddie.
async function authedUser(request, env) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split('.');
  const [username, exp, sig] = parts.length === 2 ? [OWNER, ...parts] : parts;
  if (parts.length < 2 || parts.length > 3 || !exp || !sig || !(Number(exp) > Date.now())) return null;
  const msg = parts.length === 2 ? `gb:${exp}` : `gb:${username}:${exp}`;
  if (!(await safeEqual(env.COOKIE_SECRET, sig, await sign(env.COOKIE_SECRET, msg)))) return null;
  return loadUser(env, username);
}

// Blocks cross-site POSTs even if SameSite were bypassed.
const sameOrigin = (request) => request.headers.get('Origin') === new URL(request.url).origin;

// ---------- Notion ----------
async function notion(env, path, method = 'GET', body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Notion ${res.status}: ${data.message || 'request failed'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const newestByStatus = (env, ds, status) =>
  notion(env, `/data_sources/${ds}/query`, 'POST', {
    filter: { property: 'Status', select: { equals: status } },
    sorts: [{ property: 'Date', direction: 'descending' }, { timestamp: 'created_time', direction: 'descending' }],
    page_size: 1,
  }).then((d) => d.results[0] || null);

function pageToSession(page, readOnly) {
  const p = page.properties;
  const out = {
    id: page.id,
    readOnly,
    url: page.url,
    title: plainText(p.Session?.title),
    date: p.Date?.date?.start || null,
    type: p.Type?.select?.name || null,
    kidsWeek: !!p['Kids Week']?.checkbox,
    coachNote: plainText(p['Coach Note']?.rich_text),
    workout: plainText(p.Workout?.rich_text),
    anchorLifts: plainText(p['Anchor Lifts']?.rich_text),
    fields: {
      energy: p.Energy?.number ?? null,
      rpe: p.RPE?.number ?? null,
      duration: p['Duration (min)']?.number ?? null,
      stretching: !!p['Stretching Done']?.checkbox,
      pain: plainText(p['Pain/Flags']?.rich_text),
    },
    plan: null,
    planError: null,
  };
  const raw = plainText(p['Plan JSON']?.rich_text);
  if (raw) {
    try { out.plan = normalizePlan(raw); } catch (e) { out.planError = `Plan JSON is invalid: ${e.message}`; }
  } else if (!readOnly) {
    out.planError = 'This row has no Plan JSON.';
  }
  return out;
}

async function loadLibrary(env) {
  const entries = [];
  let cursor;
  do {
    const d = await notion(env, `/data_sources/${LIBRARY_SOURCE_ID}/query`, 'POST', {
      page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
    });
    entries.push(...d.results.map((r) => libraryEntry(r.properties)));
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return buildLibraryIndex(entries);
}

// Attach a how-to card to every exercise in the plan. A library failure must never block the workout.
async function attachHowTo(env, session) {
  if (!session?.plan) return session;
  let index = new Map();
  try { index = await loadLibrary(env); } catch (e) { session.libraryError = e.message; }
  session.howTo = {};
  for (const b of session.plan.blocks) {
    for (const e of b.exercises) {
      const hit = findExercise(index, e.name);
      session.howTo[e.name] = hit
        ? { name: hit.name, match: hit.match, note: hit.note, cue: hit.cue, steps: hit.steps, photos: hit.photos, video: hit.video || youtubeSearch(hit.name) }
        : { name: e.name, match: 'Missing', note: '', cue: '', steps: [], photos: [], video: youtubeSearch(e.name) };
    }
  }
  return session;
}

async function getSession(env, user) {
  const planned = await newestByStatus(env, user.ds, 'Planned');
  if (planned) return attachHowTo(env, pageToSession(planned, false));
  const done = await newestByStatus(env, user.ds, 'Done');
  return done ? pageToSession(done, true) : null;
}

async function saveSession(env, user, body) {
  if (!body || !isNotionId(body.id)) return json({ error: 'Bad page id' }, 400);
  const page = await notion(env, `/pages/${normalizeId(body.id)}`);
  // Only rows in this user's own log, and only while still Planned.
  if (page.parent?.type !== 'data_source_id' || normalizeId(page.parent.data_source_id) !== normalizeId(user.ds)) {
    return json({ error: 'That page is not in your Gym Buddy Log' }, 403);
  }
  if (page.in_trash) return json({ error: 'That row is in the trash' }, 409);
  if (page.properties.Status?.select?.name !== 'Planned') {
    return json({ error: 'This session is already marked Done', code: 'already_done' }, 409);
  }

  let fields;
  try { fields = cleanFields(body.fields); } catch (e) { return json({ error: e.message }, 400); }

  // Plan comes from Notion, not the browser, so exercise names and anchor flags can't be spoofed.
  let summary = null;
  const raw = plainText(page.properties['Plan JSON']?.rich_text);
  if (raw) {
    try {
      const plan = normalizePlan(raw);
      summary = buildSummary(plan, cleanResults(plan, body.results), cleanExtras(plan, body.extras));
    } catch (e) { return json({ error: `Plan JSON is invalid: ${e.message}` }, 422); }
  }

  // Coach Note is deliberately absent from this list.
  const properties = {
    'Stretching Done': { checkbox: fields.stretching },
    'Pain/Flags': { rich_text: richText(fields.pain) },
    Status: { select: { name: 'Done' } },
  };
  if (fields.energy != null) properties.Energy = { number: fields.energy };
  if (fields.rpe != null) properties.RPE = { number: fields.rpe };
  if (fields.duration != null) properties['Duration (min)'] = { number: fields.duration };
  if (summary) {
    properties.Workout = { rich_text: richText(summary.workout) };
    if (summary.anchorLifts) properties['Anchor Lifts'] = { rich_text: richText(summary.anchorLifts) };
  }

  const updated = await notion(env, `/pages/${normalizeId(body.id)}`, 'PATCH', { properties });
  return json({ ok: true, session: pageToSession(updated, true) });
}

// ---------- router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Never serve the login form (or anything else) over plain HTTP. ALLOW_HTTP is only set in local .dev.vars
    // (wrangler dev presents the production hostname, so a hostname check can't detect local runs).
    if (url.protocol === 'http:' && env.ALLOW_HTTP !== '1') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    let path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return respond('Not found', 404, 'text/plain');
    if (!env.NOTION_TOKEN || !env.APP_PASSWORD || !env.COOKIE_SECRET || !env.GB_KV) {
      return respond('Gym Buddy is not configured (missing secrets).', 500, 'text/plain');
    }
    const sub = path.slice(BASE.length) || '/';

    // Public: needed before login / by the home-screen icon.
    if (sub === '/manifest.webmanifest') return respond(MANIFEST, 200, 'application/manifest+json');
    if (sub === '/icon.svg') return respond(ICON, 200, 'image/svg+xml');
    if (sub === '/app.css') return respond(APP_CSS, 200, 'text/css; charset=utf-8');

    if (sub === '/login' && request.method === 'POST') {
      if (!sameOrigin(request)) return respond('Forbidden', 403, 'text/plain');
      const form = await request.formData().catch(() => null);
      const username = String(form?.get('username') || '').trim().toLowerCase();
      const user = await loadUser(env, username);
      // Daily cap per username (unknown names share one bucket), checked before the password so a locked day
      // can't be guessed through.
      const failKey = `login-fails:${new Date().toISOString().slice(0, 10)}:${user ? user.username : '_unknown'}`;
      const fails = Number(await env.GB_KV.get(failKey)) || 0;
      if (fails >= MAX_FAILS_PER_DAY) {
        return respond(LOGIN_HTML.replace('<!--ERROR-->', '<p class="error">Too many wrong passwords today. Try again tomorrow.</p>'), 429);
      }
      if (await checkPassword(env, user, String(form?.get('password') || ''))) {
        return new Response(null, { status: 303, headers: { Location: BASE, 'Set-Cookie': await makeCookie(env, user.username), ...SECURITY_HEADERS } });
      }
      await env.GB_KV.put(failKey, String(fails + 1), { expirationTtl: 2 * 86400 });
      await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
      return respond(LOGIN_HTML.replace('<!--ERROR-->', '<p class="error">Wrong username or password.</p>'), 401);
    }

    const user = await authedUser(request, env);
    if (sub === '/logout') {
      return new Response(null, { status: 303, headers: { Location: BASE, 'Set-Cookie': `${COOKIE}=; Path=${BASE}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`, ...SECURITY_HEADERS } });
    }
    if (!user) {
      if (sub.startsWith('/api/')) return json({ error: 'Not logged in' }, 401);
      if (sub === '/' && request.method === 'GET') return respond(LOGIN_HTML);
      return respond('Not found', 404, 'text/plain');
    }

    try {
      if (sub === '/' && request.method === 'GET') return respond(APP_HTML);
      if (sub === '/app.js') return respond(APP_JS, 200, 'text/javascript; charset=utf-8');
      if (sub === '/api/session' && request.method === 'GET') return json({ athlete: user.name, session: await getSession(env, user) });
      if (sub === '/api/save' && request.method === 'POST') {
        if (!sameOrigin(request) || !(request.headers.get('Content-Type') || '').startsWith('application/json')) {
          return json({ error: 'Forbidden' }, 403);
        }
        return await saveSession(env, user, await request.json().catch(() => null));
      }
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, e.status === 404 ? 404 : 502);
    }
    return respond('Not found', 404, 'text/plain');
  },
};
