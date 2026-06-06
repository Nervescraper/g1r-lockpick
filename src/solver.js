import { applyMove, isSolved, legalMoves } from './model.js';
import { MinHeap } from './heap.js';

// Number of times the plan changes which plate is being slid. The first move is
// the unavoidable initial selection and costs nothing; each later move on a
// different plate than its predecessor counts as one switch.
export function countSwitches(moves) {
  let s = 0;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].plate !== moves[i - 1].plate) s++;
  }
  return s;
}

// Lexicographic order on cost: fewer moves first, then fewer switches.
const cheaper = (a, b) =>
  a.moves < b.moves || (a.moves === b.moves && a.switches < b.switches);

// Uniform-cost (Dijkstra) search over (position, lastPlate) states. The path cost
// is the pair [moves, switches], compared lexicographically: move count is primary
// (so the result is always a shortest plan, exactly as the old BFS), switch count
// is the tie-breaker (so among shortest plans we return one that re-selects plates
// as rarely as possible). Every expanded move is legal (in-bounds), so any returned
// path is edge-free. Returns move[] or null.
//
// State carries lastPlate because a move's switch cost depends on the previous
// plate; this multiplies the state space by up to n+1 versus the old BFS, hence
// the larger default node cap (see docs/notes/solver-optimality.md).
export function solve(positions, coupling, { maxNodes = 8_000_000 } = {}) {
  const start = positions.slice();
  if (isSolved(start)) return [];

  const startKey = start.join(',') + '|'; // lastPlate = none
  // best/parent grow to O(count) ≈ maxNodes entries in the worst case, each keyed
  // by a long position string — the dominant memory cost when tuning maxNodes.
  const best = new Map([[startKey, { moves: 0, switches: 0 }]]); // stateKey -> { moves, switches }
  const parent = new Map(); // stateKey -> { prev: stateKey, move }
  const open = new MinHeap(cheaper);
  open.push({ pos: start, last: null, moves: 0, switches: 0, key: startKey });
  let count = 0;

  while (open.size) {
    const cur = open.pop();
    // Skip stale heap entries: a strictly better cost for this state was recorded
    // after this entry was pushed.
    if (cheaper(best.get(cur.key), cur)) continue;
    if (isSolved(cur.pos)) return reconstruct(parent, cur.key, startKey);

    for (const mv of legalMoves(cur.pos, coupling)) {
      const np = applyMove(cur.pos, coupling, mv.plate, mv.dir);
      const nMoves = cur.moves + 1;
      const nSw = cur.switches + (cur.last !== null && mv.plate !== cur.last ? 1 : 0);
      const nKey = np.join(',') + '|' + mv.plate;
      const prev = best.get(nKey);
      if (!prev || cheaper({ moves: nMoves, switches: nSw }, prev)) {
        best.set(nKey, { moves: nMoves, switches: nSw });
        parent.set(nKey, { prev: cur.key, move: mv });
        open.push({ pos: np, last: mv.plate, moves: nMoves, switches: nSw, key: nKey });
        if (++count > maxNodes) return null;
      }
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
