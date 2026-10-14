import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, cleanResults, cleanExtras, buildSummary, formatExercise, topSet, richText, cleanFields, isNotionId } from '../src/lib.js';

const PLAN = {"blocks":[{"name":"Superset 1","rest_sec":90,"exercises":[
  {"name":"DB RDL","sets":3,"reps":"10","weight":"30s","anchor":true,"cue":"hips back, flat back"},
  {"name":"Push-up","sets":2,"reps":"12","weight":""}]}]};
const s = (reps, weight, done = true) => ({ reps, weight, done });

test('uniform sets read as NxR @ W', () => {
  assert.equal(formatExercise('DB RDL', [s('10','30s'), s('10','30s'), s('10','30s')]), 'DB RDL 3x10 @ 30s');
  assert.equal(formatExercise('Push-up', [s('12',''), s('12','')]), 'Push-up 2x12');
});
test('mixed sets list each one, undone sets ignored', () => {
  assert.equal(formatExercise('DB RDL', [s('10','30s'), s('10','35s'), s('8','35s'), s('8','40s', false)]), 'DB RDL 10@30s, 10@35s, 8@35s');
});
test('no done sets = skipped', () => assert.equal(formatExercise('X', [s('5','1', false)]), 'X (skipped)'));
test('top set = heaviest, ties by reps', () => {
  assert.deepEqual(topSet([s('10','30s'), s('8','35s'), s('6','35s')]), s('8','35s'));
  assert.deepEqual(topSet([s('10','BW'), s('12','BW')]), s('12','BW'));
  assert.equal(topSet([s('10','30s', false)]), null);
});
test('summary end to end', () => {
  const plan = normalizePlan(JSON.stringify(PLAN));
  const res = cleanResults(plan, [[[s('10','30s'), s('10','35s'), s('10','35s')], [s('12',''), s('12','', false)]]]);
  assert.deepEqual(buildSummary(plan, res), {
    workout: 'DB RDL 10@30s, 10@35s, 10@35s\nPush-up 1x12',
    anchorLifts: 'DB RDL 35s x10',
  });
});
test('per-exercise RPE and note', () => {
  const plan = normalizePlan(PLAN);
  const res = cleanResults(plan, [[[s('10','30s'), s('10','30s'), s('10','30s')], [s('12',''), s('12','', false)]]]);
  const ex = cleanExtras(plan, [[{ rpe: '7', note: ' felt strong\n' }, { rpe: '', note: 'wrist sore' }]]);
  assert.deepEqual(buildSummary(plan, res, ex), {
    workout: 'DB RDL 3x10 @ 30s (RPE 7) - felt strong\nPush-up 1x12 - wrist sore',
    anchorLifts: 'DB RDL 30s x10 (RPE 7)',
  });
});
test('note on a skipped exercise is kept; bad RPE dropped', () => {
  const plan = normalizePlan(PLAN);
  const ex = cleanExtras(plan, [[{ rpe: 42, note: 'knee, skipped' }]]);
  assert.equal(ex[0][0].rpe, null);
  assert.equal(buildSummary(plan, cleanResults(plan, null), ex).workout, 'DB RDL (skipped) - knee, skipped\nPush-up (skipped)');
});
test('missing results become skipped, not a crash', () => {
  const plan = normalizePlan(PLAN);
  assert.equal(buildSummary(plan, cleanResults(plan, null)).workout, 'DB RDL (skipped)\nPush-up (skipped)');
});
test('bad plan throws', () => assert.throws(() => normalizePlan('{"nope":1}')));
test('rich text chunks at 2000', () => {
  const rt = richText('a'.repeat(4500));
  assert.deepEqual(rt.map((r) => r.text.content.length), [2000, 2000, 500]);
  assert.deepEqual(richText(''), []);
});
test('field validation', () => {
  assert.deepEqual(cleanFields({ energy: '4', rpe: 7.5, duration: '', stretching: 1, pain: ' knee ' }),
    { energy: 4, rpe: 7.5, duration: null, stretching: true, pain: 'knee' });
  assert.throws(() => cleanFields({ energy: 9 }));
});
test('notion id check', () => {
  assert.ok(isNotionId('3f8144f3-8f3c-81e5-866e-e5eb6f080a63'));
  assert.ok(!isNotionId('../users'));
});
