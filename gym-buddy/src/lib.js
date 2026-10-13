// Pure helpers shared by the Worker and the unit tests. No I/O here.

export const MAX_SETS = 20;
const RT_CHUNK = 2000; // Notion's per-segment rich_text limit

const str = (v, max = 40) => (v == null ? '' : String(v)).trim().slice(0, max);
const int = (v, lo, hi, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// Plan JSON -> a predictable shape. Bad pieces get defaults instead of crashing the page.
export function normalizePlan(raw) {
  const plan = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!plan || !Array.isArray(plan.blocks)) throw new Error('Plan JSON needs a "blocks" array');
  return {
    blocks: plan.blocks.map((b, bi) => ({
      name: str(b && b.name, 80) || `Block ${bi + 1}`,
      rest_sec: int(b && b.rest_sec, 0, 3600, 0),
      exercises: (Array.isArray(b && b.exercises) ? b.exercises : []).map((e, ei) => ({
        name: str(e && e.name, 80) || `Exercise ${ei + 1}`,
        sets: int(e && e.sets, 1, MAX_SETS, 1),
        reps: str(e && e.reps, 20),
        weight: str(e && e.weight, 20),
        anchor: !!(e && e.anchor),
        cue: str(e && e.cue, 200),
      })),
    })),
  };
}

// results[blockIndex][exerciseIndex] = [{reps, weight, done}] from the browser.
export function cleanResults(plan, results) {
  return plan.blocks.map((b, bi) =>
    b.exercises.map((_, ei) => {
      const sets = results && results[bi] && results[bi][ei];
      return (Array.isArray(sets) ? sets.slice(0, MAX_SETS) : []).map((s) => ({
        reps: str(s && s.reps, 20),
        weight: str(s && s.weight, 20),
        done: !!(s && s.done),
      }));
    }),
  );
}

const repsWeight = (s, sep) => (s.weight ? `${s.reps}${sep}${s.weight}` : s.reps);

// "DB RDL 3x10 @ 30s", or per-set detail when sets differ, or "(skipped)".
export function formatExercise(name, sets) {
  const done = sets.filter((s) => s.done);
  if (!done.length) return `${name} (skipped)`;
  const same = done.every((s) => s.reps === done[0].reps && s.weight === done[0].weight);
  if (same) return `${name} ${done.length}x${repsWeight(done[0], ' @ ')}`;
  return `${name} ${done.map((s) => repsWeight(s, '@')).join(', ')}`;
}

const leadingNumber = (v) => {
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// Heaviest completed set; ties (or no numeric weights) go to most reps, then the later set.
export function topSet(sets) {
  let best = null;
  for (const s of sets.filter((x) => x.done)) {
    if (!best) { best = s; continue; }
    const w = leadingNumber(s.weight), bw = leadingNumber(best.weight);
    const r = leadingNumber(s.reps) ?? 0, br = leadingNumber(best.reps) ?? 0;
    if ((w ?? -Infinity) > (bw ?? -Infinity) || ((w ?? -Infinity) === (bw ?? -Infinity) && r >= br)) best = s;
  }
  return best;
}

export function buildSummary(plan, results) {
  const workout = [];
  const anchors = [];
  plan.blocks.forEach((b, bi) =>
    b.exercises.forEach((e, ei) => {
      const sets = results[bi][ei];
      workout.push(formatExercise(e.name, sets));
      if (e.anchor) {
        const t = topSet(sets);
        if (t) anchors.push(`${e.name} ${repsWeight(t, ' @ ')}`);
      }
    }),
  );
  return { workout: workout.join('\n'), anchorLifts: anchors.join('\n') };
}

export function richText(text) {
  const out = [];
  for (let i = 0; i < text.length; i += RT_CHUNK) out.push({ type: 'text', text: { content: text.slice(i, i + RT_CHUNK) } });
  return out;
}

export const plainText = (rt) => (Array.isArray(rt) ? rt.map((t) => t.plain_text ?? t.text?.content ?? '').join('') : '');

// Session fields from the browser -> validated values; null means "leave it alone".
export function cleanFields(f = {}) {
  const num = (v, lo, hi, step) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`value ${v} out of range ${lo}-${hi}`);
    return Math.round(n / step) * step;
  };
  return {
    energy: num(f.energy, 1, 5, 1),
    rpe: num(f.rpe, 1, 10, 0.5),
    duration: num(f.duration, 0, 600, 1),
    stretching: !!f.stretching,
    pain: str(f.pain, 2000),
  };
}

export const normalizeId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
export const isNotionId = (id) => /^[0-9a-f]{32}$/.test(normalizeId(id));
