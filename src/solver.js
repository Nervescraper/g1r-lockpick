import { applyMove, isSolved, legalMoves, GOAL } from './model.js';
import { MinHeap } from './heap.js';
import { transpose, det, adjugate, matVec } from './linalg.js';

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

// Lexicographic order on true cost: fewer moves first, then fewer switches.
const cheaper = (a, b) =>
  a.moves < b.moves || (a.moves === b.moves && a.switches < b.switches);

// A* search over (position, lastPlate) states. Primary key is f = moves + h(pos),
// secondary key is switches, so the result is the shortest plan and, among those,
// the one with the fewest plate switches — identical answers to a plain uniform-cost
// search, but expanding far fewer states.
//
// h(pos) = ‖x(pos)‖₁ where x = C⁻ᵀ(goal − pos) is the unique net-move vector (each
// move changes exactly one component of x by 1, so this is an admissible, consistent
// lower bound on remaining moves). It is computed in exact integers via the adjugate.
// When C is singular, h ≡ 0 and the search degrades to plain Dijkstra (still correct).
//
// Integer-feasibility precheck: when C is invertible, a solvable lock has an integer
// x; if x(start) is non-integer the lock is unsolvable and we return null with no search.
//
// Every expanded move is legal (in-bounds), so any returned path is edge-free.
// Returns move[] or null.
export function solve(positions, coupling, { maxNodes = 8_000_000 } = {}) {
  const start = positions.slice();
  if (isSolved(start)) return [];

  const n = start.length;
  const goal = Array(n).fill(GOAL);
  const A = transpose(coupling); // Cᵀ x = goal − pos
  const dt = det(A); // = det(coupling)
  const adj = dt !== 0 ? adjugate(A) : null;
  const sub = (a, b) => a.map((v, i) => v - b[i]);

  // Precheck: non-integer net moves ⇒ unsolvable (only when invertible).
  if (adj) {
    const numer0 = matVec(adj, sub(goal, start));
    if (numer0.some((v) => v % dt !== 0)) return null;
  }

  // Heuristic. The precheck guarantees x(start) is integer, and every legal move keeps
  // x integer, so on all reachable states Σ|numer| is divisible by |dt|: the divide is
  // exact and Math.round only normalizes float representation.
  const absDt = Math.abs(dt);
  const heuristic = adj
    ? (pos) => {
        const numer = matVec(adj, sub(goal, pos));
        let s = 0;
        for (const v of numer) s += Math.abs(v);
        return Math.round(s / absDt);
      }
    : () => 0;

  const startKey = start.join(',') + '|'; // lastPlate = none
  // best/parent grow to O(count) ≈ explored states; with the heuristic this is far
  // smaller than the full state space for realistic locks.
  const best = new Map([[startKey, { moves: 0, switches: 0 }]]); // stateKey -> { moves, switches }
  const parent = new Map(); // stateKey -> { prev: stateKey, move }
  // Heap orders by [f = moves + h, switches]; bookkeeping below uses true cost.
  const open = new MinHeap((a, b) => a.f < b.f || (a.f === b.f && a.switches < b.switches));
  open.push({ pos: start, last: null, moves: 0, switches: 0, f: heuristic(start), key: startKey });
  let count = 0;

  while (open.size) {
    const cur = open.pop();
    // Skip stale heap entries: a strictly better TRUE cost for this state was recorded
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
        open.push({ pos: np, last: mv.plate, moves: nMoves, switches: nSw, f: nMoves + heuristic(np), key: nKey });
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
