/* Tit-Telegram — shared UI + page logic (prototype) */

// ---------- helpers ----------
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// Telegram text with styled STOP tokens
function tgFormat(text) {
  return esc(text).replace(/\bSTOP\b/g, '<span class="stop">STOP</span>');
}

function renderTelegram(el, { lines, stamp = 'PAID · PROTOTYPE', no = 'NO. 001' , cursor = false }) {
  el.innerHTML = `
    <div class="tg-head"><span class="tg-co">TIT-TELEGRAM CO.</span><span class="tg-no">${esc(no)}</span></div>
    <div class="tg-body">${lines.map(l => tgFormat(l)).join('<br>')}${cursor ? '<span class="tg-cursor" aria-hidden="true"></span>' : ''}</div>
    <div class="tg-stamp">${esc(stamp)}</div>`;
}

// ---------- age gate ----------
function ageGate() {
  if (localStorage.getItem(TT.LS_AGE) === '1') return;
  const gate = document.createElement('div');
  gate.className = 'age-gate';
  gate.innerHTML = `
    <div class="age-card">
      <div class="telegram" id="ageTg"></div>
      <div class="age-actions">
        <button class="btn btn-primary" id="ageYes">I'm 18+ — deliver the goods</button>
        <a class="btn btn-ghost" href="https://www.google.com">I'm lost</a>
      </div>
    </div>`;
  document.body.appendChild(gate);
  renderTelegram($('#ageTg', gate), {
    no: 'NO. 18+',
    stamp: 'ADULTS ONLY',
    lines: ['URGENT — AGE CHECK REQUIRED STOP', 'CONTENTS OF THIS SITE ARE R-RATED STOP', 'MUST BE 18 OR OLDER TO PROCEED STOP'],
  });
  $('#ageYes', gate).addEventListener('click', () => {
    localStorage.setItem(TT.LS_AGE, '1');
    gate.remove();
  });
}

// ---------- roster card ----------
function performerCard(p, { selectable = false, selectedId = null } = {}) {
  const modes = p.modes.map(m => m === 'video'
    ? '<span class="badge pink">Video</span>'
    : '<span class="badge">In-person</span>').join('');
  const isNew = p.custom ? '<span class="badge new">New recruit</span>' : '';
  const from = [
    p.modes.includes('video') && p.videoFrom ? `video from ${TT.money(p.videoFrom)}` : null,
    p.modes.includes('inperson') && p.inpersonFrom ? `in-person from ${TT.money(p.inpersonFrom)}` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="card ${selectable ? 'selectable' : ''} ${selectedId === p.id ? 'selected' : ''}" data-pid="${p.id}" ${selectable ? 'tabindex="0" role="button" aria-pressed="' + (selectedId === p.id) + '"' : ''}>
      <div class="avatar">${TT.avatarSVG(p)}</div>
      <h3>${esc(p.stage)}</h3>
      <div class="badges">${modes}${isNew}</div>
      <p class="tagline">“${esc(p.tagline)}”</p>
      <div class="meta">
        <span>${esc(p.city)}</span>
        <span>${p.rating ? '★ ' + p.rating + ' · ' + p.gigs + ' gigs' : 'Just joined'}</span>
      </div>
      <div class="meta" style="border-top:none;padding-top:0"><span>${esc(from)}</span></div>
    </div>`;
}

// ================================================================
// PAGE: booking wizard
// ================================================================
const Wizard = {
  state: { mode: null, performerId: null, packageId: null, day: null, slot: null, recipient: '', occasion: '', message: '', sender: '', address: '', email: '' },
  steps: ['Mode & performer', 'Package', 'Schedule', 'Details', 'Review'],
  cur: 0,

  init() {
    this.el = $('#wizard');
    this.renderProgress();
    this.renderStep();
    this.updatePreview();
  },

  pkgList() { return this.state.mode === 'video' ? TT.packages.video : TT.packages.inperson; },
  pkg() { return this.pkgList().find(p => p.id === this.state.packageId); },
  performer() { return TT.getPerformer(this.state.performerId); },

  renderProgress() {
    $('#progress').innerHTML = this.steps.map((s, i) =>
      `<span class="p-step ${i === this.cur ? 'active' : i < this.cur ? 'done' : ''}">${i + 1}. ${s}</span>`).join('');
  },

  go(n) {
    this.cur = n;
    this.renderProgress();
    this.renderStep();
    this.updatePreview();
    window.scrollTo({ top: 0 });
  },

  nav(backLabel, nextLabel, nextEnabled) {
    return `<div class="wizard-nav">
      ${this.cur > 0 ? `<button class="btn btn-ghost" data-nav="back">← ${backLabel}</button>` : '<span></span>'}
      <button class="btn btn-primary" data-nav="next" ${nextEnabled ? '' : 'disabled'}>${nextLabel}</button>
    </div>`;
  },

  renderStep() {
    const s = this.state;
    let html = '';
    if (this.cur === 0) {
      const performers = TT.allPerformers().filter(p => !s.mode || p.modes.includes(s.mode));
      html = `
        <h2>Who's delivering the damage?</h2>
        <p class="panel-sub">Pick your delivery mode, then pick your weapon of mass distraction.</p>
        <div class="mode-toggle">
          <button class="mode-btn ${s.mode === 'video' ? 'selected' : ''}" data-mode="video">
            <span class="m-title">📹 Video telegram</span><span class="m-sub">Personalized video, delivered anywhere. 48-hr turnaround.</span>
          </button>
          <button class="mode-btn ${s.mode === 'inperson' ? 'selected' : ''}" data-mode="inperson">
            <span class="m-title">🚪 In-person delivery</span><span class="m-sub">A performer at their door. Tampa Bay area only (for now).</span>
          </button>
        </div>
        <div class="cards">${performers.map(p => performerCard(p, { selectable: true, selectedId: s.performerId })).join('')}</div>
        ${this.nav('', 'Choose package →', s.mode && s.performerId)}`;
    } else if (this.cur === 1) {
      html = `
        <h2>Pick the package</h2>
        <p class="panel-sub">${this.performer().stage} offers these ${s.mode === 'video' ? 'video' : 'in-person'} numbers. Prices are prototype placeholders.</p>
        <div class="cards">${this.pkgList().map(k => `
          <div class="card selectable ${s.packageId === k.id ? 'selected' : ''}" data-pkg="${k.id}" tabindex="0" role="button">
            <h3>${esc(k.name)}</h3>
            <div class="pkg-price" style="text-align:center">${TT.money(k.price)}</div>
            <div class="pkg-len" style="text-align:center">${esc(k.length)}</div>
            <p class="tagline">${esc(k.blurb)}</p>
          </div>`).join('')}</div>
        ${this.nav('Performer', 'Schedule it →', !!s.packageId)}`;
    } else if (this.cur === 2) {
      const avail = this.performer().avail || {};
      const day = s.day || TT.days.find(d => (avail[d] || []).length);
      const slots = avail[day] || [];
      html = `
        <h2>Lock the delivery window</h2>
        <p class="panel-sub">${s.mode === 'video'
          ? `${this.performer().stage} records during these windows — your video lands within 48 hours of the session.`
          : `${this.performer().stage}'s open windows for showing up at somebody's door.`}</p>
        <div class="day-tabs">${TT.days.map(d =>
          `<button class="day-tab ${d === day ? 'active' : ''}" data-day="${d}" ${(avail[d] || []).length ? '' : 'disabled'}>${TT.dayNames[d].slice(0, 3)}</button>`).join('')}</div>
        ${slots.length
          ? `<div class="slot-grid">${slots.map(t => `<button class="slot ${s.slot === t && s.day === day ? 'selected' : ''}" data-slot="${t}" data-slotday="${day}">${t}</button>`).join('')}</div>`
          : '<p class="no-slots">No windows this day — the talent rests.</p>'}
        ${this.nav('Package', 'Add the details →', !!s.slot)}`;
    } else if (this.cur === 3) {
      html = `
        <h2>Who's the lucky victim?</h2>
        <p class="panel-sub">Everything we need to make it land. The telegram on the ${window.innerWidth > 900 ? 'right' : 'top'} writes itself as you type.</p>
        <div class="field-row">
          <div class="field"><label for="fRecipient">Recipient name</label><input id="fRecipient" data-f="recipient" value="${esc(s.recipient)}" placeholder="Jessica" autocomplete="off"></div>
          <div class="field"><label for="fOccasion">Occasion</label><select id="fOccasion" data-f="occasion">
            <option value="">Select…</option>${TT.occasions.map(o => `<option ${s.occasion === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="fMessage">Your message (we'll telegram-ify it)</label>
          <textarea id="fMessage" data-f="message" placeholder="Happy 30th! You're old now.">${esc(s.message)}</textarea>
          <p class="hint">Inside jokes encouraged. The performer works this into the routine.</p></div>
        <div class="field-row">
          <div class="field"><label for="fSender">From (your name)</label><input id="fSender" data-f="sender" value="${esc(s.sender)}" placeholder="The girls 💕" autocomplete="off"></div>
          <div class="field"><label for="fEmail">Your email</label><input id="fEmail" data-f="email" type="email" value="${esc(s.email)}" placeholder="you@example.com" autocomplete="off"></div>
        </div>
        ${s.mode === 'inperson' ? `<div class="field"><label for="fAddress">Delivery address (Tampa Bay area)</label><input id="fAddress" data-f="address" value="${esc(s.address)}" placeholder="123 Bayshore Blvd, Tampa FL"><p class="hint">Private residences, offices, and party venues. We call ahead to a co-conspirator, never the target.</p></div>` : ''}
        ${this.nav('Schedule', 'Review order →', s.recipient && s.occasion && s.email && (s.mode === 'video' || s.address))}`;
    } else if (this.cur === 4) {
      const k = this.pkg(); const p = this.performer();
      html = `
        <h2>Final look before it wires</h2>
        <p class="panel-sub">Read it back like a proper telegram operator.</p>
        <div class="summary-line"><span class="sl-label">Performer</span><span class="sl-value">${esc(p.stage)}</span></div>
        <div class="summary-line"><span class="sl-label">Package</span><span class="sl-value">${esc(k.name)} (${s.mode === 'video' ? 'video' : 'in-person'})</span></div>
        <div class="summary-line"><span class="sl-label">Window</span><span class="sl-value">${TT.dayNames[s.day]} ${esc(s.slot)}</span></div>
        <div class="summary-line"><span class="sl-label">Recipient</span><span class="sl-value">${esc(s.recipient)} — ${esc(s.occasion)}</span></div>
        ${s.mode === 'inperson' ? `<div class="summary-line"><span class="sl-label">Address</span><span class="sl-value">${esc(s.address)}</span></div>` : ''}
        <div class="summary-line total"><span class="sl-label">Total</span><span class="sl-value">${TT.money(k.price)}</span></div>
        <div class="pay-stub">
          <h3>💳 Payment — coming soon</h3>
          <p>This is a working prototype: no card is charged and no performer is dispatched. When payments go live, checkout happens right here (Stripe drop-in slot reserved).</p>
        </div>
        ${this.nav('Details', 'Place order — send it STOP', true)}`;
    }
    this.el.innerHTML = html;
    this.bind();
  },

  bind() {
    $$('[data-mode]', this.el).forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (this.state.mode !== m) { this.state.mode = m; this.state.performerId = null; this.state.packageId = null; this.state.day = null; this.state.slot = null; }
      this.renderStep(); this.updatePreview();
    }));
    $$('[data-pid]', this.el).forEach(c => {
      const pick = () => { if (!this.state.mode) { toast('PICK A DELIVERY MODE FIRST STOP'); return; } this.state.performerId = c.dataset.pid; this.state.day = null; this.state.slot = null; this.renderStep(); this.updatePreview(); };
      c.addEventListener('click', pick);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    $$('[data-pkg]', this.el).forEach(c => {
      const pick = () => { this.state.packageId = c.dataset.pkg; this.renderStep(); this.updatePreview(); };
      c.addEventListener('click', pick);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    $$('[data-day]', this.el).forEach(b => b.addEventListener('click', () => { this.state.day = b.dataset.day; this.renderStep(); }));
    $$('[data-slot]', this.el).forEach(b => b.addEventListener('click', () => { this.state.slot = b.dataset.slot; this.state.day = b.dataset.slotday; this.renderStep(); this.updatePreview(); }));
    $$('[data-f]', this.el).forEach(i => i.addEventListener('input', () => {
      this.state[i.dataset.f] = i.value;
      this.updatePreview();
      const next = $('[data-nav="next"]', this.el);
      const s = this.state;
      if (this.cur === 3 && next) next.disabled = !(s.recipient && s.occasion && s.email && (s.mode === 'video' || s.address));
    }));
    const back = $('[data-nav="back"]', this.el);
    if (back) back.addEventListener('click', () => this.go(this.cur - 1));
    const next = $('[data-nav="next"]', this.el);
    if (next) next.addEventListener('click', () => {
      if (this.cur === 4) return this.submit();
      this.go(this.cur + 1);
    });
  },

  telegramLines({ cursor = true } = {}) {
    const s = this.state; const lines = [];
    lines.push(`URGENT — TIT TELEGRAM${s.recipient ? ' FOR ' + s.recipient.toUpperCase() : ''} STOP`);
    if (s.occasion) lines.push(`OCCASION: ${s.occasion.toUpperCase()} STOP`);
    if (this.state.performerId) lines.push(`TALENT DISPATCHED: ${this.performer().stage.toUpperCase()} STOP`);
    if (s.packageId && this.pkg()) lines.push(`PACKAGE: ${this.pkg().name.toUpperCase()} STOP`);
    if (s.slot) lines.push(`DELIVERY ${TT.dayNames[s.day].toUpperCase()} ${s.slot} STOP`);
    if (s.mode === 'inperson' && s.address) lines.push(`LOCATION: ${s.address.toUpperCase()} STOP`);
    if (s.message) lines.push(`MESSAGE READS: ${s.message.toUpperCase()} STOP`);
    if (s.sender) lines.push(`SENT BY ${s.sender.toUpperCase()} STOP`);
    if (lines.length === 1) lines.push('AWAITING FURTHER INSTRUCTIONS STOP');
    return lines;
  },

  updatePreview() {
    renderTelegram($('#tgPreview'), { lines: this.telegramLines(), no: 'DRAFT', stamp: 'UNSENT', cursor: true });
  },

  submit() {
    const s = this.state; const k = this.pkg(); const p = this.performer();
    const b = TT.addBooking({
      mode: s.mode, performer: p.stage, performerId: p.id, package: k.name, price: k.price,
      day: s.day, slot: s.slot, recipient: s.recipient, occasion: s.occasion,
      message: s.message, sender: s.sender, address: s.address, email: s.email,
    });
    $('#wizardWrap').classList.add('hidden');
    const c = $('#confirm');
    c.classList.remove('hidden');
    $('#confirmId').textContent = 'ORDER ' + b.id;
    renderTelegram($('#tgFinal'), { lines: this.telegramLines({ cursor: false }), no: b.id, stamp: 'WIRED ✓' });
    window.scrollTo({ top: 0 });
  },
};

// ================================================================
// PAGE: join (performer signup)
// ================================================================
const Join = {
  avail: {},
  slots: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'],

  init() {
    TT.days.forEach(d => this.avail[d] = new Set());
    $('#availGrid').innerHTML = TT.days.map(d => `
      <span class="avail-day">${TT.dayNames[d].slice(0, 3)}</span>
      <span class="avail-slots">${this.slots.map(t => `<button type="button" class="avail-slot" data-d="${d}" data-t="${t}">${t}</button>`).join('')}</span>`).join('');
    $$('.avail-slot').forEach(b => b.addEventListener('click', () => {
      const { d, t } = b.dataset;
      if (this.avail[d].has(t)) { this.avail[d].delete(t); b.classList.remove('on'); }
      else { this.avail[d].add(t); b.classList.add('on'); }
    }));
    $('#joinForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const modes = [...f.querySelectorAll('input[name="mode"]:checked')].map(i => i.value);
      if (!modes.length) return toast('PICK AT LEAST ONE DELIVERY MODE STOP');
      if (!TT.days.some(d => this.avail[d].size)) return toast('MARK SOME AVAILABILITY STOP');
      const hues = ['#FF2E88','#E8A83E','#B24BF3','#4BC3F3','#F35F8C','#7BE04B'];
      const p = TT.addPerformer({
        stage: f.stage.value.trim(), modes,
        city: modes.includes('inperson') ? (f.city.value.trim() || 'Tampa, FL') : 'Video only — nationwide',
        tagline: f.tagline.value.trim() || 'New to the troupe. Zero gigs, infinite audacity.',
        bio: f.bio.value.trim(),
        motif: 'star', hue: hues[Math.floor(Math.random() * hues.length)],
        videoFrom: modes.includes('video') ? Number(f.videorate.value) || 49 : null,
        inpersonFrom: modes.includes('inperson') ? Number(f.personrate.value) || 199 : null,
        avail: Object.fromEntries(TT.days.map(d => [d, [...this.avail[d]].sort()])),
        email: f.email.value.trim(),
      });
      $('#joinFormWrap').classList.add('hidden');
      const c = $('#joinConfirm');
      c.classList.remove('hidden');
      renderTelegram($('#tgJoin'), {
        no: 'RECRUIT', stamp: 'ENLISTED ✓',
        lines: [`WELCOME TO THE TROUPE ${p.stage.toUpperCase()} STOP`, 'PROFILE IS LIVE ON THE ROSTER STOP', 'FIRST BOOKING INCOMING ANY MINUTE STOP', 'PREPARE THE FEATHERS STOP'],
      });
      window.scrollTo({ top: 0 });
    });
  },
};

// ================================================================
// PAGE: admin
// ================================================================
const Admin = {
  init() {
    const bookings = TT.getBookings();
    $('#bookCount').textContent = bookings.length;
    $('#bookingsBody').innerHTML = bookings.length
      ? bookings.map(b => `<tr>
          <td>${esc(b.id)}</td><td>${esc(b.recipient)}</td><td>${esc(b.performer)}</td>
          <td>${esc(b.package)} (${b.mode})</td><td>${TT.dayNames[b.day]} ${esc(b.slot)}</td>
          <td>${TT.money(b.price)}</td><td>${esc(b.email)}</td><td>${esc(b.status)}</td></tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;color:var(--muted)">No bookings yet — go place one.</td></tr>';
    const recruits = TT.getCustomPerformers();
    $('#recruitCount').textContent = recruits.length;
    $('#recruitsBody').innerHTML = recruits.length
      ? recruits.map(p => `<tr>
          <td>${esc(p.stage)}</td><td>${p.modes.join(', ')}</td><td>${esc(p.city)}</td>
          <td>${TT.money(p.videoFrom)} / ${TT.money(p.inpersonFrom)}</td><td>${esc(p.email || '—')}</td></tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No signups yet.</td></tr>';
    $('#resetBtn').addEventListener('click', () => {
      if (confirm('Wipe all prototype bookings and performer signups from this browser?')) {
        localStorage.removeItem(TT.LS_BOOKINGS);
        localStorage.removeItem(TT.LS_PERFORMERS);
        location.reload();
      }
    });
  },
};

// ================================================================
// PAGE: landing
// ================================================================
const Landing = {
  init() {
    const el = $('#heroTg');
    const lines = ['URGENT — TIT TELEGRAM FOR JESSICA STOP', 'OCCASION: DIRTY THIRTY STOP', 'TALENT DISPATCHED: RUBY RIOT STOP', 'DELIVERY FRIDAY 8PM SHARP STOP', 'DRESS CODE: NONE STOP', 'SENT BY THE GIRLS STOP'];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { renderTelegram(el, { lines, no: 'NO. 001', stamp: 'WIRED ✓' }); }
    else {
      let i = 0;
      const type = () => {
        renderTelegram(el, { lines: lines.slice(0, i + 1), no: 'NO. 001', stamp: i >= lines.length - 1 ? 'WIRED ✓' : 'SENDING…', cursor: i < lines.length - 1 });
        i++;
        if (i < lines.length) setTimeout(type, 750);
      };
      const io = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { io.disconnect(); type(); }
      }, { threshold: .3 });
      io.observe(el);
    }
    const roster = $('#rosterTeaser');
    if (roster) roster.innerHTML = TT.allPerformers().slice(0, 3).map(p => performerCard(p)).join('');
  },
};

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', () => {
  ageGate();
  const page = document.body.dataset.page;
  if (page === 'landing') Landing.init();
  if (page === 'book') Wizard.init();
  if (page === 'join') Join.init();
  if (page === 'admin') Admin.init();
});
