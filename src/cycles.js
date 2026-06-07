// Detect repeating cycles in a solve plan. A "cycle" is a contiguous run that is
// an exact repetition of some unit block (reps >= 2) whose unit touches at most
// 3 distinct plates. Pure: no DOM, no app state. See
// docs/specs/2026-06-05-cycle-indicators-design.md.

const MAX_PLATES = 3;

const token = (mv) => `${mv.plate}${mv.dir}`;

// The best cycle starting exactly at index i, or null if none qualifies.
// "Best" = greatest coverage (reps * unitLen); ties break to the smallest unit.
function bestCycleAt(plan, i) {
  const n = plan.length;
  const maxLen = Math.floor((n - i) / 2); // need room for at least two reps
  let best = null;

  for (let len = 1; len <= maxLen; len++) {
    const plates = new Set();
    for (let j = i; j < i + len; j++) plates.add(plan[j].plate);
    if (plates.size > MAX_PLATES) continue;

    let reps = 1;
    for (;;) {
      const base = i + reps * len;
      if (base + len > n) break;
      let match = true;
      for (let j = 0; j < len; j++) {
        if (token(plan[i + j]) !== token(plan[base + j])) { match = false; break; }
      }
      if (!match) break;
      reps++;
    }
    if (reps < 2) continue;

    const coverage = reps * len;
    if (!best || coverage > best.length || (coverage === best.length && len < best.unitLen)) {
      best = {
        type: 'cycle',
        start: i,
        unit: plan.slice(i, i + len),
        unitLen: len,
        reps,
        length: coverage,
        plates: [...plates].sort((a, b) => a - b),
      };
    }
  }
  return best;
}

// Segment the flat move array left-to-right into 'single' and 'cycle' segments
// that cover the whole plan with no gaps or overlaps.
export function findCycles(plan) {
  const segs = [];
  let i = 0;
  while (i < plan.length) {
    const cyc = bestCycleAt(plan, i);
    if (cyc) { segs.push(cyc); i += cyc.length; }
    else { segs.push({ type: 'single', index: i }); i += 1; }
  }
  return segs;
}

// Row/group layout for the EXPANDED plan view (every move shown). Returns an ordered
// list of items: { kind: 'row', index } or { kind: 'group', seg, indices: [...] }.
//
// A cycle whose unit is a single move (unitLen 1 — e.g. the grouped runs the solver
// emits, "P1← P1← P1←") is flattened to plain rows: each repetition is already its
// own row, so wrapping them in a ×N bracket would read as N×N. Only a cycle with a
// multi-move repeating unit is shown as a bracketed group. (The collapsed view keeps
// the ×N bracket for runs, where the unit is shown only once.)
export function expandedLayout(segs) {
  const items = [];
  for (const seg of segs) {
    if (seg.type === 'single') {
      items.push({ kind: 'row', index: seg.index });
      continue;
    }
    const indices = [];
    for (let i = seg.start; i < seg.start + seg.length; i++) indices.push(i);
    if (seg.unitLen === 1) {
      for (const index of indices) items.push({ kind: 'row', index });
    } else {
      items.push({ kind: 'group', seg, indices });
    }
  }
  return items;
}
