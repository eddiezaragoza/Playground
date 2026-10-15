// Gym Buddy client. Plain JS, no build step. All Notion text goes through textContent.
(() => {
  'use strict';
  const API = '/gym/api';
  const $ = (id) => document.getElementById(id);
  const app = $('app');

  // h('div', {class: 'x', onclick: fn}, child, 'text')
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  // ---------- local autosave ----------
  const storeKey = (id) => `gymbuddy:v1:${id}`;
  const load = (id) => { try { return JSON.parse(localStorage.getItem(storeKey(id))); } catch { return null; } };
  const persist = () => { try { localStorage.setItem(storeKey(state.id), JSON.stringify(state)); } catch { /* private mode */ } };
  const forget = (id) => { try { localStorage.removeItem(storeKey(id)); } catch { /* ignore */ } };

  let session = null;
  let state = null;

  function freshState(s) {
    return {
      id: s.id,
      startedAt: null,
      pausedAt: null, // set while paused
      pausedMs: 0, // total paused time, excluded from the clock and Duration
      durationTouched: false,
      fields: { energy: s.fields.energy, rpe: s.fields.rpe, duration: s.fields.duration, stretching: s.fields.stretching, pain: s.fields.pain || '' },
      results: s.plan ? s.plan.blocks.map((b) => b.exercises.map((e) =>
        Array.from({ length: e.sets }, () => ({ reps: e.reps, weight: e.weight, done: false })))) : [],
      extras: s.plan ? s.plan.blocks.map((b) => b.exercises.map(() => ({ rpe: null, note: '' }))) : [],
    };
  }

  // Keep saved progress, but follow the plan's shape if it changed since.
  function mergeState(saved, s) {
    const fresh = freshState(s);
    if (!saved || saved.id !== s.id) return fresh;
    fresh.startedAt = saved.startedAt || null;
    fresh.pausedAt = saved.pausedAt || null;
    fresh.pausedMs = Number(saved.pausedMs) || 0;
    fresh.durationTouched = !!saved.durationTouched;
    Object.assign(fresh.fields, saved.fields || {});
    fresh.results = fresh.results.map((blk, bi) => blk.map((sets, ei) => sets.map((set, si) => {
      const old = saved.results?.[bi]?.[ei]?.[si];
      return old ? { reps: String(old.reps ?? ''), weight: String(old.weight ?? ''), done: !!old.done } : set;
    })));
    fresh.extras = fresh.extras.map((blk, bi) => blk.map((x, ei) => {
      const old = saved.extras?.[bi]?.[ei];
      return old ? { rpe: old.rpe ?? null, note: String(old.note ?? '') } : x;
    }));
    return fresh;
  }

  // Any workout action starts the clock, or resumes it if paused.
  const startClock = () => {
    if (!state.startedAt) { state.startedAt = Date.now(); persist(); } else if (state.pausedAt) resumeWorkout();
  };

  // ---------- workout clock ----------
  const elapsedSec = () => Math.max(0, Math.floor(((state.pausedAt || Date.now()) - state.startedAt - state.pausedMs) / 1000));

  function pauseWorkout() {
    if (!state?.startedAt || state.pausedAt) return;
    state.pausedAt = Date.now();
    stopRest();
    persist();
    if (wakeLock) wakeLock.release().catch(() => {});
    tickClock();
  }
  function resumeWorkout() {
    if (!state?.pausedAt) return;
    state.pausedMs += Date.now() - state.pausedAt;
    state.pausedAt = null;
    persist();
    keepAwake();
    tickClock();
  }

  function tickClock() {
    const box = $('clockbox');
    if (!state || !state.startedAt || session?.readOnly) { box.hidden = true; document.body.classList.remove('is-paused'); return; }
    const sec = elapsedSec();
    const paused = !!state.pausedAt;
    box.hidden = false;
    document.body.classList.toggle('is-paused', paused);
    $('clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const btn = $('pause');
    btn.textContent = paused ? 'Resume' : 'Pause';
    btn.setAttribute('aria-pressed', String(paused));
    if (!state.durationTouched) {
      const mins = Math.max(1, Math.round(sec / 60));
      if (state.fields.duration !== mins) {
        state.fields.duration = mins;
        const inp = $('duration');
        if (inp && document.activeElement !== inp) inp.value = mins;
        persist();
      }
    }
  }
  setInterval(tickClock, 1000);

  // ---------- rest timer ----------
  let timer = null; // {endAt, label, handle}
  let audio = null;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach((t) => {
        const o = audio.createOscillator(); const g = audio.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.25, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.25);
        o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.26);
      });
    } catch { /* no audio */ }
  }
  function startRest(seconds, label) {
    if (!seconds) return;
    if (state?.pausedAt) resumeWorkout();
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch { /* unlock audio on a tap */ }
    stopRest();
    timer = { endAt: Date.now() + seconds * 1000, label, handle: setInterval(renderRest, 250) };
    $('timer').hidden = false;
    $('timer').classList.remove('finished');
    renderRest();
  }
  function renderRest() {
    if (!timer) return;
    const left = Math.ceil((timer.endAt - Date.now()) / 1000);
    $('timer-label').textContent = `Rest · ${timer.label}`;
    if (left <= 0) {
      $('timer-time').textContent = 'Go!';
      if (!$('timer').classList.contains('finished')) {
        $('timer').classList.add('finished');
        if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
        beep();
      }
      return;
    }
    $('timer-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  function stopRest() {
    if (timer) clearInterval(timer.handle);
    timer = null;
    $('timer').hidden = true;
  }
  $('timer-stop').addEventListener('click', stopRest);
  $('timer-add').addEventListener('click', () => {
    if (!timer) return;
    timer.endAt = Math.max(timer.endAt, Date.now()) + 15000;
    $('timer').classList.remove('finished');
    renderRest();
  });

  // Keep the screen awake while logging.
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session && !session.readOnly && !state?.pausedAt) keepAwake(); });
  $('pause').addEventListener('click', () => (state?.pausedAt ? resumeWorkout() : pauseWorkout()));

  // ---------- rendering ----------
  const targetText = (e) => `${e.sets} × ${e.reps || '?'}${e.weight ? ` @ ${e.weight}` : ''}`;

  function header(s) {
    $('title').textContent = s.title || 'Gym Buddy';
    $('meta').textContent = [s.type, s.date, s.kidsWeek ? 'Kids week' : null, s.readOnly ? 'Done' : 'Planned'].filter(Boolean).join(' · ');
    document.title = s.title ? `Gym Buddy · ${s.title}` : 'Gym Buddy';
  }

  function chips(name, max, step = 1, from = 1) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': name });
    for (let v = from; v <= max; v += step) {
      const btn = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.fields[name] === v) }, String(v));
      btn.addEventListener('click', () => {
        state.fields[name] = state.fields[name] === v ? null : v;
        for (const c of wrap.children) c.setAttribute('aria-pressed', String(Number(c.textContent) === state.fields[name]));
        if (name === 'energy') startClock();
        persist();
      });
      wrap.append(btn);
    }
    return wrap;
  }

  function setRow(block, bi, e, ei, si) {
    const set = state.results[bi][ei][si];
    const reps = h('input', { type: 'text', inputmode: 'numeric', value: set.reps, 'aria-label': `${e.name} set ${si + 1} reps`, placeholder: 'reps' });
    const weight = h('input', { type: 'text', value: set.weight, 'aria-label': `${e.name} set ${si + 1} weight`, placeholder: 'wt', autocapitalize: 'off' });
    const check = h('button', { type: 'button', class: 'check', 'aria-pressed': String(set.done), 'aria-label': `${e.name} set ${si + 1} done` }, '✓');
    const row = h('div', { class: `set${set.done ? ' done' : ''}` }, h('span', { class: 'set-label' }, `Set ${si + 1}`), reps, weight, check);
    reps.addEventListener('input', () => { set.reps = reps.value.trim(); persist(); });
    weight.addEventListener('input', () => { set.weight = weight.value.trim(); persist(); });
    check.addEventListener('click', () => {
      set.done = !set.done;
      check.setAttribute('aria-pressed', String(set.done));
      row.classList.toggle('done', set.done);
      startClock();
      persist();
      if (set.done && block.rest_sec) startRest(block.rest_sec, block.name);
      keepAwake();
    });
    return row;
  }

  // Optional RPE (5-10, tap again to clear) and a note for one exercise.
  function exerciseExtras(e, bi, ei) {
    const x = state.extras[bi][ei];
    const chipsWrap = h('div', { class: 'chips small', role: 'group', 'aria-label': `${e.name} RPE` });
    for (let v = 5; v <= 10; v++) {
      const btn = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(x.rpe === v) }, String(v));
      btn.addEventListener('click', () => {
        x.rpe = x.rpe === v ? null : v;
        for (const c of chipsWrap.children) c.setAttribute('aria-pressed', String(Number(c.textContent) === x.rpe));
        persist();
      });
      chipsWrap.append(btn);
    }
    const note = h('input', { type: 'text', class: 'ex-note-input', maxlength: '300', placeholder: 'Note (e.g. knee felt off on set 2)', 'aria-label': `${e.name} note`, hidden: !x.note });
    note.value = x.note;
    note.addEventListener('input', () => { x.note = note.value; persist(); });
    const noteBtn = h('button', { type: 'button', class: 'small note-btn', 'aria-label': `${e.name} add note`, hidden: !!x.note }, '+ Note');
    noteBtn.addEventListener('click', () => { note.hidden = false; noteBtn.hidden = true; note.focus(); });
    return h('div', { class: 'ex-extras' },
      h('div', { class: 'ex-extras-row' }, h('span', { class: 'set-label' }, 'RPE'), chipsWrap, noteBtn),
      note);
  }

  // ---------- how-to card ----------
  let howToTimer = null;
  function closeHowTo() {
    clearInterval(howToTimer);
    howToTimer = null;
    document.getElementById('howto')?.remove();
    document.body.classList.remove('sheet-open');
  }
  function openHowTo(info) {
    closeHowTo();
    const photos = info.photos.map((src, i) => h('img', { src, alt: `${info.name} ${i ? 'end' : 'start'} position`, class: i ? '' : 'show' }));
    const frame = photos.length ? h('div', { class: 'howto-photos' }, photos, h('span', { class: 'howto-step' }, 'Start')) : null;
    if (frame) {
      // Flip start/end like a GIF; hide the frame if the photos can't load.
      let i = 0;
      howToTimer = setInterval(() => {
        i = (i + 1) % photos.length;
        photos.forEach((p, n) => p.classList.toggle('show', n === i));
        frame.lastChild.textContent = i ? 'End' : 'Start';
      }, 1100);
      photos[0].addEventListener('error', () => { frame.hidden = true; });
    }
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `How to: ${info.name}` },
      h('div', { class: 'sheet-head' }, h('h2', {}, info.name), h('button', { type: 'button', class: 'small', onclick: closeHowTo }, 'Close')),
      frame,
      info.match === 'Close' && info.note ? h('div', { class: 'banner' }, `Close match: ${info.note}`) : null,
      info.match === 'Missing' ? h('div', { class: 'banner' }, 'Not in your exercise library yet.') : null,
      info.match === 'None' && info.note ? h('div', { class: 'banner' }, info.note) : null,
      info.cue ? h('div', { class: 'cue' }, info.cue) : null,
      info.steps.length ? h('ol', { class: 'howto-steps' }, info.steps.map((t) => h('li', {}, t))) : null,
      h('a', { class: 'howto-video', href: info.video, target: '_blank', rel: 'noopener noreferrer' }, 'Watch a demo on YouTube ↗'));
    const overlay = h('div', { id: 'howto', class: 'overlay' }, sheet);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeHowTo(); });
    document.body.append(overlay);
    document.body.classList.add('sheet-open');
    sheet.querySelector('button').focus();
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeHowTo(); });

  function howToButton(name) {
    const info = session?.howTo?.[name];
    if (!info) return null;
    const label = `How to do ${name}`;
    const btn = info.photos.length
      ? h('button', { type: 'button', class: 'howto-thumb', 'aria-label': label }, h('img', { src: info.photos[0], alt: '' }))
      : h('button', { type: 'button', class: 'small howto-btn', 'aria-label': label }, 'How to');
    btn.addEventListener('click', () => openHowTo(info));
    const img = btn.querySelector('img');
    if (img) img.addEventListener('error', () => btn.replaceChildren('How to'));
    return btn;
  }

  function renderPlanned(s) {
    const kids = [];
    if (s.coachNote) kids.push(h('div', { class: 'card note' }, h('div', { class: 'muted' }, 'Coach note'), s.coachNote));
    if (s.planError) kids.push(h('div', { class: 'banner' }, `${s.planError} You can still log the session fields and save.`));

    kids.push(h('section', { class: 'card' }, h('h2', {}, 'Energy (1–5)'), h('div', { class: 'field' }, chips('energy', 5))));

    (s.plan?.blocks || []).forEach((b, bi) => {
      const restBtn = b.rest_sec ? h('button', { type: 'button', class: 'small', onclick: () => startRest(b.rest_sec, b.name) }, `Rest ${b.rest_sec}s`) : null;
      kids.push(h('section', { class: 'card' },
        h('div', { class: 'block-head' }, h('h2', {}, b.name), restBtn),
        b.exercises.map((e, ei) => h('div', { class: 'ex' },
          h('div', { class: 'ex-head' },
            h('div', { class: 'ex-name' }, e.name, e.anchor ? h('span', { class: 'badge' }, 'Anchor') : null),
            howToButton(e.name)),
          h('div', { class: 'target' }, `Target ${targetText(e)}`),
          e.cue ? h('div', { class: 'cue' }, e.cue) : null,
          Array.from({ length: e.sets }, (_, si) => setRow(b, bi, e, ei, si)),
          exerciseExtras(e, bi, ei),
        )),
      ));
    });

    const duration = h('input', { id: 'duration', type: 'number', inputmode: 'numeric', min: '0', max: '600', value: state.fields.duration ?? '' });
    duration.addEventListener('input', () => {
      state.durationTouched = duration.value !== '';
      state.fields.duration = duration.value === '' ? null : Number(duration.value);
      persist();
    });
    const stretch = h('input', { type: 'checkbox', id: 'stretch', checked: state.fields.stretching });
    stretch.addEventListener('change', () => { state.fields.stretching = stretch.checked; persist(); });
    const pain = h('textarea', { id: 'pain', placeholder: 'Anything that hurt or felt off' });
    pain.value = state.fields.pain || '';
    pain.addEventListener('input', () => { state.fields.pain = pain.value; persist(); });
    const status = h('div', { id: 'save-status', role: 'status' });
    const save = h('button', { type: 'button', class: 'primary', onclick: () => doSave(save, status) }, 'Save to Notion');

    kids.push(h('section', { class: 'card' },
      h('h2', {}, 'Wrap up'),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'RPE (1–10)'), chips('rpe', 10)),
      h('div', { class: 'field' }, h('label', { for: 'duration' }, 'Duration (min)'), duration),
      h('div', { class: 'field' }, h('label', { class: 'toggle', for: 'stretch' }, stretch, 'Stretching done')),
      h('div', { class: 'field' }, h('label', { for: 'pain' }, 'Pain / flags'), pain),
      h('div', { class: 'field' }, save, status),
    ));
    kids.push(footer(s));
    app.replaceChildren(...kids);
  }

  function renderReadOnly(s, banner) {
    const f = s.fields;
    const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v == null || v === '' ? '—' : String(v))];
    app.replaceChildren(
      banner,
      h('section', { class: 'card' }, h('h2', {}, 'Workout'), h('div', { class: 'readonly-text' }, s.workout || '—')),
      h('section', { class: 'card' }, h('h2', {}, 'Anchor lifts'), h('div', { class: 'readonly-text' }, s.anchorLifts || '—')),
      h('section', { class: 'card' }, h('dl', { class: 'kv' },
        kv('Energy', f.energy), kv('RPE', f.rpe), kv('Duration', f.duration != null ? `${f.duration} min` : null),
        kv('Stretching', f.stretching ? 'Yes' : 'No'), kv('Pain/flags', f.pain))),
      s.coachNote ? h('div', { class: 'card note' }, h('div', { class: 'muted' }, 'Coach note'), s.coachNote) : null,
      footer(s),
    );
  }

  function footer(s) {
    return h('div', { class: 'footer-links' },
      s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'Open in Notion') : h('span'),
      h('a', { href: '/gym/logout' }, 'Log out'));
  }

  // ---------- save ----------
  async function doSave(btn, status) {
    btn.disabled = true;
    status.className = '';
    status.textContent = 'Saving…';
    try {
      const res = await fetch(`${API}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: state.id, fields: state.fields, results: state.results, extras: state.extras }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('You were logged out. Your progress is kept on this phone; reload and log in, then save again.');
      if (res.status === 409 && data.code === 'already_done') {
        forget(state.id);
        stopRest();
        session.readOnly = true;
        header(session);
        renderReadOnly(session, h('div', { class: 'banner' }, 'This session was already saved as Done.'));
        return;
      }
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      forget(state.id);
      stopRest();
      session = data.session;
      header(session);
      tickClock();
      renderReadOnly(session, h('div', { class: 'banner ok' }, 'Saved to Notion. Nice work.'));
      window.scrollTo(0, 0);
    } catch (e) {
      status.className = 'banner bad';
      status.textContent = `${e.message} Nothing was lost; try again.`;
      btn.disabled = false;
    }
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const res = await fetch(`${API}/session`, { credentials: 'same-origin' });
      if (res.status === 401) { location.reload(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      session = data.session;
      if (!session) {
        $('title').textContent = 'Gym Buddy';
        app.replaceChildren(h('div', { class: 'banner' }, 'No Planned or Done sessions found in Gym Buddy Log.'));
        return;
      }
      header(session);
      if (session.readOnly) {
        renderReadOnly(session, h('div', { class: 'banner' }, 'No planned session right now. Showing your last completed one.'));
        return;
      }
      state = mergeState(load(session.id), session);
      persist();
      renderPlanned(session);
      tickClock();
      keepAwake();
    } catch (e) {
      $('title').textContent = 'Gym Buddy';
      app.replaceChildren(h('div', { class: 'banner bad' }, `Couldn't load your session: ${e.message}`),
        h('button', { type: 'button', class: 'primary', onclick: () => location.reload() }, 'Retry'));
    }
  }
  boot();
})();
