import { MIN, MAX } from '../model.js';

// Plates currently sitting on an edge (pin 1 or 7), with their position. Plate labels
// shown to the user are 1-based (P1..Pn); the returned `plate` is the 0-based index.
export function edgePlates(positions) {
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] <= MIN || positions[i] >= MAX) out.push({ plate: i, pos: positions[i] });
  }
  return out;
}

// One-line coaching derived from live positions: which slides to clear before probing,
// or an all-clear. Recomputed every render — no persisted state.
export function coachingMessage(positions) {
  const edges = edgePlates(positions);
  if (edges.length === 0) return 'No slides on the edges — safe to probe freely.';
  const list = edges.map((e) => `P${e.plate + 1} (pin ${e.pos})`).join(', ');
  const noun = edges.length === 1 ? 'slide' : 'slides';
  return `${edges.length} ${noun} on the edge — ${list}. Move these toward center before test-probing others, or a probe may break the pick.`;
}
