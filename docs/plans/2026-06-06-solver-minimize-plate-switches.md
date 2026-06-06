# Solver: Minimize Plate Switches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the solver return, among all shortest (fewest-moves) edge-free plans, one with the fewest plate switches — so the player re-selects plates as rarely as possible without ever lengthening the solution.

**Architecture:** Replace the FIFO BFS in `src/solver.js` with a heap-based uniform-cost search. State is `(positionKey, lastPlate)`; path cost is the pair `[moves, switches]` compared lexicographically (moves primary, switches secondary). A new tiny `src/heap.js` provides the binary min-heap frontier. `applyMove`/`legalMoves`/`isSolved` from `src/model.js` are reused unchanged. No UI changes — the walkthrough renders whatever `solve()` returns.

**Tech Stack:** Vanilla ES modules, no build step. Tests via `node --test` (node:test + node:assert/strict).

**Spec:** `docs/specs/2026-06-06-solver-minimize-plate-switches-design.md`

---

## File Structure

- **Create** `src/heap.js` — generic binary min-heap (`MinHeap`) ordered by a caller-supplied `less(a, b)` comparator. No domain knowledge.
- **Create** `test/heap.test.js` — unit tests for `MinHeap`.
- **Modify** `src/solver.js` — rewrite `solve()` as uniform-cost search; add exported `countSwitches(moves)` helper.
- **Modify** `test/solver.test.js` — keep existing tests (regression guard); add switch-count, edge-safety sweep, move-count parity, and switch-reduction tests.
- **Modify** `docs/notes/solver-optimality.md` — one paragraph noting the `lastPlate` state factor and the raised node cap.
- **Modify** `src/ui/app.js` — add a user-facing line to the `CHANGELOG` array (the only change to this file; no logic touched).

---

## Task 1: Binary min-heap module

**Files:**
- Create: `src/heap.js`
- Test: `test/heap.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/heap.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MinHeap } from '../src/heap.js';

test('pops numbers in ascending order with a numeric comparator', () => {
  const h = new MinHeap((a, b) => a < b);
  for (const x of [5, 1, 4, 2, 8, 3, 7, 6]) h.push(x);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('honors a custom lexicographic comparator on pairs', () => {
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const h = new MinHeap(less);
  for (const x of [[2, 0], [1, 9], [1, 1], [2, -1], [0, 5]]) h.push(x);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, [[0, 5], [1, 1], [1, 9], [2, -1], [2, 0]]);
});

test('size tracks pushes and pops; interleaving preserves order', () => {
  const h = new MinHeap((a, b) => a < b);
  h.push(3); h.push(1);
  assert.equal(h.size, 2);
  assert.equal(h.pop(), 1);
  h.push(2); h.push(0);
  assert.equal(h.size, 3);
  assert.equal(h.pop(), 0);
  assert.equal(h.pop(), 2);
  assert.equal(h.pop(), 3);
  assert.equal(h.size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/heap.test.js`
Expected: FAIL — `Cannot find module '../src/heap.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/heap.js`:

```js
// Minimal binary min-heap. `less(a, b)` returns true when `a` should come out before `b`.
export class MinHeap {
  constructor(less) {
    this.less = less;
    this.h = [];
  }

  get size() {
    return this.h.length;
  }

  push(x) {
    const h = this.h;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  pop() {
    const h = this.h;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < n && this.less(h[l], h[m])) m = l;
        if (r < n && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/heap.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/heap.js test/heap.test.js
git commit -m "feat(solver): add binary min-heap helper"
```

---

## Task 2: `countSwitches` helper

**Files:**
- Modify: `src/solver.js`
- Test: `test/solver.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/solver.test.js` — first update the import at the top of the file from:

```js
import { solve } from '../src/solver.js';
```

to:

```js
import { solve, countSwitches } from '../src/solver.js';
```

Then append these tests:

```js
test('countSwitches: empty and single-move plans have zero switches', () => {
  assert.equal(countSwitches([]), 0);
  assert.equal(countSwitches([{ plate: 0, dir: 'L' }]), 0);
});

test('countSwitches: consecutive moves on the same plate add no switches', () => {
  const moves = [
    { plate: 1, dir: 'L' },
    { plate: 1, dir: 'L' },
    { plate: 1, dir: 'R' },
  ];
  assert.equal(countSwitches(moves), 0);
});

test('countSwitches: each change of plate counts once', () => {
  const moves = [
    { plate: 0, dir: 'L' }, // first move: 0
    { plate: 1, dir: 'L' }, // 0 -> 1 : +1
    { plate: 1, dir: 'R' }, // same   : +0
    { plate: 0, dir: 'L' }, // 1 -> 0 : +1
  ];
  assert.equal(countSwitches(moves), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/solver.test.js`
Expected: FAIL — `countSwitches` is not exported (import resolves to `undefined`, call throws / assertion fails).

- [ ] **Step 3: Write minimal implementation**

In `src/solver.js`, add this exported function (place it directly under the import line at the top):

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/solver.test.js`
Expected: PASS — existing solver tests plus the 3 new `countSwitches` tests.

- [ ] **Step 5: Commit**

```bash
git add src/solver.js test/solver.test.js
git commit -m "feat(solver): add countSwitches helper"
```

---

## Task 3: Rewrite `solve()` as uniform-cost search

**Files:**
- Modify: `src/solver.js`
- Modify: `docs/notes/solver-optimality.md`
- Test: `test/solver.test.js` (existing tests are the regression guard — no new tests in this task)

- [ ] **Step 1: Confirm the existing regression tests currently pass**

Run: `node --test test/solver.test.js`
Expected: PASS. These tests (shortest-length assertions, replay-in-bounds, null-on-unsolvable) must remain green after the rewrite because move count stays optimal.

- [ ] **Step 2: Replace the solver body**

Replace the entire contents of `src/solver.js` with the following. (Keep the `countSwitches` function added in Task 2 — it is included below so the final file is complete.)

```js
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

// true when pair `a` is lexicographically less than pair `b` ([moves, switches]).
function lt(a, b) {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

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
  const best = new Map([[startKey, [0, 0]]]); // stateKey -> [moves, switches]
  const parent = new Map(); // stateKey -> { prev: stateKey, move }
  const open = new MinHeap((a, b) =>
    a.moves < b.moves || (a.moves === b.moves && a.switches < b.switches),
  );
  open.push({ pos: start, last: null, moves: 0, switches: 0, key: startKey });
  let count = 0;

  while (open.size) {
    const cur = open.pop();
    // Skip stale heap entries: a strictly better cost for this state was recorded
    // after this entry was pushed.
    if (lt(best.get(cur.key), [cur.moves, cur.switches])) continue;
    if (isSolved(cur.pos)) return reconstruct(parent, cur.key, startKey);

    for (const mv of legalMoves(cur.pos, coupling)) {
      const np = applyMove(cur.pos, coupling, mv.plate, mv.dir);
      const nMoves = cur.moves + 1;
      const nSw = cur.switches + (cur.last !== null && mv.plate !== cur.last ? 1 : 0);
      const nKey = np.join(',') + '|' + mv.plate;
      const prev = best.get(nKey);
      if (!prev || lt([nMoves, nSw], prev)) {
        best.set(nKey, [nMoves, nSw]);
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
```

- [ ] **Step 3: Run the existing tests to verify they still pass**

Run: `node --test test/solver.test.js`
Expected: PASS — all existing tests plus the Task 2 `countSwitches` tests. In particular:
- `two independent plates: shortest path reaches all-4 in bounds` still asserts `moves.length === 3`.
- `single uncoupled plate needs two Left moves from 2 to 4` still asserts `moves.length === 2`.
- both null cases still return `null`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — heap tests and solver tests all green.

- [ ] **Step 5: Update the optimality note**

In `docs/notes/solver-optimality.md`, add this paragraph at the end of the "The caveat" section (immediately before the "## Option A" heading):

```markdown
**Update (2026-06-06):** the solver now also minimizes plate switches among shortest
plans (`docs/specs/2026-06-06-solver-minimize-plate-switches-design.md`). To do that the
search state gained a `lastPlate` component, multiplying the reachable state space by up
to `n+1`. The default node cap was raised to `8_000_000` so a worst-case 7-plate lock
(`7^7 × 8 ≈ 6.6M` states) still completes. Move-count optimality is unchanged — moves are
the primary cost; switches only break ties. The A* option below remains the recommended
way to lift the cap unconditionally for 8 plates, and composes cleanly: an admissible
heuristic would attach to the `moves` component without touching the switch logic.
```

- [ ] **Step 6: Commit**

```bash
git add src/solver.js docs/notes/solver-optimality.md
git commit -m "feat(solver): minimize plate switches among shortest plans"
```

---

## Task 4: Edge-safety, optimality, and switch-reduction tests

**Files:**
- Test: `test/solver.test.js`

This task adds the headline guarantee — produced plans never slide a plate past an edge — checked across many generated locks, plus proof that move count is unchanged and switches genuinely drop.

- [ ] **Step 1: Add the test helpers and a reference shortest-path BFS**

Append to `test/solver.test.js`. First add these imports to the existing `model.js` import at the top of the file. Change:

```js
import { applyMove, isSolved, MIN, MAX } from '../src/model.js';
```

to:

```js
import { applyMove, isSolved, legalMoves, MIN, MAX, GOAL } from '../src/model.js';
```

Then append the helpers:

```js
// Deterministic PRNG (mulberry32) so the generated sweep is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A valid lock coupling: n x n, diagonal = 1 (a plate moves itself by +1 on Left),
// off-diagonal cells in {-1, 0, 1} (moves-with / no-move / opposite).
function randomCoupling(n, rnd) {
  const m = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : [-1, 0, 1][Math.floor(rnd() * 3)]);
    m.push(row);
  }
  return m;
}

function randomStart(n, rnd) {
  return Array.from({ length: n }, () => MIN + Math.floor(rnd() * (MAX - MIN + 1)));
}

// Reference shortest-path BFS (one shortest plan, in BFS discovery order). Used as
// the baseline for both optimal length and a "naive" switch count to beat.
function bfsShortest(positions, coupling) {
  const start = positions.slice();
  if (isSolved(start)) return [];
  const startKey = start.join(',');
  const visited = new Set([startKey]);
  const parent = new Map();
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    for (const mv of legalMoves(pos, coupling)) {
      const np = applyMove(pos, coupling, mv.plate, mv.dir);
      const nk = np.join(',');
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, { prev: pos.join(','), move: mv });
      if (isSolved(np)) {
        const out = [];
        let k = nk;
        while (k !== startKey) {
          const { prev, move } = parent.get(k);
          out.push(move);
          k = prev;
        }
        return out.reverse();
      }
      queue.push(np);
    }
  }
  return null;
}
```

- [ ] **Step 2: Run to confirm the file still loads and passes**

Run: `node --test test/solver.test.js`
Expected: PASS — adding unused helpers and imports must not break existing tests. (`GOAL`/`legalMoves` are now imported and used by helpers.)

- [ ] **Step 3: Add the generated-sweep test (edge safety + move-count parity + no worse switches)**

Append to `test/solver.test.js`:

```js
test('generated sweep: plans stay in bounds, match optimal length, never increase switches', () => {
  const cases = [];
  // Exhaustive small case: n = 2, all 9 off-diagonal couplings, all 49 starts.
  for (const c01 of [-1, 0, 1]) {
    for (const c10 of [-1, 0, 1]) {
      const coupling = [[1, c01], [c10, 1]];
      for (let a = MIN; a <= MAX; a++) {
        for (let b = MIN; b <= MAX; b++) cases.push({ coupling, start: [a, b] });
      }
    }
  }
  // Seeded random sweep for n = 3..5.
  const rnd = mulberry32(0xC0FFEE);
  for (let i = 0; i < 600; i++) {
    const n = 3 + (i % 3); // 3, 4, 5
    cases.push({ coupling: randomCoupling(n, rnd), start: randomStart(n, rnd) });
  }

  let solvedCount = 0;
  for (const { coupling, start } of cases) {
    const plan = solve(start, coupling);
    const ref = bfsShortest(start, coupling);

    // Solvability must agree with the reference BFS.
    assert.equal(plan === null, ref === null, `solvability mismatch for ${start} / ${JSON.stringify(coupling)}`);
    if (plan === null) continue;
    solvedCount++;

    // Edge safety: replay every step, assert it never leaves 1..7. (Headline guarantee.)
    let p = start.slice();
    for (const mv of plan) {
      p = applyMove(p, coupling, mv.plate, mv.dir);
      assert.ok(
        p.every((v) => v >= MIN && v <= MAX),
        `step left bounds: ${p} for start ${start} / ${JSON.stringify(coupling)}`,
      );
    }
    // ...and actually solves the lock.
    assert.ok(isSolved(p), `plan did not solve ${start} / ${JSON.stringify(coupling)}`);

    // Move-count optimality preserved: same length as the reference shortest path.
    assert.equal(plan.length, ref.length, `length regressed for ${start} / ${JSON.stringify(coupling)}`);

    // Switches never worse than the naive shortest path.
    assert.ok(
      countSwitches(plan) <= countSwitches(ref),
      `switches not improved for ${start} / ${JSON.stringify(coupling)}: ${countSwitches(plan)} > ${countSwitches(ref)}`,
    );
  }

  assert.ok(solvedCount > 100, `expected many solvable cases, got ${solvedCount}`);
});
```

- [ ] **Step 4: Run to verify the sweep passes**

Run: `node --test test/solver.test.js`
Expected: PASS. If any case fails, the assertion message prints the offending start/coupling for debugging.

- [ ] **Step 5: Add a constructed case proving switches strictly drop**

Append to `test/solver.test.js`:

```js
test('constructed case: optimizer strictly reduces plate switches vs naive BFS', () => {
  // Three independent plates each two steps from center. The minimal plan is six
  // moves; grouping each plate's two moves yields only 2 switches, while a naive
  // interleaving BFS tends to switch far more often. We assert the optimizer is
  // strictly better than the reference here, and at the theoretical minimum.
  const coupling = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const start = [2, 2, 2]; // each needs +2 (two Left moves)

  const plan = solve(start, coupling);
  const ref = bfsShortest(start, coupling);

  // Sanity: both shortest, both solve, optimizer stays in bounds.
  assert.equal(plan.length, 6);
  assert.equal(ref.length, 6);
  assert.ok(isSolved(replay(start, coupling, plan)));

  // Each of the 3 plates moved as one contiguous run => exactly 2 switches.
  assert.equal(countSwitches(plan), 2);
  // And that is strictly fewer than the naive BFS ordering.
  assert.ok(
    countSwitches(plan) < countSwitches(ref),
    `expected strict improvement; plan=${countSwitches(plan)} ref=${countSwitches(ref)}`,
  );
});
```

- [ ] **Step 6: Run the constructed-case test**

Run: `node --test test/solver.test.js`
Expected: PASS. (If `countSwitches(ref)` happens to equal 2, the strict-improvement assertion would fail — but BFS on this lock interleaves plates and produces more than 2 switches, so it passes. If a future BFS change made them equal, swap to a lock with more plates/offset to restore strict inequality.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — `test/heap.test.js` and `test/solver.test.js` all green.

- [ ] **Step 8: Add the user-facing changelog entry**

In `src/ui/app.js`, add a new item to the top (newest) entry of the `CHANGELOG` array — the `date: '2026-06-06'` block. Change:

```js
  {
    date: '2026-06-06',
    items: [
      'Record chest contents — keep a loot list alongside each saved lock.',
      'Import and export saved locks, to back them up or move them between devices.',
    ],
  },
```

to:

```js
  {
    date: '2026-06-06',
    items: [
      'Solver now groups moves by plate where it can, so you re-select plates less often — same shortest, edge-free solution.',
      'Record chest contents — keep a loot list alongside each saved lock.',
      'Import and export saved locks, to back them up or move them between devices.',
    ],
  },
```

- [ ] **Step 9: Verify the changelog edit didn't break parsing**

Run: `node --check src/ui/app.js`
Expected: no output (exit 0) — file is still valid JS.

- [ ] **Step 10: Commit**

```bash
git add test/solver.test.js src/ui/app.js
git commit -m "test(solver): edge-safety sweep + switch-reduction coverage; changelog"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Objective (moves-first/switches-second) → Task 3 cost function. Switch definition → Task 2. Uniform-cost + heap + lastPlate state → Tasks 1 & 3. Edge-safety testing (headline) → Task 4 Step 3. Move-count parity → Task 4 Step 3. Switches reduced → Task 4 Steps 3 & 5. Unsolvable returns null → existing tests (regression guard) + Task 4 solvability-agreement assertion. A*/cap relationship → Task 3 Step 5 note update.
- **No silent caps:** the node cap was raised to `8_000_000` and documented; this is a deliberate, recorded change, not a hidden truncation.
- **Type consistency:** moves are `{ plate, dir }` throughout; `countSwitches(moves)` and `solve(...)` signatures match the existing call site in `src/ui/app.js` (`solve(state.positions, state.mapping.coupling)`), which is unchanged.
- **No UI logic work:** `src/ui/app.js` consumes the same `move[]` shape; the only edit is a `CHANGELOG` line (Task 4 Step 8), folded into the final commit per the user's request.
