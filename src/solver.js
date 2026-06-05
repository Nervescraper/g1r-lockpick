import { applyMove, isSolved, legalMoves } from './model.js';

// Breadth-first search over position vectors. Every expanded move is legal
// (in-bounds), so any returned path is edge-free. Returns move[] or null.
export function solve(positions, coupling, { maxNodes = 2_000_000 } = {}) {
  const start = positions.slice();
  if (isSolved(start)) return [];

  const startKey = start.join(',');
  const visited = new Set([startKey]);
  const parent = new Map(); // key -> { prev: key, move }
  const queue = [start];
  let head = 0;
  let count = 0;

  while (head < queue.length) {
    const pos = queue[head++];
    for (const mv of legalMoves(pos, coupling)) {
      const np = applyMove(pos, coupling, mv.plate, mv.dir);
      const nk = np.join(',');
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, { prev: pos.join(','), move: mv });
      if (isSolved(np)) return reconstruct(parent, nk, startKey);
      queue.push(np);
      if (++count > maxNodes) return null;
    }
  }
  return null;
}

function reconstruct(parent, goalKey, startKey) {
  const moves = [];
  let k = goalKey;
  while (k !== startKey) {
    const { prev, move } = parent.get(k);
    moves.push(move);
    k = prev;
  }
  return moves.reverse();
}
