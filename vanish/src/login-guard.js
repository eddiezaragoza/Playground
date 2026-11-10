// Counts wrong access codes. After MAX_FAILS in one UTC day, every login is refused until tomorrow,
// so nobody can sit and guess the code.
import { DurableObject } from 'cloudflare:workers';

const MAX_FAILS = 20;
const today = () => new Date().toISOString().slice(0, 10);

// Every attempt is counted as a failure BEFORE the code is checked, in one step, and refunded only if
// it was right. Checking first and counting later would let a burst of simultaneous guesses all slip
// through before the first failure was recorded.
export class LoginGuard extends DurableObject {
  async attempt() {
    let r = await this.ctx.storage.get('fails');
    if (!r || r.day !== today()) r = { day: today(), n: 0 };
    if (r.n >= MAX_FAILS) return false;
    r.n++;
    await this.ctx.storage.put('fails', r);
    return true;
  }
  async refund() {
    const r = await this.ctx.storage.get('fails');
    if (r && r.day === today() && r.n > 0) { r.n--; await this.ctx.storage.put('fails', r); }
  }
}
