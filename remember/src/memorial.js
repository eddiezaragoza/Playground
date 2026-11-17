// One Durable Object per memorial page (named by its slug). It keeps every shared photo, its small preview,
// who shared it and their note, the page settings and the daily counters, all in the object's SQLite storage.
// Photos are split into 1 MB chunks because one SQLite value can hold at most 2 MB (same approach as Poof's chat photos).
import { DurableObject } from 'cloudflare:workers';

const CHUNK = 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);
const STATUSES = new Set(['live', 'pending', 'hidden']);

export class Memorial extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, name TEXT NOT NULL, note TEXT NOT NULL,
      status TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, thumb BLOB)`);
    sql.exec('CREATE TABLE IF NOT EXISTS chunks (id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, seq))');
    sql.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, day TEXT NOT NULL, n INTEGER NOT NULL)');
  }

  get sql() { return this.ctx.storage.sql; }

  // ---------- counters (one UTC day each) ----------
  // Takes one from a daily allowance. Returns false (and takes nothing) once `max` is reached.
  take(key, max) {
    const row = this.sql.exec('SELECT day, n FROM counters WHERE k = ?', key).toArray()[0];
    const n = row && row.day === today() ? row.n : 0;
    if (n >= max) return false;
    this.sql.exec('INSERT OR REPLACE INTO counters (k, day, n) VALUES (?, ?, ?)', key, today(), n + 1);
    return true;
  }
  give(key) {
    this.sql.exec('UPDATE counters SET n = n - 1 WHERE k = ? AND day = ? AND n > 0', key, today());
  }

  // Wrong admin passwords: counted before the check (so a burst can't slip through) and refunded when right.
  loginAttempt(who, perPerson, siteWide) {
    if (!this.take(`login:${who}`, perPerson)) return false;
    if (!this.take('login:all', siteWide)) { this.give(`login:${who}`); return false; }
    return true;
  }
  loginRefund(who) { this.give(`login:${who}`); this.give('login:all'); }

  // ---------- settings ----------
  getSettings() {
    const out = {};
    for (const r of this.sql.exec('SELECT k, v FROM settings')) out[r.k] = r.v;
    return out;
  }
  setSettings(values) {
    for (const [k, v] of Object.entries(values)) this.sql.exec('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', k, String(v));
    return this.getSettings();
  }

  // ---------- photos ----------
  stats() {
    const r = this.sql.exec(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes,
      COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'hidden'), 0) AS hidden
      FROM photos WHERE id != '_cover'`).toArray()[0];
    return { photos: r.n, bytes: r.bytes, pending: r.pending, hidden: r.hidden };
  }

  // limits: { perPerson, siteWide, maxPhotos, maxBytes }
  addPhoto({ who, bytes, type, thumb, name, note }, limits) {
    const s = this.stats();
    if (s.photos >= limits.maxPhotos || s.bytes + bytes.byteLength > limits.maxBytes) {
      return { status: 507, error: 'The photo album is full. Please let the family know.' };
    }
    if (!this.take(`up:${who}`, limits.perPerson)) {
      return { status: 429, error: "You've shared a lot of photos today. Thank you! Please try again tomorrow." };
    }
    if (!this.take('up:all', limits.siteWide)) {
      this.give(`up:${who}`);
      return { status: 429, error: 'Too many photos were shared today. Please try again tomorrow.' };
    }
    const id = crypto.randomUUID().replace(/-/g, '');
    const status = this.getSettings().approval === '1' ? 'pending' : 'live';
    this.store(id, bytes, type, thumb, name, note, status);
    return { status: 200, id, photoStatus: status };
  }

  store(id, bytes, type, thumb, name, note, status) {
    const u8 = new Uint8Array(bytes);
    this.ctx.storage.transactionSync(() => {
      this.dropData(id);
      for (let off = 0, seq = 0; off < u8.length; off += CHUNK, seq++) {
        this.sql.exec('INSERT INTO chunks (id, seq, data) VALUES (?, ?, ?)', id, seq, u8.slice(off, off + CHUNK).buffer);
      }
      this.sql.exec('INSERT INTO photos (id, ts, name, note, status, type, size, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, Date.now(), name, note, status, type, u8.length, thumb || null);
    });
  }

  setCover(bytes, type) {
    this.store('_cover', bytes, type, null, '', '', 'hidden');
    return this.setSettings({ coverVersion: Date.now() });
  }
  removeCover() {
    this.dropData('_cover');
    return this.setSettings({ coverVersion: '' });
  }

  // which: 'full' | 'thumb'. Returns null when missing, or when `onlyLive` and the photo isn't live.
  getPhoto(id, which, onlyLive) {
    const row = this.sql.exec('SELECT status, type, thumb FROM photos WHERE id = ?', id).toArray()[0];
    if (!row || (onlyLive && row.status !== 'live')) return null;
    if (which === 'thumb' && row.thumb) return { type: 'image/jpeg', bytes: row.thumb };
    const parts = this.sql.exec('SELECT data FROM chunks WHERE id = ? ORDER BY seq', id).toArray().map((r) => new Uint8Array(r.data));
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return { type: row.type, bytes: out.buffer };
  }

  // Newest first. onlyLive leaves out pending and hidden photos (for the slideshow).
  list(onlyLive) {
    const where = onlyLive ? "WHERE status = 'live' AND id != '_cover'" : "WHERE id != '_cover'";
    return this.sql.exec(`SELECT id, ts, name, note, status, size FROM photos ${where} ORDER BY ts DESC`).toArray();
  }

  setStatus(id, status) {
    if (!STATUSES.has(status) || id === '_cover') return false;
    return this.sql.exec('UPDATE photos SET status = ? WHERE id = ?', status, id).rowsWritten > 0;
  }

  remove(id) {
    if (id === '_cover') return false;
    const found = this.sql.exec('SELECT 1 FROM photos WHERE id = ?', id).toArray().length > 0;
    this.dropData(id);
    return found;
  }

  dropData(id) {
    this.sql.exec('DELETE FROM chunks WHERE id = ?', id);
    this.sql.exec('DELETE FROM photos WHERE id = ?', id);
  }
}
