// Vanish browser app. One script, five pages (picked by <body data-page>).
// Rule: anything that came out of a decryption is inserted with textContent, never as HTML.
import * as C from './crypto.js';

const app = document.getElementById('app');
const PAGE = document.body.dataset.page;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 3;
const MAX_MSG = 4000;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥'];
const SMILE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MAX_PHOTO_EDGE = 1920; // photos are shrunk to this many pixels on the long side before encrypting
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;
// Giphy GIFs are shown straight from Giphy's image servers. Only those URLs are accepted from a message.
const GIPHY_URL_RE = /^https:\/\/(?:media\d*|i)\.giphy\.com\/[A-Za-z0-9/_.\-?=&%]+$/;
const okGiphyUrl = (u) => typeof u === 'string' && u.length < 600 &&
  (GIPHY_URL_RE.test(u) || (location.hostname === 'localhost' && u === '/secret/assets/icon.svg')); // the second form is for local tests only
const MAX_GIF_BYTES = 5 * 1024 * 1024; // GIFs are sent as-is (re-drawing would freeze the animation)

// GIFs keep their animation, so they skip the canvas step. Only their size is read here.
async function prepareGif(file) {
  if (file.size > MAX_GIF_BYTES) throw new Error('GIFs can be up to 5 MB. That one is bigger.');
  let w = 4;
  let h = 3;
  try { const bmp = await createImageBitmap(file); w = bmp.width; h = bmp.height; bmp.close?.(); } catch { throw new Error('That GIF could not be read.'); }
  return { bytes: new Uint8Array(await file.arrayBuffer()), w, h, preview: URL.createObjectURL(file), gif: true };
}
const REPLY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10 7 4 12l6 5M4 12h10a6 6 0 0 1 6 6v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CAMERA_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9 4h6l1.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5L9 4zm3 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg>';

// Redraws a photo on a canvas and saves it as JPEG. That shrinks it AND strips hidden metadata
// (GPS location, camera details), because only the pixels are copied.
async function shrinkPhoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('That file is not a photo this browser can read.'); }
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff'; // transparent PNGs get a white background instead of black
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  let blob;
  for (let q = 0.85; ; q -= 0.15) {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (!blob) throw new Error('This browser could not prepare that photo.');
    if (blob.size <= MAX_PHOTO_BYTES || q <= 0.4) break;
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, preview: URL.createObjectURL(blob) };
}

// ---------- small helpers ----------
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}

async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof Uint8Array) {
    opts.body = body;
    opts.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  if (raw && res.ok) return res;
  let data = {};
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status}).`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const fmtWhen = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = (ts) => {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : fmtWhen(ts);
};
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
// "6d 23h", "3h 12m", "42 min", "under a minute"
function fmtLeft(ts) {
  const mins = Math.max(0, Math.floor((ts - Date.now()) / 60000));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
async function roomName(key, data) {
  if (!data) return '';
  try { return String(await C.unsealText(key, data)).slice(0, 40); } catch { return ''; }
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el('textarea', { class: 'offscreen' });
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  const old = [...btn.childNodes];
  btn.textContent = 'Copied';
  setTimeout(() => { btn.replaceChildren(...old); }, 1500);
}

function linkBox(link) {
  const input = el('input', { type: 'text', readonly: true, class: 'link', 'aria-label': 'Link', onfocus: (e) => e.target.select() });
  input.value = link;
  const btn = el('button', { type: 'button', class: 'primary', onclick: () => copy(link, btn) }, 'Copy link');
  return el('div', { class: 'linkbox' }, input, btn);
}

function status() {
  const p = el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  p.say = (text, bad = false) => { p.textContent = text; p.className = `msg${bad ? ' bad' : ''}`; };
  return p;
}

// Static markup (no user data), shared by the burst animation and the "it's gone" pages.
const CLOUD_SVG = '<svg viewBox="0 0 120 80" aria-hidden="true"><g fill="currentColor"><circle cx="38" cy="48" r="20"/><circle cx="60" cy="34" r="25"/><circle cx="84" cy="48" r="18"/><rect x="30" y="46" width="62" height="22" rx="11"/></g></svg>';

function cloud(cls) {
  const d = el('div', { class: cls, 'aria-hidden': 'true' });
  d.innerHTML = CLOUD_SVG;
  return d;
}

// The poof burst: a cloud pops, sparkles fly out, then it all clears away.
function poofBurst({ big = false, sub = 'Deleted from the server' } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const fx = el('div', { class: `poof-fx${big ? ' big' : ''}`, 'aria-hidden': 'true' }, cloud('poof-cloud'));
  const n = big ? 14 : 9;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const r = (big ? 170 : 120) + Math.random() * 60;
    const dot = el('span', { class: 'spark' });
    dot.style.setProperty('--dx', `${Math.round(Math.cos(a) * r)}px`);
    dot.style.setProperty('--dy', `${Math.round(Math.sin(a) * r)}px`);
    dot.style.setProperty('--s', `${(0.6 + Math.random() * 0.9).toFixed(2)}`);
    fx.append(dot);
  }
  if (big) fx.append(el('div', { class: 'poof-word' }, 'Poof!', el('small', { text: sub })));
  document.body.append(fx);
  setTimeout(() => fx.remove(), big ? 2300 : 1400);
}

function notice(title, body, { poof = false } = {}) {
  app.replaceChildren(el('section', { class: 'card narrow center' },
    poof && cloud('gone-cloud'), el('h1', { text: title }), el('p', { class: 'muted', text: body })));
}

function field(label, input, hint) {
  return el('div', { class: 'field' }, el('label', { for: input.id, text: label }), input, hint && el('p', { class: 'hint', text: hint }));
}

const idFromPath = () => location.pathname.split('/')[3];

// ---------- pages ----------
function login() {
  const input = el('input', { type: 'password', id: 'code', autocomplete: 'current-password', autocapitalize: 'none', spellcheck: 'false', required: true });
  const msg = status();
  const btn = el('button', { type: 'submit', class: 'primary' }, 'Continue');
  const form = el('form', {
    class: 'card narrow',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await api('/secret/api/login', { method: 'POST', body: { code: input.value } });
        location.reload();
      } catch (err) {
        msg.say(err.message, true);
        btn.disabled = false;
      }
    },
  },
  el('h1', { text: 'Sign in' }),
  el('p', { class: 'muted', text: 'You need the access code to send poofs and start chat rooms. Opening a poof someone sent you does not.' }),
  field('Access code', input), btn, msg);
  app.replaceChildren(form);
  input.focus();
}

function createSecret() {
  const text = el('textarea', { id: 'text', rows: 4, maxlength: 50000, placeholder: 'A password, API key, note...' });
  const files = [];
  const list = el('ul', { class: 'files' });
  const msg = status();
  const picker = el('input', {
    type: 'file', multiple: true, class: 'offscreen', tabindex: '-1', 'aria-hidden': 'true',
    onchange: () => {
      for (const f of picker.files) {
        if (files.length >= MAX_FILES) { msg.say(`Up to ${MAX_FILES} files.`, true); break; }
        if (f.size > MAX_FILE) { msg.say(`${f.name} is over 10 MB.`, true); continue; }
        files.push(f);
      }
      picker.value = '';
      renderFiles();
    },
  });
  const addBtn = el('button', { type: 'button', class: 'ghost small', onclick: () => picker.click() }, '+ Attach a file');
  function renderFiles() {
    list.replaceChildren(...files.map((f, i) => el('li', {},
      el('span', { class: 'fname', text: f.name }), el('span', { class: 'muted', text: fmtSize(f.size) }),
      el('button', { type: 'button', class: 'link-btn', 'aria-label': `Remove ${f.name}`, onclick: () => { files.splice(i, 1); renderFiles(); } }, 'Remove'))));
    addBtn.disabled = files.length >= MAX_FILES;
  }

  const views = el('input', { type: 'number', id: 'views', min: 1, max: 20, value: 3, inputmode: 'numeric' });
  const hours = el('input', { type: 'number', id: 'hours', min: 1, max: 720, value: 72, inputmode: 'numeric' });
  const pass = el('input', { type: 'text', id: 'pass', autocomplete: 'off', spellcheck: 'false', placeholder: 'Optional' });
  const submit = el('button', { type: 'submit', class: 'primary wide' }, 'Create poof link');

  async function onSubmit(e) {
    e.preventDefault();
    const v = Number(views.value);
    const h = Number(hours.value);
    if (!text.value.trim() && !files.length) return msg.say('Type something or attach a file.', true);
    if (!Number.isInteger(v) || v < 1 || v > 20) return msg.say('Views must be a whole number from 1 to 20.', true);
    if (!Number.isInteger(h) || h < 1 || h > 720) return msg.say('Hours must be a whole number from 1 to 720 (30 days).', true);
    submit.disabled = true;
    try {
      msg.say('Encrypting in your browser...');
      const linkKey = C.newLinkKey();
      const { key, verifier } = await C.deriveKeys(linkKey, pass.value);
      const names = await Promise.all(files.map((f) => C.sealJson(key, { name: f.name, type: f.type || 'application/octet-stream' })));
      const { id, manage } = await api('/secret/api/create', {
        method: 'POST',
        body: { text: await C.sealText(key, text.value), verifier, hasPass: !!pass.value, maxViews: v, hours: h, files: names.map((name) => ({ name })) },
      });
      for (let i = 0; i < files.length; i++) {
        msg.say(`Encrypting and uploading file ${i + 1} of ${files.length}...`);
        const sealed = await C.seal(key, new Uint8Array(await files[i].arrayBuffer()));
        await api(`/secret/api/s/${id}/file/${i}`, { method: 'PUT', body: sealed, headers: { 'X-Manage-Token': manage } });
      }
      await api(`/secret/api/s/${id}/finalize`, { method: 'POST', headers: { 'X-Manage-Token': manage } });
      created({ id, manage, link: `${location.origin}/secret/s/${id}#${linkKey}`, v, h, hasPass: !!pass.value });
    } catch (err) {
      msg.say(err.status === 401 ? 'Your sign-in expired. Reload the page.' : err.message, true);
      submit.disabled = false;
    }
  }

  app.replaceChildren(el('div', { class: 'split' },
    el('form', { class: 'card', onsubmit: onSubmit },
      el('h1', { text: 'Send a poof' }),
      field('Your secret', text),
      el('div', { class: 'field' }, el('div', { class: 'attach-row' }, addBtn, el('span', { class: 'hint', text: 'Optional. Up to 3 files, 10 MB each.' })), list, picker),
      el('div', { class: 'opts' }, field('Max views', views), field('Max hours', hours), field('Passphrase', pass)),
      el('p', { class: 'hint opts-hint', text: 'Deleted after the views or the hours run out, whichever comes first. If you set a passphrase, send it a different way than the link (for example, by text).' }),
      submit, msg),
    el('aside', { class: 'about' },
      el('h2', { text: 'How it works' }),
      el('p', { text: 'A poof is a link to a secret that disappears. It is encrypted in this browser before it is uploaded. The key is in the part of the link after the #, and browsers never send that part to a server, so the server only stores scrambled data and cannot read it.' }),
      el('p', { text: 'Once the views run out or the time is up: poof, it is deleted for good. There are no backups.' }),
      el('p', { text: 'For extra safety, send the username one way and the poof another way, so the full credentials are never in one place.' }))));
  text.focus();
}

function created({ id, manage, link, v, h, hasPass }) {
  const msg = status();
  const del = el('button', {
    type: 'button', class: 'danger',
    onclick: async () => {
      if (!confirm('Delete this poof now? The link will stop working.')) return;
      try {
        await api(`/secret/api/s/${id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': manage } });
        notice('Poof! Deleted.', 'It is gone and the link no longer works.', { poof: true });
      } catch (err) { msg.say(err.status === 404 ? 'It is already gone.' : err.message, true); }
    },
  }, 'Delete it now');
  app.replaceChildren(el('section', { class: 'card narrow' },
    el('h1', { text: 'Your poof is ready' }),
    linkBox(link),
    el('p', { text: `It can be opened ${plural(v, 'time')}, and it expires ${fmtWhen(Date.now() + h * 3600000)}, whichever comes first.` }),
    hasPass && el('p', { class: 'callout', text: 'Remember to send the passphrase separately (a text message works). Without it, the link is useless.' }),
    el('p', { class: 'muted', text: 'This link is the only way to open the poof. If you lose it, nobody can recover it, including the site owner.' }),
    el('div', { class: 'actions' }, del, el('a', { class: 'button ghost', href: '/secret' }, 'Send another')),
    msg));
}

async function viewSecret() {
  const id = idFromPath();
  const linkKey = location.hash.slice(1);
  if (!linkKey) return notice('This link is incomplete', 'The part of the link after the # is missing, and that part is the key. Ask the sender for the full link.');
  let info;
  try {
    info = await api(`/secret/api/s/${id}`);
  } catch (err) {
    notice('Poof! It is gone.', err.status === 404
      ? 'It was already opened the maximum number of times, it expired, or the link is wrong. Ask the sender to make a new one.'
      : err.message, { poof: err.status === 404 });
    if (err.status === 404) poofBurst({ big: true, sub: 'This one is already gone' });
    return;
  }
  const pass = info.hasPass ? el('input', { type: 'password', id: 'pass', autocomplete: 'off', required: true }) : null;
  const btn = el('button', { type: 'submit', class: 'primary wide' }, 'Open the poof');
  const msg = status();
  const uses = info.viewsLeft === 1
    ? 'This is the last view: once you open it, poof, it is deleted.'
    : `Opening it uses 1 of the ${info.viewsLeft} views left.`;
  app.replaceChildren(el('form', {
    class: 'card narrow',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.say(info.hasPass ? 'Checking the passphrase...' : 'Decrypting...');
      try {
        const { key, verifier } = await C.deriveKeys(linkKey, pass ? pass.value : '');
        const data = await api(`/secret/api/s/${id}/open`, { method: 'POST', body: { verifier } });
        await revealed(id, key, data);
      } catch (err) {
        btn.disabled = false;
        if (err.status === 403) msg.say(`Wrong passphrase. ${err.data.triesLeft} ${err.data.triesLeft === 1 ? 'try' : 'tries'} left before it destroys itself.`, true);
        else if (err.status === 410) { notice('Poof! Destroyed.', err.message, { poof: true }); poofBurst({ big: true }); }
        else if (err.status === 404) { notice('Poof! It is gone.', 'Someone else may have just used the last view.', { poof: true }); poofBurst({ big: true, sub: 'Someone used the last view' }); }
        else msg.say(err.message, true);
      }
    },
  },
  el('h1', { text: 'Someone sent you a poof' }),
  el('p', { text: `${uses} It expires ${fmtWhen(info.expiresAt)}.` }),
  info.files > 0 && el('p', { class: 'muted', text: `It includes ${plural(info.files, 'attachment')}.` }),
  pass && field('Passphrase', pass, 'The sender should have given you this separately.'),
  btn, msg));
  (pass || btn).focus();
}

async function revealed(id, key, data) {
  history.replaceState(null, '', location.pathname); // drop the key from the address bar and history
  let text;
  try { text = await C.unsealText(key, data.text); } catch { text = null; }
  const files = await Promise.all(data.files.map(async (f) => {
    try { return { ...(await C.unsealJson(key, f.name)), size: f.size }; } catch { return { name: 'attachment', type: 'application/octet-stream', size: f.size }; }
  }));
  const msg = status();
  const textBlock = text === null
    ? el('p', { class: 'msg bad', text: 'This could not be decrypted. The link may be damaged.' })
    : text.length > 0 && el('div', { class: 'secret' },
      el('pre', { text }),
      (() => { const b = el('button', { type: 'button', class: 'ghost', onclick: () => copy(text, b) }, 'Copy'); return b; })());

  const fileRows = files.map((f, i) => {
    const b = el('button', {
      type: 'button', class: 'ghost',
      onclick: async () => {
        b.disabled = true;
        msg.say(`Downloading ${f.name}...`);
        try {
          const res = await api(`/secret/api/s/${id}/file/${i}?t=${encodeURIComponent(data.ticket)}`, { raw: true });
          const plain = await C.unseal(key, await res.arrayBuffer());
          // Always a plain download: never trust the sender's claimed file type with our page's origin.
          const url = URL.createObjectURL(new Blob([plain], { type: 'application/octet-stream' }));
          const a = el('a', { href: url, download: f.name || 'attachment' });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          msg.say('');
        } catch (err) { msg.say(err.message, true); }
        b.disabled = false;
      },
    }, 'Download');
    return el('li', {}, el('span', { class: 'fname', text: f.name }), el('span', { class: 'muted', text: fmtSize(Math.max(0, f.size - 28)) }), b);
  });

  const left = data.viewsLeft === 0
    ? (files.length ? 'That was the last view, so it has been deleted from the server (poof). The attachments can still be downloaded for the next 10 minutes.'
      : 'That was the last view, so it has been deleted from the server (poof).')
    : `It can be opened ${plural(data.viewsLeft, 'more time')}.`;
  app.replaceChildren(el('section', { class: 'card narrow' },
    el('h1', { text: 'Here is your poof' }),
    textBlock,
    files.length > 0 && el('ul', { class: 'files' }, fileRows),
    el('p', { class: 'callout', text: `${left} Save what you need before leaving this page.` }),
    msg));
  if (data.viewsLeft === 0) poofBurst({ big: true }); // only the view that destroys it gets the burst
}

function createRoom() {
  const life = el('select', { id: 'life' },
    el('option', { value: '24' }, '1 day'), el('option', { value: '168', selected: true }, '1 week'), el('option', { value: '720' }, '30 days'));
  const pass = el('input', { type: 'text', id: 'pass', autocomplete: 'off', spellcheck: 'false', placeholder: 'Optional' });
  const rname = el('input', { type: 'text', id: 'rname', maxlength: 40, autocomplete: 'off', placeholder: 'e.g. Lunch crew' });
  const submit = el('button', { type: 'submit', class: 'primary wide' }, 'Create chat room');
  const msg = status();
  app.replaceChildren(el('div', { class: 'split' },
    el('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const linkKey = C.newLinkKey();
          const { key, verifier } = await C.deriveKeys(linkKey, pass.value);
          const title = rname.value.trim().slice(0, 40);
          const name = title ? await C.sealText(key, title) : '';
          const { id, manage } = await api('/chat/api/create', { method: 'POST', body: { verifier, hasPass: !!pass.value, hours: Number(life.value), name } });
          store.set(`vanish-manage-${id}`, manage);
          const link = `${location.origin}/chat/r/${id}#${linkKey}`;
          app.replaceChildren(el('section', { class: 'card narrow' },
            el('h1', { text: title ? `"${title}" is ready` : 'Your chat room is ready' }),
            el('p', { text: 'Send this link to the people you want in the room. Anyone with the link can join, so share it only with them.' }),
            linkBox(link),
            pass.value && el('p', { class: 'callout', text: 'Send the passphrase separately. People need both to get in.' }),
            el('div', { class: 'actions' }, el('a', { class: 'button primary', href: link }, 'Open the room'))));
        } catch (err) {
          msg.say(err.status === 401 ? 'Your sign-in expired. Reload the page.' : err.message, true);
          submit.disabled = false;
        }
      },
    },
    el('h1', { text: 'Start a chat room' }),
    field('Room name', rname, 'Optional. Shows in the browser tab, so you can tell rooms apart. Encrypted like the messages.'),
    field('Delete the room and all messages after', life),
    field('Passphrase', pass, 'Optional. Adds a second lock on top of the link.'),
    submit, msg),
    el('aside', { class: 'about' },
      el('h2', { text: 'How it works' }),
      el('p', { text: 'Messages are encrypted in each person\'s browser with a key that is only in the room link, after the #. The server passes scrambled messages along and cannot read them, or even your names.' }),
      el('p', { text: 'When the room expires, it and every message in it are deleted. There are no backups.' }),
      el('p', { text: 'No accounts: you pick a display name when you join.' }))));
}

async function room() {
  const id = idFromPath();
  const linkKey = location.hash.slice(1);
  if (!linkKey) return notice('This link is incomplete', 'The part of the link after the # is missing, and that part is the key. Ask for the full link.');
  let info;
  try {
    info = await api(`/chat/api/r/${id}`);
  } catch (err) {
    return notice('Poof! This room is gone.', err.status === 404 ? 'It expired or was deleted.' : err.message, { poof: err.status === 404 });
  }
  const name = el('input', { type: 'text', id: 'name', maxlength: 40, required: true, autocomplete: 'nickname' });
  name.value = store.get('vanish-name') || '';
  const pass = info.hasPass ? el('input', { type: 'password', id: 'pass', autocomplete: 'off', required: true }) : null;
  const btn = el('button', { type: 'submit', class: 'primary wide' }, 'Join');
  const msg = status();
  const joinTitle = el('h1', { text: 'Join the chat' });
  if (!info.hasPass && info.name) {
    C.deriveKeys(linkKey).then(({ key }) => roomName(key, info.name)).then((n) => {
      if (n) { joinTitle.textContent = `Join "${n}"`; document.title = `${n} - Poof`; }
    }).catch(() => {});
  }
  app.replaceChildren(el('form', {
    class: 'card narrow',
    onsubmit: async (e) => {
      e.preventDefault();
      const who = name.value.trim().slice(0, 40);
      if (!who) return msg.say('Pick a display name.', true);
      btn.disabled = true;
      try {
        const keys = await C.deriveKeys(linkKey, pass ? pass.value : '');
        await api(`/chat/api/r/${id}/check`, { method: 'POST', body: { verifier: keys.verifier } });
        store.set('vanish-name', who);
        chat(id, info, keys, who);
      } catch (err) {
        btn.disabled = false;
        if (err.status === 404) notice('Poof! This room is gone.', 'It expired or was deleted.', { poof: true });
        else msg.say(err.message, true);
      }
    },
  },
  joinTitle,
  el('p', { class: 'muted', text: `This room and all its messages auto-delete in ${fmtLeft(info.expiresAt)} (${fmtWhen(info.expiresAt)}).` }),
  field('Your display name', name), pass && field('Passphrase', pass), btn, msg));
  (name.value ? (pass || btn) : name).focus();
}

function chat(id, info, { key, verifier }, myName) {
  document.body.classList.add('chat-page');
  let sender = store.get('vanish-sender');
  if (!sender) { sender = C.toB64u(crypto.getRandomValues(new Uint8Array(9))); store.set('vanish-sender', sender); }
  const manage = store.get(`vanish-manage-${id}`);
  let unread = 0;
  let baseTitle = document.title;
  const titleEl = el('strong', { text: 'Chat room' });
  function setName(n) {
    titleEl.textContent = n || 'Chat room';
    baseTitle = `${n || 'Chat room'} - Poof`;
    document.title = unread ? `(${unread}) ${baseTitle}` : baseTitle;
  }
  roomName(key, info.name).then(setName);
  const left = el('span', { title: `Deleted ${fmtWhen(info.expiresAt)}` });
  const tick = () => { left.textContent = `Auto-deletes in ${fmtLeft(info.expiresAt)}`; };
  tick();
  const ticker = setInterval(tick, 30000);
  let ws;
  let retry = 0;
  let ended = false;
  let ping;
  let queue = Promise.resolve();
  let pending = null; // photo waiting in the tray: { bytes, w, h, preview }
  const photos = new Map(); // photo id -> Promise<object URL of the decrypted photo>
  const rows = new Map(); // message id -> its row element (to update reaction chips)
  const reactions = new Map(); // message id -> Map("<sender>|<emoji>" -> { on, name })
  let emojiPicker = null; // the open emoji picker, if any
  let replyTo = null; // { id, n, s, t } of the message being replied to

  const log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  const online = el('span', { class: 'online' });
  const conn = el('span', { class: 'conn' });
  const box = el('textarea', { rows: 1, maxlength: MAX_MSG, placeholder: 'Message', 'aria-label': 'Message' });
  const send = el('button', { type: 'submit', class: 'primary' }, 'Send');
  const tray = el('div', { class: 'tray', hidden: true });
  const replyLabel = el('span', { class: 'reply-label' });
  const replyBar = el('div', { class: 'reply-bar', hidden: true }, replyLabel,
    el('button', { type: 'button', class: 'link-btn plain reply-cancel', 'aria-label': 'Cancel reply', title: 'Cancel reply', onclick: () => cancelReply() }, '✕'));
  const picker = el('input', {
    type: 'file', accept: 'image/*', class: 'offscreen', tabindex: '-1', 'aria-hidden': 'true',
    onchange: () => { if (picker.files[0]) choosePhoto(picker.files[0]); picker.value = ''; },
  });
  const photoBtn = el('button', { type: 'button', class: 'ghost icon', 'aria-label': 'Add a photo', title: 'Add a photo', onclick: () => picker.click() });
  const gifBtn = el('button', { type: 'button', class: 'ghost icon gif-btn', 'aria-label': 'Send a GIF', title: 'Send a GIF', 'aria-expanded': 'false', onclick: () => toggleGifs() }, 'GIF');
  const gifSearch = el('input', { type: 'search', class: 'gif-search', placeholder: 'Search GIPHY', 'aria-label': 'Search GIFs', maxlength: 50 });
  const gifGrid = el('div', { class: 'gif-grid', role: 'list' });
  const gifPanel = el('div', { class: 'gif-panel', hidden: true },
    el('div', { class: 'gif-top' }, gifSearch, el('button', { type: 'button', class: 'link-btn plain gif-close', 'aria-label': 'Close GIF search', title: 'Close', onclick: () => toggleGifs(false) }, '✕')),
    gifGrid, el('p', { class: 'giphy-attr' }, 'Powered by GIPHY'));
  photoBtn.innerHTML = CAMERA_SVG; // static markup, not user data
  const inviteBtn = el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Copy invite link', onclick: () => copy(location.href, inviteBtn) },
    el('span', { class: 'lbl-long' }, 'Copy invite link'), el('span', { class: 'lbl-short' }, 'Invite'));
  const renameBtn = manage && el('button', {
    type: 'button', class: 'ghost small',
    onclick: async () => {
      const n = prompt('Room name (shows in the browser tab):', titleEl.textContent === 'Chat room' ? '' : titleEl.textContent);
      if (n === null) return;
      const clean = n.trim().slice(0, 40);
      try {
        await api(`/chat/api/r/${id}/rename`, { method: 'POST', body: { name: clean ? await C.sealText(key, clean) : '' }, headers: { 'X-Manage-Token': manage } });
      } catch (err) { flash(err.message); }
    },
  }, 'Rename');
  const delBtn = manage && el('button', {
    type: 'button', class: 'danger small',
    onclick: async () => {
      if (!confirm('Delete this room and every message in it for everyone?')) return;
      try {
        await api(`/chat/api/r/${id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': manage } });
        store.del(`vanish-manage-${id}`);
      } catch (err) { setConn(err.message); }
    },
  }, el('span', { class: 'lbl-long' }, 'Delete room'), el('span', { class: 'lbl-short' }, 'Delete'));

  const setConn = (t) => { conn.textContent = t; conn.hidden = !t; };
  const flash = (t) => { setConn(t); setTimeout(() => { if (conn.textContent === t) setConn(''); }, 4000); };

  // ----- replies -----
  // The quote (who + first 100 characters) travels inside the encrypted message, so it still shows after the
  // original scrolls out of history, and the server never learns who replied to what.
  function startReply(info) {
    replyTo = info;
    replyLabel.replaceChildren(el('strong', { text: `Replying to ${info.s === sender ? 'yourself' : info.n}` }), document.createTextNode(info.t ? `: ${info.t}` : ''));
    replyBar.hidden = false;
    box.focus();
  }
  function cancelReply() { replyTo = null; replyBar.hidden = true; }
  function jumpTo(id) {
    const row = rows.get(id);
    if (!row || !row.isConnected) { flash('That message is no longer in the chat.'); return; }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1600);
  }

  // ----- GIF search -----
  let gifTimer;
  let gifSeq = 0;
  function toggleGifs(show = gifPanel.hidden) {
    gifPanel.hidden = !show;
    gifBtn.setAttribute('aria-expanded', String(show));
    if (show) { gifSearch.focus(); if (!gifGrid.childElementCount) loadGifs(''); } else box.focus();
  }
  async function loadGifs(q) {
    const seq = ++gifSeq; // ignore answers to older searches that arrive late
    gifGrid.replaceChildren(el('p', { class: 'muted gif-note', text: 'Loading...' }));
    try {
      const { results } = await api(`/chat/api/r/${id}/gifs?q=${encodeURIComponent(q)}`, { headers: { 'X-Room-Verifier': verifier } });
      if (seq !== gifSeq) return;
      gifGrid.replaceChildren(...(results.length ? results.filter((g) => okGiphyUrl(g.p) && okGiphyUrl(g.u)).map((g) => {
        const b = el('button', { type: 'button', class: 'gif-pick', role: 'listitem', title: g.title, 'aria-label': `Send GIF: ${g.title || 'untitled'}`, onclick: () => sendGif(g) },
          el('img', { src: g.p, alt: g.title || 'GIF', loading: 'lazy', referrerpolicy: 'no-referrer' }));
        b.style.aspectRatio = `${g.pw} / ${g.ph}`;
        return b;
      }) : [el('p', { class: 'muted gif-note', text: 'No GIFs found. Try another word.' })]));
    } catch (err) {
      if (seq === gifSeq) gifGrid.replaceChildren(el('p', { class: 'muted gif-note', text: err.message }));
    }
  }
  gifSearch.addEventListener('input', () => { clearTimeout(gifTimer); gifTimer = setTimeout(() => loadGifs(gifSearch.value.trim()), 350); });
  gifSearch.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); toggleGifs(false); } });
  async function sendGif(g) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { flash('Not connected yet. Try again in a moment.'); return; }
    ws.send(JSON.stringify({ type: 'msg', data: await C.sealJson(key, { n: myName, s: sender, t: '', gif: { u: g.u, w: g.w, h: g.h, t: g.title }, ...(replyTo && { r: replyTo }) }) }));
    cancelReply();
    toggleGifs(false);
  }
  function openGiphy(u, title) {
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const closeBtn = el('button', { type: 'button', class: 'ghost small on-dark', onclick: close }, 'Close');
    const overlay = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'GIF', onclick: (e) => { if (e.target === overlay) close(); } },
      el('img', { src: u, alt: title || 'GIF', referrerpolicy: 'no-referrer' }),
      el('div', { class: 'lightbox-bar' }, el('span', { class: 'giphy-attr on-dark-text', text: 'via GIPHY' }), closeBtn));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
  }

  // ----- photos -----
  function fetchPhoto(imgId, gif = false) {
    if (!photos.has(imgId)) {
      const p = (async () => {
        const res = await api(`/chat/api/r/${id}/img/${imgId}`, { raw: true, headers: { 'X-Room-Verifier': verifier } });
        const plain = await C.unseal(key, await res.arrayBuffer());
        // Only two types are ever used, whatever the sender claims.
        return URL.createObjectURL(new Blob([plain], { type: gif ? 'image/gif' : 'image/jpeg' }));
      })();
      photos.set(imgId, p);
      p.catch(() => photos.delete(imgId));
    }
    return photos.get(imgId);
  }
  // Only download photos as they scroll into view, so a long history doesn't fetch everything at once.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const frame = e.target;
      fetchPhoto(frame.dataset.img, frame.dataset.gif === '1').then((url) => {
        frame.querySelector('img').src = url;
        frame.classList.add('loaded');
      }).catch((err) => {
        frame.classList.add('missing');
        frame.querySelector('.ph').textContent = err.status === 404 ? 'Photo no longer available' : 'Photo could not be loaded';
      });
    }
  }, { root: log, rootMargin: '600px 0px' });

  async function openPhoto(imgId, ts, gif = false) {
    let url;
    try { url = await fetchPhoto(imgId, gif); } catch { return; }
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); photoBtn.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const closeBtn = el('button', { type: 'button', class: 'ghost small on-dark', onclick: close }, 'Close');
    const overlay = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo', onclick: (e) => { if (e.target === overlay) close(); } },
      el('img', { src: url, alt: 'Photo' }),
      el('div', { class: 'lightbox-bar' },
        el('a', { class: 'button primary small', href: url, download: `poof-${gif ? 'gif' : 'photo'}-${new Date(ts).toISOString().slice(0, 10)}.${gif ? 'gif' : 'jpg'}` }, 'Download'),
        closeBtn));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
  }

  function clearPending() {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    pending = null;
    tray.hidden = true;
    tray.replaceChildren();
    box.placeholder = 'Message';
  }
  async function choosePhoto(file) {
    if (!file.type.startsWith('image/')) return flash('That is not a photo.');
    setConn('Preparing photo...');
    try {
      const shot = file.type === 'image/gif' ? await prepareGif(file) : await shrinkPhoto(file);
      clearPending();
      pending = shot;
      tray.replaceChildren(el('img', { src: shot.preview, alt: shot.gif ? 'GIF to send' : 'Photo to send' }),
        el('span', { class: 'muted', text: 'Add a caption if you like, then press Send.' }),
        el('button', { type: 'button', class: 'link-btn', onclick: () => { clearPending(); box.focus(); } }, 'Remove'));
      tray.hidden = false;
      box.placeholder = 'Caption (optional)';
      setConn('');
      box.focus();
    } catch (err) { flash(err.message); }
  }
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };

  async function render(m) {
    let p;
    try { p = await C.unsealJson(key, m.data); } catch { p = { n: '?', t: '[this message could not be decrypted]' }; }
    const mine = p.s === sender;
    const text = String(p.t ?? '');
    let photo = null;
    if (p.gif && okGiphyUrl(p.gif.u)) {
      const gt = String(p.gif.t || '').slice(0, 80);
      const img = el('img', { src: p.gif.u, alt: gt || 'GIF', loading: 'lazy', referrerpolicy: 'no-referrer' });
      photo = el('button', { type: 'button', class: 'photo gif', 'aria-label': 'Open GIF', onclick: () => openGiphy(p.gif.u, gt) }, el('span', { class: 'ph', text: 'Loading GIF...' }), img);
      img.addEventListener('load', () => photo.classList.add('loaded'));
      img.addEventListener('error', () => { photo.classList.add('missing'); photo.querySelector('.ph').textContent = 'GIF could not be loaded'; });
      photo.style.aspectRatio = `${Number(p.gif.w) > 0 ? Number(p.gif.w) : 4} / ${Number(p.gif.h) > 0 ? Number(p.gif.h) : 3}`;
    } else if (p.img && typeof p.img.id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(p.img.id)) {
      const w = Number(p.img.w) > 0 ? Number(p.img.w) : 4;
      const h = Number(p.img.h) > 0 ? Number(p.img.h) : 3;
      const gif = p.img.g === 1;
      photo = el('button', { type: 'button', class: `photo${gif ? ' gif' : ''}`, 'data-img': p.img.id, 'data-gif': gif ? '1' : '0',
        'aria-label': gif ? 'Open GIF full size' : 'Open photo full size', onclick: () => openPhoto(p.img.id, m.ts, gif) },
        el('span', { class: 'ph', text: 'Loading photo...' }), el('img', { alt: text ? text.slice(0, 120) : 'Photo' }));
      photo.style.aspectRatio = `${w} / ${h}`; // reserve the space so the chat doesn't jump when it loads
      io.observe(photo);
    }
    const chips = el('div', { class: 'chips' });
    let quote = null;
    if (p.r && Number.isInteger(p.r.id)) {
      const qWho = p.r.s === sender ? 'You' : String(p.r.n || '?').slice(0, 40);
      quote = el('button', { type: 'button', class: 'quote', 'aria-label': `Replying to ${qWho}. Show the original message.`, onclick: () => jumpTo(p.r.id) },
        el('span', { class: 'quote-who', text: qWho }), el('span', { class: 'quote-text', text: String(p.r.t || '').slice(0, 120) }));
    }
    const bubble = el('div', { class: `bubble${mine ? ' mine' : ''}${photo ? ' has-photo' : ''}` },
      el('div', { class: 'meta' }, el('span', { class: 'who', text: mine ? 'You' : String(p.n || '?').slice(0, 40) }), el('time', { text: fmtTime(m.ts) })),
      quote, photo, (text || !photo) && el('div', { class: 'body', text }), chips);
    const reactBtn = el('button', { type: 'button', class: 'react-btn', 'aria-label': 'React to this message', title: 'React',
      onclick: (e) => { e.stopPropagation(); openPicker(m.id, reactBtn); } });
    reactBtn.innerHTML = SMILE_SVG; // static markup
    const snippet = (text || (p.gif || p.img?.g === 1 ? 'GIF' : photo ? '📷 Photo' : '')).replace(/\s+/g, ' ').slice(0, 100);
    const replyInfo = { id: m.id, n: String(p.n || '?').slice(0, 40), s: typeof p.s === 'string' ? p.s : '', t: snippet };
    const replyBtn = el('button', { type: 'button', class: 'reply-btn', 'aria-label': 'Reply to this message', title: 'Reply', onclick: () => startReply(replyInfo) });
    replyBtn.innerHTML = REPLY_SVG; // static markup
    const row = el('div', { class: `row${mine ? ' mine' : ''}`, 'data-id': String(m.id) }, bubble, reactBtn, replyBtn);
    row.chips = chips;
    row.replyInfo = replyInfo;
    rows.set(m.id, row);
    drawChips(m.id);
    return row;
  }

  // ----- reactions -----
  async function applyReact(r) {
    let p;
    try { p = await C.unsealJson(key, r.data); } catch { return; }
    if (!REACTIONS.includes(p.e) || typeof p.s !== 'string') return; // only the known set; ignore anything odd
    if (!reactions.has(r.target)) reactions.set(r.target, new Map());
    reactions.get(r.target).set(`${p.s}|${p.e}`, { on: !!p.on, name: String(p.n || '?').slice(0, 40), s: p.s, e: p.e });
  }
  function drawChips(target) {
    const row = rows.get(target);
    if (!row) return;
    const stick = row.isConnected && nearBottom(); // if we're at the bottom, stay there after the message grows
    const byEmoji = new Map();
    for (const r of reactions.get(target)?.values() || []) {
      if (!r.on) continue;
      if (!byEmoji.has(r.e)) byEmoji.set(r.e, []);
      byEmoji.get(r.e).push(r);
    }
    row.chips.replaceChildren(...REACTIONS.filter((e) => byEmoji.has(e)).map((e) => {
      const list = byEmoji.get(e);
      const mineToo = list.some((r) => r.s === sender);
      const names = list.map((r) => (r.s === sender ? 'You' : r.name)).join(', ');
      return el('button', { type: 'button', class: `chip${mineToo ? ' me' : ''}`, title: names, 'aria-label': `${e} ${list.length}: ${names}. Tap to ${mineToo ? 'remove yours' : 'add yours'}.`,
        onclick: () => sendReact(target, e) }, `${e} ${list.length}`);
    }));
    if (stick) toBottom();
  }
  async function sendReact(target, e) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { flash('Not connected yet. Try again in a moment.'); return; }
    const current = reactions.get(target)?.get(`${sender}|${e}`);
    const on = !current?.on;
    ws.send(JSON.stringify({ type: 'react', target, data: await C.sealJson(key, { s: sender, n: myName, e, on }) }));
  }
  function closePicker() {
    if (!emojiPicker) return;
    emojiPicker.remove();
    emojiPicker = null;
    document.removeEventListener('click', closePicker);
  }
  function openPicker(target, anchor) {
    const same = emojiPicker?.target === target;
    closePicker();
    if (same) return; // second tap on the same button closes it
    const who = REACTIONS.map((e) => {
      const names = [...(reactions.get(target)?.values() || [])].filter((r) => r.on && r.e === e).map((r) => (r.s === sender ? 'You' : r.name));
      return names.length ? `${e} ${names.join(', ')}` : '';
    }).filter(Boolean).join('   ');
    emojiPicker = el('div', { class: 'picker', role: 'menu', 'aria-label': 'Pick a reaction', onclick: (e) => e.stopPropagation() },
      el('div', { class: 'picker-row' }, REACTIONS.map((e) => el('button', { type: 'button', role: 'menuitem', 'aria-label': `React ${e}`,
        onclick: () => { closePicker(); sendReact(target, e); } }, e))),
      el('button', { type: 'button', class: 'picker-reply', role: 'menuitem', onclick: () => { const info = rows.get(target)?.replyInfo; closePicker(); if (info) startReply(info); } }, '↩  Reply'),
      who && el('div', { class: 'picker-who', text: who }));
    emojiPicker.target = target;
    const row = anchor.closest('.row');
    // Open downward when the message is near the top of the chat, so the header doesn't cover the picker.
    if (row.getBoundingClientRect().top - log.getBoundingClientRect().top < 64) emojiPicker.classList.add('below');
    row.append(emojiPicker);
    emojiPicker.querySelector('button').focus();
    setTimeout(() => document.addEventListener('click', closePicker), 0);
  }

  async function handle(raw) {
    if (raw === 'pong') return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'history') {
      rows.clear();
      reactions.clear();
      for (const r of m.reacts || []) await applyReact(r); // in order, so the latest on/off wins
      const nodes = await Promise.all(m.msgs.map(render));
      log.replaceChildren(...(nodes.length ? nodes : [el('p', { class: 'empty muted', text: 'No messages yet. Say hi.' })]));
      toBottom();
    } else if (m.type === 'msg') {
      const stick = nearBottom();
      log.querySelector('.empty')?.remove();
      const node = await render(m);
      log.append(node);
      if (stick || node.classList.contains('mine')) toBottom();
      if (document.hidden && !node.classList.contains('mine')) { unread++; document.title = `(${unread}) ${baseTitle}`; }
    } else if (m.type === 'react') {
      await applyReact(m);
      drawChips(m.target);
    } else if (m.type === 'name') {
      setName(await roomName(key, m.data));
    } else if (m.type === 'presence') {
      const names = new Set();
      for (const h of m.list) { try { const p = await C.unsealJson(key, h); names.add(String(p.n).slice(0, 40)); } catch { /* skip */ } }
      online.textContent = names.size ? ` · Here now: ${[...names].join(', ')}` : '';
    } else if (m.type === 'error') {
      setConn(m.error);
      setTimeout(() => setConn(''), 3000);
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/chat/api/r/${id}/ws`, ['poof', verifier]); // verifier rides in a header, not the URL
    ws.onopen = async () => {
      retry = 0;
      setConn('');
      ws.send(JSON.stringify({ type: 'hello', data: await C.sealJson(key, { n: myName, s: sender }) }));
      clearInterval(ping);
      ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25000);
    };
    ws.onmessage = (ev) => { queue = queue.then(() => handle(ev.data)).catch(() => {}); };
    ws.onclose = async (ev) => {
      clearInterval(ping);
      if (ended) return;
      if (ev.code === 4000 || ev.code === 4001) {
        ended = true;
        clearInterval(ticker);
        poofBurst({ big: true, sub: 'This chat has ended' });
        return notice('Poof! This chat has ended.', ev.reason || 'The room is gone.', { poof: true });
      }
      // The room may have expired while we were away.
      try { await api(`/chat/api/r/${id}`); } catch (err) {
        if (err.status === 404) { ended = true; clearInterval(ticker); poofBurst({ big: true, sub: 'This chat has ended' }); return notice('Poof! This chat has ended.', 'The room expired or was deleted.', { poof: true }); }
      }
      setConn('Reconnecting...');
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };
  }

  async function submit(e) {
    e?.preventDefault();
    const t = box.value.trim();
    if (!t && !pending) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setConn('Not connected yet. Try again in a moment.'); return; }
    let img = null;
    if (pending) {
      send.disabled = true;
      setConn('Encrypting and sending photo...');
      try {
        const sealed = await C.seal(key, pending.bytes);
        const r = await api(`/chat/api/r/${id}/img`, { method: 'PUT', body: sealed, headers: { 'X-Room-Verifier': verifier } });
        img = { id: r.id, w: pending.w, h: pending.h, ...(pending.gif && { g: 1 }) };
        photos.set(r.id, Promise.resolve(pending.preview)); // show our own copy instantly, no re-download
        pending.preview = null;
      } catch (err) {
        send.disabled = false;
        flash(err.message);
        return;
      }
      send.disabled = false;
      setConn('');
    }
    const out = { n: myName, s: sender, t, ...(img && { img }), ...(replyTo && { r: replyTo }) };
    ws.send(JSON.stringify({ type: 'msg', data: await C.sealJson(key, out) }));
    if (img) clearPending();
    cancelReply();
    box.value = '';
    grow();
    box.focus();
  }
  function grow() { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 160)}px`; }
  box.addEventListener('input', grow);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
  });
  box.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); choosePhoto(f); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (emojiPicker) closePicker(); else if (!replyBar.hidden && !document.querySelector('.lightbox')) cancelReply();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { unread = 0; document.title = baseTitle; }
  });

  const section = el('section', { class: 'chat' },
    el('div', { class: 'chat-head' },
      el('div', { class: 'head-text' }, titleEl, el('div', { class: 'sub muted' }, left, online)),
      el('div', { class: 'actions' }, inviteBtn, renameBtn, delBtn)),
    conn, log, replyBar, tray, gifPanel,
    el('form', { class: 'composer', onsubmit: submit }, photoBtn, gifBtn, picker, box, send));
  // Drag a photo anywhere onto the chat.
  section.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); section.classList.add('drop'); }
  });
  section.addEventListener('dragleave', (e) => { if (!section.contains(e.relatedTarget)) section.classList.remove('drop'); });
  section.addEventListener('drop', (e) => {
    e.preventDefault();
    section.classList.remove('drop');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) choosePhoto(f);
  });
  app.replaceChildren(section);
  setConn('Connecting...');
  connect();
  box.focus();
}

// ---------- boot ----------
document.querySelector(`[data-nav="${location.pathname.startsWith('/chat') ? 'chat' : 'secret'}"]`)?.classList.add('active');
const pages = { login, 'create-secret': createSecret, 'view-secret': viewSecret, 'create-room': createRoom, room };
(pages[PAGE] || (() => notice('Not found', 'That page does not exist.')))();
