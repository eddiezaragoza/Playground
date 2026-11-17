// Guest page: pick photos, they shrink on the phone and upload two at a time, retrying through bad Wi-Fi.
import { BASE, renderCover, shrink, keepAwake, sleep } from './shared.js';

const $ = (id) => document.getElementById(id);
renderCover(document.querySelector('.cover'));

const NAME_KEY = 'remember-name';
try { $('name').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* private mode */ }

const RAW_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const RAW_MAX = 10 * 1024 * 1024;
const awake = keepAwake();
let queue = []; // { file, li, state: 'waiting'|'sending'|'done'|'failed', name, note }
let running = false;

function onPick(e) {
  const files = [...e.target.files].filter((f) => !f.type || f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  const skipped = e.target.files.length - files.length;
  e.target.value = '';
  if (!files.length) {
    if (skipped) alert('Only photos can be shared here (not videos).');
    return;
  }
  const name = $('name').value.trim();
  const note = $('note').value.trim();
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
  $('note').value = ''; // a note belongs to this batch; the next batch starts fresh

  $('start').hidden = true;
  $('progress').hidden = false;
  $('done-actions').hidden = true;
  for (const file of files) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="thumb"></span><span class="label">Waiting…</span>';
    $('items').prepend(li);
    queue.push({ file, li, state: 'waiting', name, note });
  }
  if (skipped) addNotice(`${skipped} video${skipped > 1 ? 's were' : ' was'} skipped. Only photos can be shared here.`);
  run();
}

function addNotice(text) {
  const li = document.createElement('li');
  li.className = 'notice';
  li.textContent = text;
  $('items').prepend(li);
}

function setState(item, state, label) {
  item.state = state;
  item.li.className = state;
  item.li.querySelector('.label').textContent = label;
}

function updateBar() {
  const total = queue.length;
  const done = queue.filter((q) => q.state === 'done').length;
  const failed = queue.filter((q) => q.state === 'failed').length;
  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
  $('bar-fill').style.width = `${pct}%`;
  document.querySelector('.bar').setAttribute('aria-valuenow', String(pct));
  if (done + failed < total) {
    $('status-title').textContent = `Sending ${done + 1 > total ? total : done + 1} of ${total}…`;
    $('status-text').textContent = "Please keep this page open until it's done.";
  }
  return { total, done, failed };
}

async function send(item) {
  setState(item, 'sending', 'Getting it ready…');
  const small = await shrink(item.file, 2560, 0.85, 480);
  const form = new FormData();
  if (small) {
    form.append('photo', small.photo, 'photo.jpg');
    if (small.thumb) form.append('thumb', small.thumb, 'thumb.jpg');
    showThumb(item, small.thumb || small.photo);
  } else if (RAW_OK.has(item.file.type) && item.file.size <= RAW_MAX) {
    form.append('photo', item.file, 'photo');
  } else {
    setState(item, 'failed', "This photo type can't be read here. Try taking a screenshot of it and sharing that.");
    item.final = true;
    return;
  }
  form.append('name', item.name);
  form.append('note', item.note);

  for (let attempt = 0; attempt < 5; attempt++) {
    setState(item, 'sending', attempt ? `Sending… (try ${attempt + 1})` : 'Sending…');
    try {
      const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (res.ok) { setState(item, 'done', 'Shared ✓'); return; }
      const data = await res.json().catch(() => ({}));
      // Server errors (500, 502, 503) are worth retrying; a refusal (too big, not a photo, daily limit, album full) isn't.
      if (res.status < 500 || res.status === 507) { setState(item, 'failed', data.error || 'This photo could not be shared.'); item.final = true; return; }
    } catch { /* offline or dropped: retry */ }
    await sleep([1500, 4000, 8000, 15000][attempt] || 15000);
  }
  setState(item, 'failed', 'Could not send. Check your connection and tap "Try again".');
}

function showThumb(item, blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.alt = '';
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;
  item.li.querySelector('.thumb').append(img);
}

async function run() {
  if (running) return;
  running = true;
  awake.on();
  window.onbeforeunload = () => true; // "are you sure?" if they try to leave mid-upload
  const worker = async () => {
    for (;;) {
      const next = queue.find((q) => q.state === 'waiting');
      if (!next) return;
      next.state = 'sending';
      await send(next);
      updateBar();
    }
  };
  updateBar();
  await Promise.all([worker(), worker()]);
  running = false;
  awake.off();
  window.onbeforeunload = null;
  finish();
}

function finish() {
  const { done, failed } = updateBar();
  const retryable = queue.filter((q) => q.state === 'failed' && !q.final).length;
  if (failed === 0) {
    $('status-title').textContent = 'Thank you 💜';
    $('status-text').textContent = done === 1 ? 'Your photo was shared with the family.' : `All ${done} photos were shared with the family.`;
  } else {
    $('status-title').textContent = done ? `${done} shared, ${failed} didn't go through` : "Your photos didn't go through";
    $('status-text').textContent = retryable ? 'You can try those again below.' : 'See the notes next to each photo.';
  }
  $('retry').hidden = retryable === 0;
  $('done-actions').hidden = false;
}

$('retry').addEventListener('click', () => {
  for (const q of queue) if (q.state === 'failed' && !q.final) setState(q, 'waiting', 'Waiting…');
  $('done-actions').hidden = true;
  run();
});
$('pick').addEventListener('change', onPick);
$('snap').addEventListener('change', onPick);
