// Helpers shared by the guest, admin and slideshow pages.
export const BASE = document.body.dataset.base;

export async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { credentials: 'same-origin', ...opts });
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = new Error(data.error || `Something went wrong (${res.status}).`);
    e.status = res.status;
    throw e;
  }
  return data;
}
export const postJson = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// Shows the cover photo, or the first letter of the name in a circle until the family adds one.
export function renderCover(el) {
  const src = el.dataset.cover;
  el.textContent = '';
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = src;
    img.onerror = () => { el.textContent = el.dataset.initial; el.classList.add('initial'); };
    el.append(img);
    el.classList.remove('initial');
  } else {
    el.textContent = el.dataset.initial;
    el.classList.add('initial');
  }
}

const canvasBlob = (canvas, quality) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', quality));

// Redraws a photo smaller as a JPEG. That makes uploads fast on venue Wi-Fi, turns iPhone HEIC photos into
// something every screen can show, straightens sideways photos, and drops hidden details like GPS location.
// Returns null when this browser can't read the file (for example HEIC on some Android/Windows browsers).
export async function shrink(file, maxSide, quality = 0.85, thumbSide = 0) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    try { bmp = await createImageBitmap(file); } catch { return null; }
  }
  try {
    const draw = async (side, q) => {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; // transparent screenshots get a white background instead of black
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await canvasBlob(c, q);
      c.width = c.height = 0; // let iPhones free the memory right away
      return blob;
    };
    const photo = await draw(maxSide, quality);
    const thumb = thumbSide ? await draw(thumbSide, 0.72) : null;
    return photo ? { photo, thumb } : null;
  } finally {
    bmp.close?.();
  }
}

// Keeps the screen on (phones stop uploads when they lock; the slideshow must never sleep).
export function keepAwake() {
  let lock = null;
  let want = false;
  const grab = async () => {
    if (!want || lock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch { /* not allowed */ }
  };
  document.addEventListener('visibilitychange', grab);
  return {
    on() { want = true; grab(); },
    off() { want = false; lock?.release().catch(() => {}); lock = null; },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The printable card page has no script of its own: fill its cover circles here.
if (document.body.classList.contains('cards')) for (const el of document.querySelectorAll('.cover')) renderCover(el);
