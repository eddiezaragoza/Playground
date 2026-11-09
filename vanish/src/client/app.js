// Vanish browser app. One script, five pages (picked by <body data-page>).
// Rule: anything that came out of a decryption is inserted with textContent, never as HTML.
import * as C from './crypto.js';

const app = document.getElementById('app');
const PAGE = document.body.dataset.page;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 3;
const MAX_MSG = 4000;

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
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = old; }, 1500);
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

function notice(title, body) {
  app.replaceChildren(el('section', { class: 'card narrow center' }, el('h1', { text: title }), el('p', { class: 'muted', text: body })));
}

function field(label, input, hint) {
  return el('div', { class: 'field' }, el('label', { for: input.id, text: label }), input, hint && el('p', { class: 'hint', text: hint }));
}

const idFromPath = () => location.pathname.split('/')[3];

// ---------- pages ----------
function login() {
  const input = el('input', { type: 'password', id: 'code', autocomplete: 'current-password', required: true });
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
  el('p', { class: 'muted', text: 'You need the access code to create secrets and chat rooms. Opening a link someone sent you does not.' }),
  field('Access code', input), btn, msg);
  app.replaceChildren(form);
  input.focus();
}

function createSecret() {
  const text = el('textarea', { id: 'text', rows: 7, maxlength: 50000, placeholder: 'A password, API key, note...' });
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
  const addBtn = el('button', { type: 'button', class: 'ghost', onclick: () => picker.click() }, '+ Attach a file');
  function renderFiles() {
    list.replaceChildren(...files.map((f, i) => el('li', {},
      el('span', { class: 'fname', text: f.name }), el('span', { class: 'muted', text: fmtSize(f.size) }),
      el('button', { type: 'button', class: 'link-btn', 'aria-label': `Remove ${f.name}`, onclick: () => { files.splice(i, 1); renderFiles(); } }, 'Remove'))));
    addBtn.disabled = files.length >= MAX_FILES;
  }

  const views = el('input', { type: 'number', id: 'views', min: 1, max: 20, value: 2, inputmode: 'numeric' });
  const hours = el('input', { type: 'number', id: 'hours', min: 1, max: 720, value: 72, inputmode: 'numeric' });
  const pass = el('input', { type: 'text', id: 'pass', autocomplete: 'off', spellcheck: 'false', placeholder: 'Optional' });
  const submit = el('button', { type: 'submit', class: 'primary wide' }, 'Create secret link');

  async function onSubmit(e) {
    e.preventDefault();
    const v = Number(views.value);
    const h = Number(hours.value);
    if (!text.value.trim() && !files.length) return msg.say('Type a secret or attach a file.', true);
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
      el('h1', { text: 'Share a secret' }),
      field('The secret is...', text),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'Attachments (optional, up to 3, 10 MB each)' }), list, addBtn, picker),
      el('div', { class: 'row' }, field('Forget it after (views)', views), el('span', { class: 'or', text: 'or' }), field('hours', hours)),
      field('Passphrase', pass, 'Optional. If you set one, send it a different way than the link (for example, by text).'),
      submit, msg),
    el('aside', { class: 'about' },
      el('h2', { text: 'How it works' }),
      el('p', { text: 'Your secret is encrypted in this browser before it is uploaded. The key is in the part of the link after the #, and browsers never send that part to a server. So the server only stores scrambled data and cannot read your secret.' }),
      el('p', { text: 'Once the views run out or the time is up, the secret is deleted for good. There are no backups.' }),
      el('p', { text: 'For extra safety, send the username one way and the secret link another way, so the full credentials are never in one place.' }))));
  text.focus();
}

function created({ id, manage, link, v, h, hasPass }) {
  const msg = status();
  const del = el('button', {
    type: 'button', class: 'danger',
    onclick: async () => {
      if (!confirm('Delete this secret now? The link will stop working.')) return;
      try {
        await api(`/secret/api/s/${id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': manage } });
        notice('Deleted', 'The secret is gone and the link no longer works.');
      } catch (err) { msg.say(err.status === 404 ? 'It is already gone.' : err.message, true); }
    },
  }, 'Delete it now');
  app.replaceChildren(el('section', { class: 'card narrow' },
    el('h1', { text: 'Your link is ready' }),
    linkBox(link),
    el('p', { text: `It can be opened ${plural(v, 'time')}, and it expires ${fmtWhen(Date.now() + h * 3600000)}, whichever comes first.` }),
    hasPass && el('p', { class: 'callout', text: 'Remember to send the passphrase separately (a text message works). Without it, the link is useless.' }),
    el('p', { class: 'muted', text: 'This link is the only way to read the secret. If you lose it, nobody can recover it, including the site owner.' }),
    el('div', { class: 'actions' }, del, el('a', { class: 'button ghost', href: '/secret' }, 'Share another')),
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
    return notice('This secret is gone', err.status === 404
      ? 'It was already opened the maximum number of times, it expired, or the link is wrong. Ask the sender to make a new one.'
      : err.message);
  }
  const pass = info.hasPass ? el('input', { type: 'password', id: 'pass', autocomplete: 'off', required: true }) : null;
  const btn = el('button', { type: 'submit', class: 'primary wide' }, 'Reveal secret');
  const msg = status();
  const uses = info.viewsLeft === 1
    ? 'This is the last view: once you reveal it, it is deleted.'
    : `Revealing it uses 1 of the ${info.viewsLeft} views left.`;
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
        else if (err.status === 410) notice('Destroyed', err.message);
        else if (err.status === 404) notice('This secret is gone', 'Someone else may have just used the last view.');
        else msg.say(err.message, true);
      }
    },
  },
  el('h1', { text: 'Someone sent you a secret' }),
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
          const url = URL.createObjectURL(new Blob([plain], { type: f.type || 'application/octet-stream' }));
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
    ? (files.length ? 'That was the last view. It has been deleted from the server, and the attachments can be downloaded for the next 10 minutes.'
      : 'That was the last view. It has been deleted from the server.')
    : `It can be opened ${plural(data.viewsLeft, 'more time')}.`;
  app.replaceChildren(el('section', { class: 'card narrow' },
    el('h1', { text: 'Here is your secret' }),
    textBlock,
    files.length > 0 && el('ul', { class: 'files' }, fileRows),
    el('p', { class: 'callout', text: `${left} Save what you need before leaving this page.` }),
    msg));
}

function createRoom() {
  const life = el('select', { id: 'life' },
    el('option', { value: '24' }, '1 day'), el('option', { value: '168', selected: true }, '1 week'), el('option', { value: '720' }, '30 days'));
  const pass = el('input', { type: 'text', id: 'pass', autocomplete: 'off', spellcheck: 'false', placeholder: 'Optional' });
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
          const { verifier } = await C.deriveKeys(linkKey, pass.value);
          const { id, manage } = await api('/chat/api/create', { method: 'POST', body: { verifier, hasPass: !!pass.value, hours: Number(life.value) } });
          store.set(`vanish-manage-${id}`, manage);
          const link = `${location.origin}/chat/r/${id}#${linkKey}`;
          app.replaceChildren(el('section', { class: 'card narrow' },
            el('h1', { text: 'Your chat room is ready' }),
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
    return notice('This room is gone', err.status === 404 ? 'It expired or was deleted.' : err.message);
  }
  const name = el('input', { type: 'text', id: 'name', maxlength: 40, required: true, autocomplete: 'nickname' });
  name.value = store.get('vanish-name') || '';
  const pass = info.hasPass ? el('input', { type: 'password', id: 'pass', autocomplete: 'off', required: true }) : null;
  const btn = el('button', { type: 'submit', class: 'primary wide' }, 'Join');
  const msg = status();
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
        if (err.status === 404) notice('This room is gone', 'It expired or was deleted.');
        else msg.say(err.message, true);
      }
    },
  },
  el('h1', { text: 'Join the chat' }),
  el('p', { class: 'muted', text: `This room and its messages are deleted ${fmtWhen(info.expiresAt)}.` }),
  field('Your display name', name), pass && field('Passphrase', pass), btn, msg));
  (name.value ? (pass || btn) : name).focus();
}

function chat(id, info, { key, verifier }, myName) {
  document.body.classList.add('chat-page');
  let sender = store.get('vanish-sender');
  if (!sender) { sender = C.toB64u(crypto.getRandomValues(new Uint8Array(9))); store.set('vanish-sender', sender); }
  const manage = store.get(`vanish-manage-${id}`);
  const baseTitle = document.title;
  let ws;
  let retry = 0;
  let ended = false;
  let unread = 0;
  let ping;
  let queue = Promise.resolve();

  const log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  const online = el('span', { class: 'online muted' });
  const conn = el('span', { class: 'conn' });
  const box = el('textarea', { rows: 1, maxlength: MAX_MSG, placeholder: 'Message', 'aria-label': 'Message' });
  const send = el('button', { type: 'submit', class: 'primary' }, 'Send');
  const inviteBtn = el('button', { type: 'button', class: 'ghost small', onclick: () => copy(location.href, inviteBtn) }, 'Copy invite link');
  const delBtn = manage && el('button', {
    type: 'button', class: 'danger small',
    onclick: async () => {
      if (!confirm('Delete this room and every message in it for everyone?')) return;
      try {
        await api(`/chat/api/r/${id}/destroy`, { method: 'POST', headers: { 'X-Manage-Token': manage } });
        store.del(`vanish-manage-${id}`);
      } catch (err) { setConn(err.message); }
    },
  }, 'Delete room');

  const setConn = (t) => { conn.textContent = t; conn.hidden = !t; };
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };

  async function render(m) {
    let p;
    try { p = await C.unsealJson(key, m.data); } catch { p = { n: '?', t: '[this message could not be decrypted]' }; }
    const mine = p.s === sender;
    return el('div', { class: `bubble${mine ? ' mine' : ''}` },
      el('div', { class: 'meta' }, el('span', { class: 'who', text: mine ? 'You' : String(p.n || '?').slice(0, 40) }), el('time', { text: fmtTime(m.ts) })),
      el('div', { class: 'body', text: String(p.t ?? '') }));
  }

  async function handle(raw) {
    if (raw === 'pong') return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'history') {
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
    } else if (m.type === 'presence') {
      const names = new Set();
      for (const h of m.list) { try { const p = await C.unsealJson(key, h); names.add(String(p.n).slice(0, 40)); } catch { /* skip */ } }
      online.textContent = names.size ? `Here now: ${[...names].join(', ')}` : '';
    } else if (m.type === 'error') {
      setConn(m.error);
      setTimeout(() => setConn(''), 3000);
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/chat/api/r/${id}/ws?v=${encodeURIComponent(verifier)}`);
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
        return notice('This chat has ended', ev.reason || 'The room is gone.');
      }
      // The room may have expired while we were away.
      try { await api(`/chat/api/r/${id}`); } catch (err) {
        if (err.status === 404) { ended = true; return notice('This chat has ended', 'The room expired or was deleted.'); }
      }
      setConn('Reconnecting...');
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };
  }

  async function submit(e) {
    e?.preventDefault();
    const t = box.value.trim();
    if (!t) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setConn('Not connected yet. Try again in a moment.'); return; }
    ws.send(JSON.stringify({ type: 'msg', data: await C.sealJson(key, { n: myName, s: sender, t }) }));
    box.value = '';
    grow();
    box.focus();
  }
  function grow() { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 160)}px`; }
  box.addEventListener('input', grow);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { unread = 0; document.title = baseTitle; }
  });

  app.replaceChildren(el('section', { class: 'chat' },
    el('div', { class: 'chat-head' },
      el('div', {}, el('strong', { text: 'Chat room' }), el('span', { class: 'muted', text: ` · deleted ${fmtWhen(info.expiresAt)}` }), el('br'), online),
      el('div', { class: 'actions' }, inviteBtn, delBtn)),
    conn, log,
    el('form', { class: 'composer', onsubmit: submit }, box, send)));
  setConn('Connecting...');
  connect();
  box.focus();
}

// ---------- boot ----------
document.querySelector(`[data-nav="${location.pathname.startsWith('/chat') ? 'chat' : 'secret'}"]`)?.classList.add('active');
const pages = { login, 'create-secret': createSecret, 'view-secret': viewSecret, 'create-room': createRoom, room };
(pages[PAGE] || (() => notice('Not found', 'That page does not exist.')))();
