import { MIN, MAX, GOAL } from '../model.js';

// The active plate's one-slot press direction as a signed delta: +1 = pressed Left
// (position rises), -1 = pressed Right (position falls). The default points toward
// center so tagging works before the player drags anything.
export function suggestedDeltaI(pos) {
  return pos > GOAL ? -1 : 1;
}

// Clamp a raw dragged position to a single slot from baseline (one press moves any
// plate at most one slot), then to the board's 1..7 range.
export function clampStep(baseline, pos) {
  const oneSlot = Math.max(baseline - 1, Math.min(baseline + 1, pos));
  return Math.max(MIN, Math.min(MAX, oneSlot));
}

// Start recording a probe of `active`. baseline = positions at probe start (copied);
// deltaI defaults toward center; tags seed from an already-mapped row when re-editing.
export function createRecording(positions, active, tags = {}) {
  return {
    baseline: positions.slice(),
    active,
    deltaI: suggestedDeltaI(positions[active]),
    tags: { ...tags },
  };
}

export function tagOf(rec, j) {
  return rec.tags[j] ?? 'none';
}

// Live position of every plate: the active plate moves by deltaI, with-plates follow
// it, opposite-plates mirror it, untagged plates stay at baseline. May return a value
// outside 1..7 (e.g. a plate at an edge pushed off); callers validate with validRecording.
export function positionsOf(rec) {
  return rec.baseline.map((b, j) => {
    if (j === rec.active) return b + rec.deltaI;
    const t = rec.tags[j];
    if (t === 'with') return b + rec.deltaI;
    if (t === 'opposite') return b - rec.deltaI;
    return b;
  });
}

// coupling[active][j] = delta_j * delta_i, with delta_i = ±1: with -> +1, opposite -> -1,
// none -> 0; the active plate moves itself (1). Independent of deltaI's sign.
export function couplingRow(rec) {
  const row = rec.baseline.map(() => 0);
  row[rec.active] = 1; // the active plate moves itself, by definition
  for (const j of Object.keys(rec.tags)) {
    if (+j === rec.active) continue; // never let a stray tag clobber the self-entry
    row[+j] = rec.tags[j] === 'with' ? 1 : -1;
  }
  return row;
}
