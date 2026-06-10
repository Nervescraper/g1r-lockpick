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

// Set/flip the active plate's press direction (a press is always ±1). A negative argument
// sets Right (-1); any non-negative value (including 0) sets Left (+1).
export function setActiveDir(rec, deltaI) {
  return { ...rec, deltaI: deltaI < 0 ? -1 : 1 };
}

// Click a with/opposite button: set it, switch to the other kind, or clear it.
export function toggleTag(rec, j, kind) {
  if (j === rec.active) return rec; // the active plate is never tagged
  const tags = { ...rec.tags };
  if (tags[j] === kind) delete tags[j];
  else tags[j] = kind;
  return { ...rec, tags };
}

// Drag the active plate one slot: the sign of the displacement is the press direction.
// Dragging back onto baseline leaves the direction unchanged.
export function dragActive(rec, pos) {
  const d = clampStep(rec.baseline[rec.active], pos) - rec.baseline[rec.active];
  if (d === 0) return rec;
  return setActiveDir(rec, d);
}

// Drag another plate one slot: a step matching the active direction tags it `with`,
// an opposing step tags it `opposite`, returning to baseline clears the tag.
export function dragOther(rec, j, pos) {
  if (j === rec.active) return rec; // the active plate is dragged via dragActive, never tagged
  const d = clampStep(rec.baseline[j], pos) - rec.baseline[j];
  const tags = { ...rec.tags };
  if (d === 0) delete tags[j];
  else tags[j] = d === rec.deltaI ? 'with' : 'opposite';
  return { ...rec, tags };
}

// A successful probe can never push a plate off the board — every derived position must
// stay in 1..7. (The ±1 clamp already prevents over-large steps; this guards the edge.)
export function validRecording(rec) {
  return positionsOf(rec).every((v) => v >= MIN && v <= MAX);
}

// True when two position arrays are element-wise equal. Used to decide whether a stashed
// recording draft is still valid for the current board (a committed move changes positions).
export function samePositions(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// A stashed draft is restorable only if it exists AND its baseline still matches the live
// board. Any committed move (Save, apply-move, jam) changes positions and invalidates every
// stale draft, so switching back to such a plate builds a fresh recording instead.
export function restorableDraft(drafts, plate, positions) {
  const d = drafts && drafts[plate];
  if (d && samePositions(d.baseline, positions)) return d;
  return null;
}
