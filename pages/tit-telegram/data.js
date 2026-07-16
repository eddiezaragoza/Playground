/* Tit-Telegram — seed data + storage layer (prototype: localStorage, no backend) */

const TT = {
  LS_BOOKINGS: 'tt_bookings',
  LS_PERFORMERS: 'tt_performers',
  LS_AGE: 'tt_age_ok',

  // ---- Packages (pricing per 2026-07 competitive research: video $40-150, in-person $175-350 envelopes) ----
  packages: {
    video: [
      { id: 'v1', name: 'The Quickie', price: 45, blurb: '60-second personalized video telegram. Name-drops, one song verse, maximum sass.', length: '~1 min' },
      { id: 'v2', name: 'The Full Show', price: 95, blurb: '3-minute production: costume of your choice, custom song parody, personal roast segment.', length: '~3 min' },
      { id: 'v3', name: 'The Double Feature', price: 150, blurb: 'Two performers, one video, zero chill. Duet delivery with choreography.', length: '~3 min' },
    ],
    inperson: [
      { id: 'p1', name: 'The Classic', price: 175, blurb: '15-minute telegram delivery: entrance, song, dance number, telegram read-aloud, photos.', length: '15 min' },
      { id: 'p2', name: 'The Deluxe', price: 325, blurb: '30 minutes: full routine, costume reveal, games with the guest of honor, polaroid keepsakes.', length: '30 min' },
      { id: 'p3', name: 'The Office Special', price: 245, blurb: 'Workplace-calibrated chaos. HR-survivable but barely. Includes balloon delivery cover story.', length: '20 min' },
    ],
  },

  // ---- Seed performers (fictional — illustrated avatars, no photos) ----
  seedPerformers: [
    { id: 's1', stage: 'Ruby Riot', modes: ['video', 'inperson'], city: 'Tampa, FL', tagline: 'Burlesque headliner. Will absolutely sing at your boss.', bio: '8 years on the Tampa burlesque circuit. Specialty: birthday roasts set to show tunes.', motif: 'lips', hue: '#FF2E88', videoFrom: 45, inpersonFrom: 175, rating: 4.9, gigs: 214, avail: { mon: [], tue: ['19:00','20:00','21:00'], wed: ['19:00','20:00'], thu: ['18:00','19:00','20:00','21:00'], fri: ['17:00','18:00','19:00','20:00','21:00','22:00'], sat: ['12:00','13:00','17:00','18:00','19:00','20:00','21:00','22:00'], sun: ['14:00','15:00'] } },
    { id: 's2', stage: 'Dixie Voltage', modes: ['video', 'inperson'], city: 'St. Petersburg, FL', tagline: 'Country twang, zero shame.', bio: 'Former line-dance instructor turned telegram outlaw. Brings her own boots and a wireless speaker.', motif: 'boot', hue: '#E8A83E', videoFrom: 45, inpersonFrom: 175, rating: 4.8, gigs: 167, avail: { mon: ['19:00','20:00'], tue: [], wed: ['19:00','20:00','21:00'], thu: ['19:00','20:00'], fri: ['18:00','19:00','20:00','21:00'], sat: ['13:00','14:00','18:00','19:00','20:00','21:00'], sun: [] } },
    { id: 's3', stage: 'Miss Direction', modes: ['video'], city: 'Video only — nationwide', tagline: 'Drag royalty. Your recipient will never recover.', bio: 'Pageant-winning drag performer. Custom song parodies written per order, wigs escalate with package tier.', motif: 'crown', hue: '#B24BF3', videoFrom: 59, inpersonFrom: null, rating: 5.0, gigs: 342, avail: { mon: ['10:00','11:00','12:00','19:00'], tue: ['10:00','11:00','12:00','19:00'], wed: ['10:00','11:00','12:00'], thu: ['10:00','11:00','19:00','20:00'], fri: ['10:00','11:00','12:00'], sat: [], sun: ['15:00','16:00','17:00'] } },
    { id: 's4', stage: 'Johnny Tuxedo', modes: ['video', 'inperson'], city: 'Tampa, FL', tagline: 'The tux comes off. The bowtie stays.', bio: 'Ex-cruise-ship entertainer. Sinatra voice, magic-mike energy, grandma-approved charm until the second verse.', motif: 'bowtie', hue: '#4BC3F3', videoFrom: 45, inpersonFrom: 195, rating: 4.9, gigs: 198, avail: { mon: [], tue: ['18:00','19:00','20:00'], wed: ['18:00','19:00','20:00'], thu: ['18:00','19:00'], fri: ['17:00','18:00','19:00','20:00','21:00'], sat: ['12:00','13:00','14:00','18:00','19:00','20:00','21:00'], sun: ['13:00','14:00'] } },
    { id: 's5', stage: 'Peaches LaFlame', modes: ['inperson'], city: 'Clearwater, FL', tagline: 'Feathers. So many feathers.', bio: 'Classic fan-dance burlesque with a comedy streak. The feather boa is non-negotiable and neither is the confetti.', motif: 'feather', hue: '#F35F8C', videoFrom: null, inpersonFrom: 205, rating: 4.7, gigs: 121, avail: { mon: [], tue: [], wed: ['19:00','20:00'], thu: ['19:00','20:00','21:00'], fri: ['18:00','19:00','20:00','21:00','22:00'], sat: ['17:00','18:00','19:00','20:00','21:00','22:00'], sun: [] } },
    { id: 's6', stage: 'Big Tex Serenade', modes: ['video'], city: 'Video only — nationwide', tagline: 'A 6\'5" cowboy singing your friend happy birthday. You\'re welcome.', bio: 'Baritone. Owns fourteen novelty cowboy hats. Will work your inside jokes into an original country ballad.', motif: 'hat', hue: '#C98A3D', videoFrom: 45, inpersonFrom: null, rating: 4.8, gigs: 256, avail: { mon: ['09:00','10:00','11:00'], tue: ['09:00','10:00','11:00'], wed: ['09:00','10:00','11:00'], thu: ['09:00','10:00'], fri: ['09:00','10:00','11:00','12:00'], sat: ['10:00','11:00'], sun: [] } },
  ],

  days: ['mon','tue','wed','thu','fri','sat','sun'],
  dayNames: { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' },
  occasions: ['Birthday','Bachelorette party','Bachelor party','Divorce party','Retirement','Office celebration','Anniversary','Just because / revenge'],

  // ---- Storage ----
  getCustomPerformers() {
    try { return JSON.parse(localStorage.getItem(this.LS_PERFORMERS)) || []; } catch { return []; }
  },
  addPerformer(p) {
    const list = this.getCustomPerformers();
    p.id = 'u' + Date.now();
    p.rating = null; p.gigs = 0; p.custom = true;
    list.push(p);
    localStorage.setItem(this.LS_PERFORMERS, JSON.stringify(list));
    return p;
  },
  allPerformers() { return [...this.seedPerformers, ...this.getCustomPerformers()]; },
  getPerformer(id) { return this.allPerformers().find(p => p.id === id); },

  getBookings() {
    try { return JSON.parse(localStorage.getItem(this.LS_BOOKINGS)) || []; } catch { return []; }
  },
  addBooking(b) {
    const list = this.getBookings();
    b.id = 'TT-' + String(1000 + list.length + 1);
    b.created = new Date().toISOString();
    b.status = 'Confirmed (payment pending — prototype)';
    list.push(b);
    localStorage.setItem(this.LS_BOOKINGS, JSON.stringify(list));
    return b;
  },

  money(n) { return n == null ? '—' : '$' + n; },

  // Illustrated SVG avatar (no photos in prototype)
  avatarSVG(p, size = 96) {
    const motifs = {
      lips: '<path d="M24 54c8-12 18-14 24-8 6-6 16-4 24 8-8 10-18 14-24 14s-16-4-24-14z" fill="#fff" opacity=".92"/>',
      boot: '<path d="M38 26h12v22c0 4 8 6 14 8 4 1.5 4 8-2 8H38c-2 0-4-2-4-4V30c0-2 2-4 4-4z" fill="#fff" opacity=".92"/>',
      crown: '<path d="M26 56l-2-22 12 10 12-18 12 18 12-10-2 22z" fill="#fff" opacity=".92"/>',
      bowtie: '<path d="M48 46l-20-12v28l20-12 20 12V34z" fill="#fff" opacity=".92"/><circle cx="48" cy="47" r="5" fill="#fff"/>',
      feather: '<path d="M60 22C40 30 32 48 30 68c2 2 4 2 6 0 2-16 8-32 24-46zM36 58c10-4 18-14 22-26-12 6-18 14-22 26z" fill="#fff" opacity=".92"/>',
      hat: '<path d="M34 46v-8c0-8 6-14 14-14s14 6 14 14v8c8 1 12 4 12 6 0 4-12 8-26 8s-26-4-26-8c0-2 4-5 12-6z" fill="#fff" opacity=".92"/>',
      star: '<path d="M48 24l7 16 17 2-13 11 4 17-15-9-15 9 4-17-13-11 17-2z" fill="#fff" opacity=".92"/>',
    };
    const m = motifs[p.motif] || motifs.star;
    return `<svg viewBox="0 0 96 96" width="${size}" height="${size}" role="img" aria-label="${p.stage} avatar"><circle cx="48" cy="48" r="46" fill="${p.hue}"/><circle cx="48" cy="48" r="46" fill="url(#g${p.id})" opacity="0"/>${m}</svg>`;
  },
};
