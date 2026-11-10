// One ChatRoom per room. Relays and stores encrypted messages over WebSockets, and deletes everything
// when the room expires. It uses the hibernation API, so an idle room costs nothing while people sit in it.
import { DurableObject } from 'cloudflare:workers';
import { LIMITS, IMG_ID_RE, randomId, safeEq, ok, err, GONE } from './common.js';

const CHUNK = 1024 * 1024; // photos are stored as 1 MB rows

const WRONG_MAX = 10; // wrong passphrases per room per 15 minutes before it stops accepting tries
const WRONG_WINDOW_MS = 15 * 60 * 1000;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 10000;
const today = () => new Date().toISOString().slice(0, 10);
const RATE_MAX = 20; // messages per person per 10 seconds

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  get sql() {
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, data TEXT NOT NULL)');
    return this.ctx.storage.sql;
  }

  // Reactions are encrypted events ({who, emoji, on/off}) pointing at a message id. The server sees only
  // "someone reacted to message 42", never who or which emoji.
  get reactSql() {
    const sql = this.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS reacts (id INTEGER PRIMARY KEY AUTOINCREMENT, target INTEGER NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)');
    return sql;
  }

  get imgSql() {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS imgs (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, size INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS img_chunks (id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, seq))');
    return sql;
  }

  // Every key check goes through here. Wrong guesses are counted, so a leaked link without its
  // passphrase can't be brute-forced: after WRONG_MAX misses the room refuses all tries for 15 minutes.
  async gate(m, verifier) {
    const now = Date.now();
    const w = m.wrong && now - m.wrong.since < WRONG_WINDOW_MS ? m.wrong : { since: now, n: 0 };
    if (w.n >= WRONG_MAX) return err(429, 'Too many wrong passphrases. Try again in 15 minutes.');
    if (safeEq(verifier, m.verifier)) return null;
    w.n++;
    m.wrong = w;
    await this.ctx.storage.put('meta', m);
    return err(403, 'Wrong passphrase.');
  }

  // Encrypted photo upload. Only someone holding the room key (the verifier proves it) can add one.
  async putImage(verifier, buf) {
    const m = await this.load();
    if (!m) return GONE;
    const denied = await this.gate(m, verifier);
    if (denied) return denied;
    if (buf.byteLength < 28 || buf.byteLength > LIMITS.imgBytes) return err(413, 'That photo is too large.');
    const now = Date.now();
    const u = m.uploads && now - m.uploads.since < UPLOAD_WINDOW_MS ? m.uploads : { since: now, n: 0 };
    if (u.n >= (Number(this.env.TEST_ROOM_UPLOADS) || LIMITS.roomUploads)) return err(429, 'Too many photos too fast. Wait a few minutes.');
    u.n++;
    m.uploads = u;
    await this.ctx.storage.put('meta', m);
    const sql = this.imgSql;
    const id = randomId();
    const bytes = new Uint8Array(buf);
    for (let seq = 0, off = 0; off < bytes.length; seq++, off += CHUNK) {
      sql.exec('INSERT INTO img_chunks (id, seq, data) VALUES (?, ?, ?)', id, seq, bytes.slice(off, off + CHUNK).buffer);
    }
    sql.exec('INSERT INTO imgs (id, ts, size) VALUES (?, ?, ?)', id, Date.now(), bytes.length);
    // Keep only the newest photos: at most LIMITS.roomImages of them and LIMITS.roomImageBytes in total.
    let kept = 0;
    let bytesKept = 0;
    for (const row of sql.exec('SELECT id, size FROM imgs ORDER BY ts DESC, rowid DESC').toArray()) {
      kept++;
      bytesKept += row.size;
      if (kept > LIMITS.roomImages || bytesKept > LIMITS.roomImageBytes) {
        sql.exec('DELETE FROM img_chunks WHERE id = ?', row.id);
        sql.exec('DELETE FROM imgs WHERE id = ?', row.id);
      }
    }
    return ok({ id });
  }

  async getImage(verifier, id) {
    const m = await this.load();
    if (!m) return GONE;
    const denied = await this.gate(m, verifier);
    if (denied) return denied;
    if (!IMG_ID_RE.test(id || '')) return GONE;
    const sql = this.imgSql;
    const row = sql.exec('SELECT size FROM imgs WHERE id = ?', id).toArray()[0];
    if (!row) return GONE;
    const out = new Uint8Array(row.size);
    let off = 0;
    for (const r of sql.exec('SELECT data FROM img_chunks WHERE id = ? ORDER BY seq', id)) {
      const d = new Uint8Array(r.data);
      out.set(d, off);
      off += d.length;
    }
    return { status: 200, body: out.buffer };
  }

  // Room-wide budget for stored events (messages + reactions), on top of the per-person limit, so one member
  // with many connections can't flood. The per-minute window lives in memory (a flood keeps the room awake);
  // the daily count is saved every 25 events so it survives restarts at little write cost.
  async spend() {
    const now = Date.now();
    const perMin = Number(this.env.TEST_ROOM_EVENTS_PER_MIN) || LIMITS.roomEventsPerMin;
    this.recent = (this.recent || []).filter((t) => now - t < 60000);
    if (this.recent.length >= perMin) return 'This room is very busy. Wait a moment.';
    if (!this.daily) this.daily = (await this.ctx.storage.get('daily')) || { day: today(), n: 0 };
    if (this.daily.day !== today()) this.daily = { day: today(), n: 0 };
    if (this.daily.n >= LIMITS.roomEventsPerDay) return 'This room reached today\'s message limit.';
    this.recent.push(now);
    this.daily.n++;
    if (this.daily.n % 25 === 0) await this.ctx.storage.put('daily', this.daily);
    return null;
  }

  // GIF search goes through the room so it can be limited per room (and only members can search).
  async gifAllowed(verifier) {
    const m = await this.load();
    if (!m) return GONE;
    const denied = await this.gate(m, verifier);
    if (denied) return denied;
    const now = Date.now();
    this.gifTimes = (this.gifTimes || []).filter((t) => now - t < 10 * 60 * 1000);
    if (this.gifTimes.length >= LIMITS.roomGifSearches) return err(429, 'Lots of GIF searches right now. Try again in a few minutes.');
    this.gifTimes.push(now);
    return ok();
  }

  async load() {
    const m = await this.ctx.storage.get('meta');
    if (!m) return null;
    if (Date.now() >= m.expiresAt) { await this.wipe(4000, 'This room expired.'); return null; }
    return m;
  }
  async wipe(code, reason) {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(code, reason); } catch { /* already closed */ } }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(4000, 'This room expired.'); } catch { /* already closed */ } }
    await this.ctx.storage.deleteAll();
  }

  async init(m) {
    await this.ctx.storage.put('meta', m);
    await this.ctx.storage.setAlarm(m.expiresAt);
    return ok();
  }
  async info() {
    const m = await this.load();
    return m ? ok({ hasPass: m.hasPass, expiresAt: m.expiresAt, name: m.name || '' }) : GONE;
  }
  async check(verifier) {
    const m = await this.load();
    if (!m) return GONE;
    return (await this.gate(m, verifier)) || ok();
  }
  // Only the creator (holder of the manage token) can rename. The name is ciphertext, like everything else.
  async rename(manage, name) {
    const m = await this.load();
    if (!m || !safeEq(manage, m.manage)) return GONE;
    m.name = name;
    await this.ctx.storage.put('meta', m);
    this.broadcast({ type: 'name', data: name });
    return ok();
  }

  async destroy(manage) {
    const m = await this.load();
    if (!m || !safeEq(manage, m.manage)) return GONE;
    await this.wipe(4001, 'The room was deleted.');
    return ok();
  }

  // WebSocket join. The Worker already checked the Origin; here we check the verifier. It arrives as the
  // second WebSocket "subprotocol" (header), not in the URL, so it never lands in URL logs.
  async fetch(req) {
    const m = await this.load();
    if (!m) return new Response('gone', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const [proto, verifier] = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((x) => x.trim());
    if (proto !== 'poof') return new Response('forbidden', { status: 403 });
    const denied = await this.gate(m, verifier);
    if (denied) return new Response(denied.body.error, { status: denied.status });
    if (this.ctx.getWebSockets().length >= LIMITS.roomSockets) return new Response('room full', { status: 429 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ hello: null, times: [] });
    const msgs = this.sql.exec('SELECT id, ts, data FROM msgs ORDER BY id DESC LIMIT ?', LIMITS.history).toArray().reverse();
    const reacts = msgs.length
      ? this.reactSql.exec('SELECT id, target, data FROM reacts WHERE target >= ? ORDER BY id', msgs[0].id).toArray()
      : [];
    server.send(JSON.stringify({ type: 'history', msgs, reacts, expiresAt: m.expiresAt }));
    this.presence();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'poof' } });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > LIMITS.msgChars + 200) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment() || { hello: null, times: [] };
    const now = Date.now();
    a.times = a.times.filter((t) => now - t < RATE_WINDOW_MS);
    if (a.times.length >= RATE_MAX) { ws.send(JSON.stringify({ type: 'error', error: 'Slow down a little.' })); return; }
    a.times.push(now);
    ws.serializeAttachment(a);

    if (msg?.type === 'hello' && typeof msg.data === 'string' && msg.data.length <= LIMITS.helloChars) {
      a.hello = msg.data; // encrypted display name; the server can't read it
      ws.serializeAttachment(a);
      this.presence();
      return;
    }
    if (msg?.type === 'msg' && typeof msg.data === 'string' && msg.data.length > 0 && msg.data.length <= LIMITS.msgChars) {
      if (!(await this.load())) return; // expired between messages; load() already closed everyone
      const busy = await this.spend();
      if (busy) { ws.send(JSON.stringify({ type: 'error', error: busy })); return; }
      const { id } = this.sql.exec('INSERT INTO msgs (ts, data) VALUES (?, ?) RETURNING id', now, msg.data).one();
      this.sql.exec('DELETE FROM msgs WHERE id <= ?', id - LIMITS.keep);
      this.reactSql.exec('DELETE FROM reacts WHERE target <= ?', id - LIMITS.keep);
      this.broadcast({ type: 'msg', id, ts: now, data: msg.data });
      return;
    }
    if (msg?.type === 'react' && Number.isInteger(msg.target) && typeof msg.data === 'string' &&
        msg.data.length > 0 && msg.data.length <= LIMITS.reactChars) {
      if (!(await this.load())) return;
      if (!this.sql.exec('SELECT 1 FROM msgs WHERE id = ?', msg.target).toArray().length) return; // no such message
      const busy = await this.spend();
      if (busy) { ws.send(JSON.stringify({ type: 'error', error: busy })); return; }
      const sql = this.reactSql;
      const { id } = sql.exec('INSERT INTO reacts (target, ts, data) VALUES (?, ?, ?) RETURNING id', msg.target, now, msg.data).one();
      sql.exec('DELETE FROM reacts WHERE id <= ?', id - LIMITS.reactKeep);
      this.broadcast({ type: 'react', id, target: msg.target, data: msg.data });
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    this.presence(ws);
  }
  async webSocketError(ws) { this.presence(ws); }

  open(except) { return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === WebSocket.OPEN); }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const w of this.open(except)) { try { w.send(s); } catch { /* closing */ } }
  }
  presence(except) {
    const socks = this.open(except);
    const list = socks.map((w) => w.deserializeAttachment()?.hello).filter(Boolean);
    this.broadcast({ type: 'presence', list, count: socks.length }, except);
  }
}
