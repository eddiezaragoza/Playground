// Slideshow: crossfades through every shared photo in shuffled order, shows new photos first as they arrive,
// and drops photos the family hides. ?s=8 sets the seconds per photo (default 7).
import { api, renderCover, keepAwake } from './shared.js';

const $ = (id) => document.getElementById(id);
const BASE = document.body.dataset.base;
const params = new URLSearchParams(location.search);
const SECONDS = Math.min(60, Math.max(3, Number(params.get('s')) || 7));
const POLL_MS = 20000;
const TITLE_EVERY = 25; // show the "In loving memory" card again after this many photos
const key = location.hash.slice(1);

renderCover(document.querySelector('#title-card .cover'));

const photos = new Map(); // id -> { id, name, note, ts }
let fresh = []; // ids that arrived while the show was running: shown next, oldest first
let deck = []; // shuffled ids still to show this round
let history = []; // ids already shown (for the back key)
let histPos = -1;
let sinceTitle = 0;
let front = 0; // which of the two slide layers is showing
let timer = null;
let paused = false;
let started = false;
let showCaptions = params.get('captions') !== '0';
let showQr = params.get('qr') !== '0';
let lastId = null;
const awake = keepAwake();

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function load(first) {
  let data;
  try {
    data = await api('/api/show', { headers: { 'X-Show-Key': key } });
  } catch (e) {
    if (e.status === 403 || e.status === 401) {
      $('start-msg').textContent = e.message;
      $('go').hidden = true;
      return false;
    }
    return true; // network hiccup: keep showing what we have and try again later
  }
  const seen = new Set();
  for (const p of data.photos) {
    seen.add(p.id);
    if (!photos.has(p.id)) {
      photos.set(p.id, p);
      if (!first) fresh.push(p.id);
    } else photos.set(p.id, p);
  }
  for (const id of [...photos.keys()]) if (!seen.has(id)) photos.delete(id); // hidden or deleted by the family
  fresh = fresh.filter((id) => photos.has(id));
  deck = deck.filter((id) => photos.has(id));
  const n = photos.size;
  $('count').textContent = n === 0 ? 'Photos people share will appear here.' : `${n} photo${n === 1 ? '' : 's'} shared with love`;
  if (first) $('start-msg').textContent = n ? `${n} photo${n === 1 ? '' : 's'} so far. New photos appear automatically as people share them.` : 'No photos yet. They will appear automatically as people share them.';
  return true;
}

function nextId() {
  if (fresh.length) return fresh.shift();
  if (!deck.length) {
    deck = shuffle([...photos.keys()]);
    if (deck.length > 1 && deck[deck.length - 1] === lastId) deck.unshift(deck.pop()); // no repeat across rounds
  }
  return deck.pop() || null;
}

function preload(id) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img.src));
    img.onerror = () => resolve(null);
    img.src = `${BASE}/p/${id}`;
  });
}

function showTitle() {
  for (const s of document.querySelectorAll('.slide')) s.classList.remove('on');
  $('title-card').classList.add('on');
  $('caption').hidden = true;
  sinceTitle = 0;
}

async function showPhoto(id) {
  const src = await preload(id);
  if (!src) { photos.delete(id); return false; }
  const p = photos.get(id);
  front = 1 - front;
  const layer = $(`s${front}`);
  const other = $(`s${1 - front}`);
  layer.querySelector('.bg').style.backgroundImage = `url("${src}")`;
  const fg = layer.querySelector('.fg');
  fg.src = src;
  fg.style.animation = 'none';
  void fg.offsetWidth; // restart the slow zoom
  fg.style.animation = `kenburns ${SECONDS + 2}s ease-out forwards`;
  fg.style.transformOrigin = `${30 + Math.random() * 40}% ${30 + Math.random() * 40}%`;
  layer.classList.add('on');
  other.classList.remove('on');
  $('title-card').classList.remove('on');
  setCaption(p);
  lastId = id;
  sinceTitle++;
  return true;
}

function setCaption(p) {
  const cap = $('caption');
  const who = p && p.name ? `Shared by ${p.name}` : '';
  const note = p && p.note ? p.note : '';
  cap.querySelector('.who').textContent = who;
  cap.querySelector('.note').textContent = note.length > 220 ? `${note.slice(0, 217)}…` : note;
  cap.hidden = !showCaptions || (!who && !note);
}

async function advance(step = 1) {
  clearTimeout(timer);
  if (step < 0) {
    if (histPos > 0) { histPos--; await showPhoto(history[histPos]); }
  } else if (histPos < history.length - 1) {
    histPos++;
    await showPhoto(history[histPos]);
  } else if (!photos.size || (sinceTitle >= TITLE_EVERY && !fresh.length)) {
    showTitle();
  } else {
    let id = nextId();
    let tries = 0;
    while (id && !(await showPhoto(id)) && tries++ < 5) id = nextId();
    if (id) { history.push(id); if (history.length > 300) history.shift(); histPos = history.length - 1; }
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (!paused) timer = setTimeout(() => advance(1), photos.size ? SECONDS * 1000 : 5000);
}

function setPaused(v) {
  paused = v;
  $('paused').hidden = !v;
  if (v) clearTimeout(timer); else schedule();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function applyToggles() {
  $('qr').hidden = !showQr;
  const id = history[histPos];
  if (id && photos.has(id) && !$('title-card').classList.contains('on')) setCaption(photos.get(id));
}

async function start() {
  if (started) return;
  started = true;
  $('start').hidden = true;
  document.documentElement.requestFullscreen?.().catch(() => {});
  awake.on();
  showTitle();
  timer = setTimeout(() => advance(1), 4000);
  setInterval(() => load(false), POLL_MS);
}

document.addEventListener('keydown', (e) => {
  if (!started) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } return; }
  if (e.key === ' ' || e.key === 'k') { e.preventDefault(); setPaused(!paused); }
  else if (e.key === 'ArrowRight') advance(1);
  else if (e.key === 'ArrowLeft') advance(-1);
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'c' || e.key === 'C') { showCaptions = !showCaptions; applyToggles(); }
  else if (e.key === 'q' || e.key === 'Q') { showQr = !showQr; applyToggles(); }
});

// Hide the mouse pointer when it isn't moving.
let idle;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), 2500);
});
document.addEventListener('dblclick', () => started && toggleFullscreen());

$('go').addEventListener('click', start);
applyToggles();
load(true);
