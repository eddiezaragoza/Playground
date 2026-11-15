import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimer, normalizePlan, cleanResults } from '../src/lib.js';

test('single countdowns', () => {
  assert.deepEqual(parseTimer('2 min'), { kind: 'single', sec: 120, fill: '2 min' });
  assert.deepEqual(parseTimer('60s'), { kind: 'single', sec: 60, fill: '60s' });
  assert.equal(parseTimer('45s').sec, 45);
  assert.equal(parseTimer('90 sec').sec, 90);
  assert.equal(parseTimer('1:30').sec, 90);
  assert.equal(parseTimer('1.5 min').sec, 90);
  assert.equal(parseTimer(' 30 Seconds ').sec, 30);
});
test('each side = left, switch, right', () => {
  assert.deepEqual(parseTimer('60s each'), { kind: 'each', sec: 60, gap: 5, fill: '60s each' });
  assert.equal(parseTimer('45s each').sec, 45);
  assert.equal(parseTimer('30s each side').kind, 'each');
  assert.equal(parseTimer('1 min per leg').sec, 60);
});
test('intervals', () => {
  assert.deepEqual(parseTimer('3 min hard / 2 min walk'),
    { kind: 'interval', work: 180, rest: 120, workLabel: 'HARD', restLabel: 'WALK', fill: '3 min/2 min' });
  assert.deepEqual(parseTimer('30s on/30s off'),
    { kind: 'interval', work: 30, rest: 30, workLabel: 'ON', restLabel: 'OFF', fill: '30s/30s' });
  const t = parseTimer('40s / 20s');
  assert.equal(t.workLabel, 'WORK'); assert.equal(t.restLabel, 'REST');
});
test('ordinary reps are not timers', () => {
  for (const r of ['10', '8-12', 'AMRAP', '', null, undefined, '10 each', '12 / 10', 'max', '0s', '2 min walk then run'])
    assert.equal(parseTimer(r), null, String(r));
});
test('normalizePlan keeps the full interval text and attaches the timer', () => {
  const plan = normalizePlan('PLAN {"blocks":[{"name":"Finisher","exercises":[{"name":"Incline walk","sets":4,"reps":"3 min hard / 2 min walk"},{"name":"Goblet Squat","sets":3,"reps":"10"}]}]}');
  const [walk, squat] = plan.blocks[0].exercises;
  assert.equal(walk.reps, '3 min hard / 2 min walk');
  assert.equal(walk.timer.kind, 'interval');
  assert.equal(squat.timer, null);
  // Save format unchanged: reps are still capped at 20 on the way back.
  const res = cleanResults(plan, [[[{ reps: walk.timer.fill, weight: '', done: true }], [{ reps: '10', weight: '', done: true }]]]);
  assert.equal(res[0][0][0].reps, '3 min/2 min');
});
