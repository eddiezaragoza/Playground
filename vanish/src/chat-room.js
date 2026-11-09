// One ChatRoom per room. Relays and stores encrypted messages over WebSockets, and deletes everything
// when the room expires. It uses the hibernation API, so an idle room costs nothing while people sit in it.
import { DurableObject } from 'cloudflare:workers';
import { LIMITS, safeEq, ok, GONE } from './common.js';

const RATE_WINDOW_MS = 10000;
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
    return m ? ok({ hasPass: m.hasPass, expiresAt: m.expiresAt }) : GONE;
  }
  async check(verifier) {
    const m = await this.load();
    if (!m) return GONE;
    return safeEq(verifier, m.verifier) ? ok() : { status: 403, body: { error: 'Wrong passphrase.' } };
  }
  async destroy(manage) {
    const m = await this.load();
    if (!m || !safeEq(manage, m.manage)) return GONE;
    await this.wipe(4001, 'The room was deleted.');
    return ok();
  }

  // WebSocket join. The Worker already checked the Origin; here we check the verifier.
  async fetch(req) {
    const m = await this.load();
    if (!m) return new Response('gone', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!safeEq(new URL(req.url).searchParams.get('v'), m.verifier)) return new Response('forbidden', { status: 403 });
    if (this.ctx.getWebSockets().length >= LIMITS.roomSockets) return new Response('room full', { status: 429 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ hello: null, times: [] });
    const msgs = this.sql.exec('SELECT id, ts, data FROM msgs ORDER BY id DESC LIMIT ?', LIMITS.history).toArray().reverse();
    server.send(JSON.stringify({ type: 'history', msgs, expiresAt: m.expiresAt }));
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
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
      const { id } = this.sql.exec('INSERT INTO msgs (ts, data) VALUES (?, ?) RETURNING id', now, msg.data).one();
      this.sql.exec('DELETE FROM msgs WHERE id <= ?', id - LIMITS.keep);
      this.broadcast({ type: 'msg', id, ts: now, data: msg.data });
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
