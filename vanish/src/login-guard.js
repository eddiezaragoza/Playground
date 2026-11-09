// Counts wrong access codes. After MAX_FAILS in one UTC day, every login is refused until tomorrow,
// so nobody can sit and guess the code.
import { DurableObject } from 'cloudflare:workers';

const MAX_FAILS = 20;
const today = () => new Date().toISOString().slice(0, 10);

export class LoginGuard extends DurableObject {
  async allowed() {
    const r = await this.ctx.storage.get('fails');
    return !(r && r.day === today() && r.n >= MAX_FAILS);
  }
  async fail() {
    let r = await this.ctx.storage.get('fails');
    if (!r || r.day !== today()) r = { day: today(), n: 0 };
    r.n++;
    await this.ctx.storage.put('fails', r);
  }
}
