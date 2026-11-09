// One SecretBox per shared item. Holds the encrypted text, encrypted attachments and the view counter.
// The counter lives here (not in KV) so two people opening the link at the same moment can't both
// get in on a 1-view item: a Durable Object handles one request at a time.
import { DurableObject } from 'cloudflare:workers';
import { LIMITS, isId, randomId, safeEq, ok, err, GONE } from './common.js';

const CHUNK = 1024 * 1024; // attachments are stored as 1 MB rows
const PENDING_MS = 60 * 60 * 1000; // an item whose upload never finished is deleted after an hour
const GRACE_MS = 10 * 60 * 1000; // attachments stay downloadable this long after the last view
const MAX_WRONG = 5; // wrong passphrases before the item destroys itself

export class SecretBox extends DurableObject {
  get sql() {
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS chunks (file INTEGER NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (file, seq))');
    return this.ctx.storage.sql;
  }

  // The record, or null if it never existed or has expired (expired ones are wiped on the spot).
  async load() {
    const m = await this.ctx.storage.get('meta');
    if (!m) return null;
    if (Date.now() >= m.expiresAt) { await this.wipe(); return null; }
    return m;
  }
  save(m) { return this.ctx.storage.put('meta', m); }
  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async alarm() { await this.ctx.storage.deleteAll(); }

  async init(m) {
    if (await this.ctx.storage.get('meta')) return err(409, 'exists');
    await this.save({ ...m, views: 0, wrong: 0, status: 'pending', uploaded: [], tickets: {} });
    await this.ctx.storage.setAlarm(Math.min(Date.now() + PENDING_MS, m.expiresAt));
    return ok();
  }

  async upload(manage, n, buf) {
    const m = await this.load();
    if (!m || !safeEq(manage, m.manage)) return GONE;
    if (m.status !== 'pending') return err(409, 'Already sealed.');
    if (!(Number.isInteger(n) && n >= 0 && n < m.files.length) || m.uploaded.includes(n)) return err(400, 'Bad file number.');
    if (buf.byteLength < 28 || buf.byteLength > LIMITS.fileBytes) return err(413, 'File is too large.');
    const bytes = new Uint8Array(buf);
    for (let seq = 0, off = 0; off < bytes.length; seq++, off += CHUNK) {
      this.sql.exec('INSERT INTO chunks (file, seq, data) VALUES (?, ?, ?)', n, seq, bytes.slice(off, off + CHUNK).buffer);
    }
    m.files[n].size = bytes.length;
    m.uploaded.push(n);
    await this.save(m);
    return ok();
  }

  async finalize(manage) {
    const m = await this.load();
    if (!m || !safeEq(manage, m.manage)) return GONE;
    if (m.status !== 'pending') return err(409, 'Already sealed.');
    if (m.uploaded.length !== m.files.length) return err(400, 'Some attachments did not finish uploading.');
    m.status = 'ready';
    await this.save(m);
    await this.ctx.storage.setAlarm(m.expiresAt);
    return ok();
  }

  // What the recipient sees before deciding to open it. Does not use a view.
  async info() {
    const m = await this.load();
    if (!m || m.status !== 'ready') return GONE;
    return ok({ hasPass: m.hasPass, viewsLeft: m.maxViews - m.views, expiresAt: m.expiresAt, files: m.files.length });
  }

  // Uses one view. The verifier proves the caller holds the key (and passphrase) without revealing either.
  async open(verifier) {
    const m = await this.load();
    if (!m || m.status !== 'ready') return GONE;
    if (!safeEq(verifier, m.verifier)) {
      m.wrong++;
      if (m.wrong >= MAX_WRONG) { await this.wipe(); return err(410, 'Too many wrong passphrases, so it destroyed itself.'); }
      await this.save(m);
      return err(403, 'Wrong passphrase.', { triesLeft: MAX_WRONG - m.wrong });
    }
    const now = Date.now();
    m.views++;
    for (const [t, exp] of Object.entries(m.tickets)) if (exp <= now) delete m.tickets[t];
    const ticket = randomId();
    m.tickets[ticket] = now + GRACE_MS;
    const out = {
      text: m.text, ticket, viewsLeft: m.maxViews - m.views,
      files: m.files.map((f) => ({ name: f.name, size: f.size })),
    };
    if (m.views >= m.maxViews) {
      if (!m.files.length) { await this.wipe(); return ok(out); }
      m.status = 'burned'; // text gone now; attachments kept briefly so this viewer can download them
      m.text = null;
      await this.ctx.storage.setAlarm(now + GRACE_MS);
    }
    await this.save(m);
    return ok(out);
  }

  async file(n, ticket) {
    const m = await this.load();
    if (!m || (m.status !== 'ready' && m.status !== 'burned')) return GONE;
    if (!isId(ticket) || !Object.hasOwn(m.tickets, ticket) || m.tickets[ticket] <= Date.now()) {
      return err(403, 'This download link expired. Open the link again.');
    }
    if (!(Number.isInteger(n) && n >= 0 && n < m.files.length)) return GONE;
    const out = new Uint8Array(m.files[n].size);
    let off = 0;
    for (const row of this.sql.exec('SELECT data FROM chunks WHERE file = ? ORDER BY seq', n)) {
      const d = new Uint8Array(row.data);
      out.set(d, off);
      off += d.length;
    }
    return { status: 200, body: out.buffer };
  }

  async destroy(manage) {
    const m = await this.ctx.storage.get('meta');
    if (!m || !safeEq(manage, m.manage)) return GONE;
    await this.wipe();
    return ok();
  }
}
