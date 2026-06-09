// Ground-truth lock definitions for the end-to-end harness. Each lock is the
// hidden state of a real (simulated) Gothic lock: `coupling[i][j]` is how a
// Left-press of plate i shifts plate j (+1 same direction, -1 opposite, 0 not
// linked; the diagonal is always 1), and `initial` is where the pins start.
// The harness plays the part of the player: the site never sees these matrices
// directly — only the observations the harness reports through the UI.
export const LOCKS = [
  {
    id: 'easy',
    label: 'Easy · 3 plates, one link pair',
    n: 3,
    coupling: [
      [1, 0, 0],
      [0, 1, 1],
      [0, -1, 1],
    ],
    initial: [3, 6, 2],
  },
  {
    id: 'medium',
    label: 'Medium · 5 plates, chained links',
    n: 5,
    coupling: [
      [1, 1, 0, 0, 0],
      [0, 1, 0, -1, 0],
      [0, 0, 1, 1, 0],
      [0, 0, 0, 1, 1],
      [-1, 0, 0, 0, 1],
    ],
    initial: [1, 6, 4, 1, 6],
  },
  {
    id: 'hard',
    label: 'Hard · 7 plates, dense links, pins starting on both edges',
    n: 7,
    coupling: [
      [1, 1, 0, 0, 0, 0, -1],
      [-1, 1, 1, 0, 0, 0, 0],
      [0, 0, 1, -1, 0, 1, 0],
      [0, 1, 0, 1, 1, 0, 0],
      [0, 0, 0, 0, 1, -1, 1],
      [0, 0, -1, 0, 0, 1, 0],
      [1, 0, 0, 0, -1, 0, 1],
    ],
    initial: [2, 4, 4, 5, 4, 5, 7],
  },
];

// Extra fixtures for exploratory scenarios — not part of the easy/medium/hard set.
export const EXPLORE_LOCKS = [
  {
    // Triggers the tier-2 "edge-clear plan" guidance: mid-mapping, no safe probe
    // exists and the app must propose a sequence of already-mapped moves.
    id: 'plan4',
    label: 'Plan-path · 4 plates, forces an edge-clear plan',
    n: 4,
    coupling: [
      [1, -1, 0, 0],
      [1, 1, -1, 0],
      [-1, 0, 1, 0],
      [-1, -1, -1, 1],
    ],
    initial: [6, 3, 6, 3],
  },
  {
    // The pick-breaker: four plates start on the edges and the couplings are
    // hostile, so probing racks up mistakes (blocked presses), breaks picks
    // (2nd mistake → slides snap back to start), and the only way through is to
    // reposition already-mapped slides off their initial spots between probes.
    // Found by search (e2e/find-trap.js); verified to need ≥2 mistakes, ≥1
    // break, and ≥1 reposition even for a truthful, sensible player.
    id: 'trap',
    label: 'Trap · 5 plates, forces mistakes, pick breaks, and repositioning',
    n: 5,
    coupling: [
      [1, 0, 0, -1, 1],
      [1, 1, 1, 1, 0],
      [0, -1, 1, 0, 0],
      [0, 0, 0, 1, -1],
      [0, 0, 0, 0, 1],
    ],
    initial: [3, 7, 1, 1, 1],
  },
];
