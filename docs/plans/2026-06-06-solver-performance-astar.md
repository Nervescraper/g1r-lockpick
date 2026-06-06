# Solver Performance: A\* + Integer Precheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the solver fast and memory-light on all locks — instant on unsolvable/incomplete mappings, milliseconds on deep/uncoupled locks — while returning byte-for-byte the same optimal (shortest, fewest-switch) plans.

**Architecture:** Add an exact-integer linear-algebra module (`src/linalg.js`). Use it in `solve()` for (a) an integer-feasibility precheck that rejects unsolvable invertible locks with no search, and (b) an admissible+consistent A\* heuristic `h(pos)=‖C⁻ᵀ(goal−pos)‖₁` that replaces the move-count primary key in the existing `(position, lastPlate)` uniform-cost search. Singular couplings fall back to `h≡0` (today's exact Dijkstra). The `maxNodes` cap stays as a backstop.

**Tech Stack:** Vanilla ES modules, no build step, no deps. Tests via `node --test` (`node:test` + `node:assert/strict`).

**Spec:** `docs/specs/2026-06-06-solver-performance-astar-design.md`

---

## File Structure

- **Create** `src/linalg.js` — pure exact-integer matrix helpers: `transpose`, `matVec`, `det` (Bareiss), `adjugate`. No DOM, no solver knowledge.
- **Create** `test/linalg.test.js` — unit tests for the linear algebra.
- **Modify** `src/solver.js` — add precheck + A\* heuristic via linalg; singular fallback; reuse `MinHeap`. Public signature and `move[] | null` contract unchanged.
- **Modify** `test/solver.test.js` — add optimality-equivalence coverage (true-min switches at n=3/4) and deterministic performance-regression guards.
- **Modify** `docs/notes/solver-optimality.md` — record that A\* + integer precheck is implemented, superseding the future-work recommendation.
- **Modify** `src/ui/app.js` — one user-facing changelog line (CHANGELOG only).

---

## Background for the implementer

A move on plate `i` adds `±coupling[i]` (row `i` of the coupling matrix `C`) to the position
vector. The net effect of a whole plan is `xᵀC` where `x_i` is the net signed moves on plate
`i`. To reach the goal, `xᵀC = goal − start`, i.e. `Cᵀ x = (goal − start)`. So with `A = Cᵀ`:

- `x = A⁻¹ (goal − start)`. Using the adjugate, `A⁻¹ = adj(A)/det(A)`, so
  `x = adj(A)·(goal − start) / det(A)` — computable in **exact integers** (numerator) plus one
  divisor `det(A)`.
- A solvable lock has integer `x`; if any component isn't integer, it's **unsolvable**.
- `h(pos) = ‖x(pos)‖₁ = (Σ_i |adj(A)·(goal − pos)|_i) / |det(A)|` is an admissible, consistent
  A\* heuristic.

`adj(A)` and `det(A)` are computed **once** per solve; then each node's heuristic is one
matrix-vector product.

---

## Task 1: Linear-algebra primitives — `transpose`, `matVec`, `det`

**Files:**
- Create: `src/linalg.js`
- Test: `test/linalg.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/linalg.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { transpose, matVec, det } from '../src/linalg.js';

test('transpose flips rows and columns', () => {
  assert.deepEqual(transpose([[1, 2], [3, 4]]), [[1, 3], [2, 4]]);
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
});

test('matVec multiplies a matrix by a column vector', () => {
  assert.deepEqual(matVec([[1, 2], [3, 4]], [5, 6]), [17, 39]);
  assert.deepEqual(matVec([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [7, 8, 9]), [7, 8, 9]);
});

test('det of 1x1 and 2x2', () => {
  assert.equal(det([[5]]), 5);
  assert.equal(det([[1, 2], [3, 4]]), -2);
  assert.equal(det([[2, 0], [0, 3]]), 6);
});

test('det is 0 for a singular matrix', () => {
  assert.equal(det([[1, 2], [2, 4]]), 0);
  assert.equal(det([[0, 1], [0, 1]]), 0);
});

test('det handles a leading-zero pivot via row swap', () => {
  assert.equal(det([[0, 1], [1, 0]]), -1);
});

test('det of a 3x3 with mixed entries (exact integer)', () => {
  // det([[2,-1,0],[-1,2,-1],[0,-1,2]]) = 4
  assert.equal(det([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]), 4);
  assert.equal(det([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), 1);
});

test('det does not mutate its input', () => {
  const m = [[1, 2], [3, 4]];
  det(m);
  assert.deepEqual(m, [[1, 2], [3, 4]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/linalg.test.js`
Expected: FAIL — `Cannot find module '../src/linalg.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/linalg.js`:

```js
// Exact-integer matrix helpers for the solver. Inputs are small square integer
// matrices (n <= 8, entries are coupling values), so all intermediate values stay
// within JS safe integers and no floating point is involved.

// Transpose any (possibly rectangular) matrix.
export function transpose(M) {
  const rows = M.length;
  const cols = M[0].length;
  const out = Array.from({ length: cols }, () => Array(rows));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[j][i] = M[i][j];
  }
  return out;
}

// Matrix times column vector.
export function matVec(M, v) {
  return M.map((row) => row.reduce((s, m, j) => s + m * v[j], 0));
}

// Integer determinant via the Bareiss (fraction-free) algorithm. Every division is
// exact, so the result is an exact integer. Returns 0 for a singular matrix.
// Does not mutate the input.
export function det(A) {
  const n = A.length;
  const M = A.map((r) => r.slice());
  let sign = 1;
  let prev = 1;
  for (let k = 0; k < n - 1; k++) {
    if (M[k][k] === 0) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) {
        if (M[i][k] !== 0) { swap = i; break; }
      }
      if (swap === -1) return 0; // singular
      [M[k], M[swap]] = [M[swap], M[k]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        M[i][j] = (M[i][j] * M[k][k] - M[i][k] * M[k][j]) / prev;
      }
      M[i][k] = 0;
    }
    prev = M[k][k];
  }
  return sign * M[n - 1][n - 1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/linalg.test.js`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/linalg.js test/linalg.test.js
git commit -m "feat(solver): exact-integer transpose/matVec/det helpers"
```

---

## Task 2: `adjugate`

**Files:**
- Modify: `src/linalg.js`
- Test: `test/linalg.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/linalg.test.js`. First update the import line at the top from:

```js
import { transpose, matVec, det } from '../src/linalg.js';
```

to:

```js
import { transpose, matVec, det, adjugate } from '../src/linalg.js';
```

Then append:

```js
test('adjugate of a 1x1 is [[1]]', () => {
  assert.deepEqual(adjugate([[5]]), [[1]]);
});

test('adjugate of a 2x2 matches the classic formula', () => {
  assert.deepEqual(adjugate([[1, 2], [3, 4]]), [[4, -2], [-3, 1]]);
});

test('adjugate of the identity is the identity', () => {
  assert.deepEqual(adjugate([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

// The defining property: A * adj(A) = det(A) * I, for several integer matrices.
test('A * adj(A) equals det(A) * I', () => {
  const mats = [
    [[2, -1, 0], [-1, 2, -1], [0, -1, 2]],
    [[1, 1, 0], [0, 1, 1], [1, 0, 1]],
    [[1, -1, 0, 0], [0, 1, -1, 0], [0, 0, 1, -1], [0, 0, 0, 1]],
  ];
  for (const A of mats) {
    const n = A.length;
    const adj = adjugate(A);
    const d = det(A);
    // product P = A * adj
    const P = A.map((row, i) =>
      adj[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * adj[k][j], 0)),
    );
    const expected = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? d : 0)),
    );
    assert.deepEqual(P, expected);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/linalg.test.js`
Expected: FAIL — `adjugate` is not exported (import is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Add to `src/linalg.js` (after `det`):

```js
// The minor of A with `row` and `col` removed.
function minor(A, row, col) {
  const out = [];
  for (let i = 0; i < A.length; i++) {
    if (i === row) continue;
    const r = [];
    for (let j = 0; j < A.length; j++) {
      if (j === col) continue;
      r.push(A[i][j]);
    }
    out.push(r);
  }
  return out;
}

// Classical adjoint (adjugate): the transpose of the cofactor matrix, so that
// A * adjugate(A) = det(A) * I. Exact integers. n >= 1.
export function adjugate(A) {
  const n = A.length;
  if (n === 1) return [[1]];
  const adj = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cofactor = ((i + j) % 2 === 0 ? 1 : -1) * det(minor(A, i, j));
      adj[j][i] = cofactor; // transpose: cofactor of (i,j) goes to adj[j][i]
    }
  }
  return adj;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/linalg.test.js`
Expected: PASS — all tests (Task 1 + the 4 new adjugate tests).

- [ ] **Step 5: Commit**

```bash
git add src/linalg.js test/linalg.test.js
git commit -m "feat(solver): exact-integer adjugate"
```

---

## Task 3: A\* heuristic + integer precheck in `solve()`

**Files:**
- Modify: `src/solver.js`
- Test: `test/solver.test.js` (existing tests are the regression guard — no new tests in this task)

- [ ] **Step 1: Confirm the existing solver tests pass**

Run: `node --test test/solver.test.js`
Expected: PASS (all current solver tests). They are the regression guard: the new solver must return identical lengths, identical switch counts, and identical solvability.

- [ ] **Step 2: Replace the solver body**

Replace the ENTIRE contents of `src/solver.js` with:

```js
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

  // Heuristic. On every reachable state x is integer, so Σ|numer| is divisible by |dt|.
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
```

- [ ] **Step 3: Run the existing solver tests**

Run: `node --test test/solver.test.js`
Expected: PASS — every existing test, unchanged. In particular: the exact-length tests (2 and 3), the generated sweep (lengths match `bfsShortest`, switches `<=` ref, edge-safe), the n=2 true-min-switch oracle, the constructed switch-reduction case, and both null cases (`[[0]]` and `[[0,1],[0,1]]` are singular ⇒ `h≡0` fallback ⇒ still return `null`).

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — linalg, heap, and solver tests all green.

- [ ] **Step 5: Commit**

```bash
git add src/solver.js
git commit -m "feat(solver): A* heuristic + integer-feasibility precheck"
```

---

## Task 4: Equivalence + performance-regression tests, docs, changelog

**Files:**
- Test: `test/solver.test.js`
- Modify: `docs/notes/solver-optimality.md`
- Modify: `src/ui/app.js`

- [ ] **Step 1: Add true-min-switch equivalence at n=3 and n=4**

The file already has a seeded `mulberry32`, `randomCoupling`, `randomStart`, and the
`optimalPlan` DP oracle (true minimum switches among shortest plans). Append a test that
extends the strongest guarantee — that `solve` returns the true optimum — to larger locks:

```js
test('n=3 and n=4 sampled: solver hits true-minimum switches (independent DP oracle)', () => {
  const rnd = mulberry32(0xD00D);
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const n = 3 + (i % 2); // 3 or 4
    const coupling = randomCoupling(n, rnd);
    const start = randomStart(n, rnd);
    const plan = solve(start, coupling);
    const opt = optimalPlan(start, coupling);
    assert.equal(plan === null, opt === null, `solvability mismatch for ${start} / ${JSON.stringify(coupling)}`);
    if (plan === null) continue;
    checked++;
    assert.equal(plan.length, opt.len, `length not optimal for ${start} / ${JSON.stringify(coupling)}`);
    assert.equal(
      countSwitches(plan),
      opt.switches,
      `switches not optimal for ${start} / ${JSON.stringify(coupling)}: got ${countSwitches(plan)}, true min ${opt.switches}`,
    );
  }
  assert.ok(checked > 50, `expected many solvable cases, got ${checked}`);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/solver.test.js`
Expected: PASS. (If it fails, the A\* secondary-objective ordering is wrong — STOP and report, do not weaken the assertion.)

- [ ] **Step 3: Add the precheck + deep-lock performance guards**

Append:

```js
test('integer precheck rejects an unsolvable invertible lock', () => {
  // C = [[2,0],[0,1]] is invertible; from [1,4] toward [4,4] the net move on plate 0
  // is 3/2 (non-integer), so the lock is unsolvable and the precheck returns null.
  assert.equal(solve([1, 4], [[2, 0], [0, 1]]), null);
});

test('A* makes a deep uncoupled 7-plate lock solvable within the node cap', () => {
  // Identity coupling, all pins at 1: hand-solvable (each plate +3 -> 21 moves), but a
  // heuristic-less search exhausts the 8M cap and falsely returns null. With h exact
  // here, A* marches straight to the goal.
  const id7 = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => (i === j ? 1 : 0)));
  const start = [1, 1, 1, 1, 1, 1, 1];
  const plan = solve(start, id7);
  assert.ok(plan !== null, 'expected a plan; heuristic-less search would hit the cap and return null');
  assert.equal(plan.length, 21);
  assert.ok(isSolved(replay(start, id7, plan)));
});
```

- [ ] **Step 4: Run it**

Run: `node --test test/solver.test.js`
Expected: PASS. The deep-lock test should complete quickly (well under a second); if it hangs or returns null, the heuristic/precheck is wrong — STOP and report.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all green.

- [ ] **Step 6: Update the optimality note**

In `docs/notes/solver-optimality.md`, append this paragraph at the very end of the file:

```markdown
## Update (2026-06-06): A\* + integer precheck implemented

The recommendation above is now implemented (`docs/specs/2026-06-06-solver-performance-astar-design.md`),
with a **stronger heuristic** than the `max|pos−4|` originally sketched here. Using the
linearity of the lock (`xᵀC = goal − start`), the solver computes the exact net-move vector
`x = C⁻ᵀ(goal − pos)` via integer adjugate/determinant (`src/linalg.js`) and uses
`h(pos) = ‖x‖₁` — admissible, consistent, and *exact* for uncoupled/deep locks, which were
the slow cases. It also adds an **integer-feasibility precheck**: when `C` is invertible, a
non-integer `x(start)` proves the lock unsolvable, so incomplete/contradictory mappings
return `null` instantly instead of exhausting the space. Singular `C` falls back to `h≡0`
(plain Dijkstra). Measured: unsolvable 8-plate ~63 s → instant; deep uncoupled 7-plate
~25 s → milliseconds; normal coupled locks drop below the original BFS's memory. The
`maxNodes`/`Map` ceiling notes above still apply as a backstop for rare hard feasible locks.
```

- [ ] **Step 7: Add the user-facing changelog entry**

In `src/ui/app.js`, add a new item as the first item of the newest `CHANGELOG` block. Change:

```js
  {
    date: '2026-06-06',
    items: [
      'Solver now groups moves by plate where it can, so you re-select plates less often — same shortest, edge-free solution.',
```

to:

```js
  {
    date: '2026-06-06',
    items: [
      'Faster solving: complex locks solve near-instantly, and locks that can’t be solved (often an incomplete map) are flagged right away instead of after a long wait.',
      'Solver now groups moves by plate where it can, so you re-select plates less often — same shortest, edge-free solution.',
```

- [ ] **Step 8: Verify the changelog edit didn't break parsing**

Run: `node --check src/ui/app.js`
Expected: no output (exit 0).

- [ ] **Step 9: Run the full suite once more**

Run: `npm test`
Expected: PASS — all green.

- [ ] **Step 10: Commit**

```bash
git add test/solver.test.js docs/notes/solver-optimality.md src/ui/app.js
git commit -m "test(solver): A* equivalence + perf guards; docs + changelog"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** integer precheck → Task 3 Step 2 (`numer0.some(... % dt)`), tested Task 4 Step 3. A\* heuristic → Task 3 (`heuristic`, `f = moves + h`), correctness tested by Task 4 Step 1 (true-min oracle) + existing sweep. Exact linear algebra → Tasks 1–2. Singular fallback → Task 3 (`adj ? ... : () => 0`), covered by the existing `[[0]]`/`[[0,1],[0,1]]` null tests. Differential equivalence → existing length/oracle tests now exercising the new solver + Task 4 Step 1. Perf guards → Task 4 Step 3. Docs/changelog → Task 4 Steps 6–7.
- **Type consistency:** moves are `{ plate, dir }`; `solve(positions, coupling, { maxNodes })` → `move[] | null` unchanged (call site `src/ui/app.js` `solve(state.positions, state.mapping.coupling)` untouched). linalg functions take/return plain number matrices/vectors.
- **Why the existing tests are a strong guard:** `bfsShortest` pins optimal length and `optimalPlan` pins true-minimum switches independently of `solve`'s internals, so any deviation introduced by A\* is caught without a frozen copy of the old solver.
- **No silent caps:** `maxNodes` unchanged at 8M; behavior on cap is still `null` (backstop), now rarely reached.
