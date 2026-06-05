# Lockpick Solver — Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-logic engine for the Gothic 1 Remake lockpick solver — the puzzle model, the safe-path solver, the risk-aware discovery logic, and persistence — fully unit-tested, with no UI and no dependencies.

**Architecture:** Plain ES modules of pure functions over plain data (position arrays + an N×N coupling matrix). The solver does a breadth-first search over legal positions to the all-4 goal, expanding only in-bounds moves so every solution is edge-free. Discovery builds the coupling matrix from observed shifts and recommends probes that won't break a lockpick. Storage is a thin `localStorage` wrapper that takes an injectable store so it's testable in Node.

**Tech Stack:** Vanilla JavaScript (ES modules), Node's built-in test runner (`node --test`) and `node:assert/strict`. No third-party dependencies, no build step.

**Design reference:** `docs/specs/2026-06-05-g1r-lockpick-solver-design.md`

---

## File Structure

- `package.json` — `"type": "module"`, `test` script. Marks the repo as ESM and enables `node --test`.
- `src/model.js` — puzzle primitives: constants, move deltas, `applyMove`, legality, `isSolved`, `legalMoves`.
- `src/solver.js` — `solve(positions, coupling)`: shortest edge-free move sequence to all-4, or `null`.
- `src/discovery.js` — mapping state, observation recording, probe-safety, probe recommendation, defer.
- `src/storage.js` — `localStorage`-backed save/load of locks and session, with an injectable store.
- `test/model.test.js`, `test/solver.test.js`, `test/discovery.test.js`, `test/storage.test.js`, `test/integration.test.js`.

### Shared data shapes (used across all tasks — keep names exact)

- **positions**: `number[]` of length N, each in `1..7`. Goal is every entry `=== 4`.
- **coupling**: `number[][]`, N rows × N cols, each cell in `{-1, 0, 1}`. `coupling[i][j]` is the effect on plate `j` of pressing **Left** on plate `i`. Pressing **Right** is the negation. Unknown cells are `0`.
- **move**: `{ plate: number, dir: 'L' | 'R' }`. `'L'` = Left (sign +1), `'R'` = Right (sign −1).
- **mapping**: `{ n: number, coupling: number[][], status: ('unstarted'|'partial'|'done')[] }`.
- **shifts** (one probe's observation): `{ [plateIndex: string]: 'L' | 'R' }` — only plates seen to move, with the direction they shifted (screen +1 = `'L'`).

---

## Task 0: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "g1r-lockpick",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Gothic 1 Remake Lockpick Solver

Web tool to map and solve the Gothic 1 Remake lockpicking puzzle.
See `docs/specs/2026-06-05-g1r-lockpick-solver-design.md`.

## Run the tests

    node --test

(Requires Node 18+; no dependencies to install.)
```

- [ ] **Step 3: Verify the test runner works (no tests yet)**

Run: `node --test`
Expected: exits 0 with a message that 0 tests ran (or "no test files found"). Either is fine.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: scaffold project for core engine"
```

---

## Task 1: Model — deltas and applyMove

**Files:**
- Create: `src/model.js`
- Test: `test/model.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirSign, moveDelta, applyMove } from '../src/model.js';

test('dirSign maps L to +1 and R to -1', () => {
  assert.equal(dirSign('L'), 1);
  assert.equal(dirSign('R'), -1);
});

test('moveDelta returns the coupling row for L and its negation for R', () => {
  const coupling = [[1, -1, 0]];
  assert.deepEqual(moveDelta(coupling, 0, 'L'), [1, -1, 0]);
  assert.deepEqual(moveDelta(coupling, 0, 'R'), [-1, 1, 0]);
});

test('applyMove adds the delta to positions without mutating input', () => {
  const coupling = [[1, 0], [0, 1]];
  const positions = [2, 2];
  assert.deepEqual(applyMove(positions, coupling, 0, 'L'), [3, 2]);
  assert.deepEqual(applyMove(positions, coupling, 1, 'R'), [2, 1]);
  assert.deepEqual(positions, [2, 2]); // unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/model.test.js`
Expected: FAIL — cannot import from `../src/model.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

```js
// src/model.js
export const MIN = 1;
export const MAX = 7;
export const GOAL = 4;

export function dirSign(dir) {
  return dir === 'L' ? 1 : -1;
}

export function moveDelta(coupling, plate, dir) {
  const s = dirSign(dir);
  // `+ 0` normalizes -0 (from -1 * 0) back to 0 so equality checks are clean
  return coupling[plate].map((v) => s * v + 0);
}

export function applyMove(positions, coupling, plate, dir) {
  const d = moveDelta(coupling, plate, dir);
  return positions.map((p, j) => p + d[j]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/model.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model.js test/model.test.js
git commit -m "feat(model): move deltas and applyMove"
```

---

## Task 2: Model — legality, solved check, legal moves

**Files:**
- Modify: `src/model.js`
- Test: `test/model.test.js`

- [ ] **Step 1: Add failing tests**

```js
// append to test/model.test.js
import { isLegal, isSolved, legalMoves } from '../src/model.js';

test('isLegal is false when any plate would leave 1..7', () => {
  assert.equal(isLegal([7], [[1]], 0, 'L'), false); // 7 -> 8
  assert.equal(isLegal([7], [[1]], 0, 'R'), true);  // 7 -> 6
  assert.equal(isLegal([1], [[1]], 0, 'R'), false); // 1 -> 0
});

test('isLegal accounts for coupled plates hitting an edge', () => {
  const coupling = [[1, 1]]; // L on plate 0 shifts both +1
  assert.equal(isLegal([3, 7], coupling, 0, 'L'), false); // plate 1: 7 -> 8
});

test('isSolved is true only when every pin is at 4', () => {
  assert.equal(isSolved([4, 4]), true);
  assert.equal(isSolved([4, 3]), false);
});

test('legalMoves lists only in-bounds plate/dir combos', () => {
  const coupling = [[1, 0], [0, 1]];
  const moves = legalMoves([1, 7], coupling);
  assert.deepEqual(moves, [
    { plate: 0, dir: 'L' }, // 1 -> 2 ok; R would be 1 -> 0
    { plate: 1, dir: 'R' }, // 7 -> 6 ok; L would be 7 -> 8
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/model.test.js`
Expected: FAIL — `isLegal`/`isSolved`/`legalMoves` are not exported.

- [ ] **Step 3: Add the implementation**

```js
// append to src/model.js
export function isLegal(positions, coupling, plate, dir) {
  const np = applyMove(positions, coupling, plate, dir);
  return np.every((v) => v >= MIN && v <= MAX);
}

export function isSolved(positions) {
  return positions.every((v) => v === GOAL);
}

export function legalMoves(positions, coupling) {
  const out = [];
  for (let plate = 0; plate < positions.length; plate++) {
    for (const dir of ['L', 'R']) {
      if (isLegal(positions, coupling, plate, dir)) out.push({ plate, dir });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/model.test.js`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/model.js test/model.test.js
git commit -m "feat(model): legality, solved check, and legal-move enumeration"
```

---

## Task 3: Solver — breadth-first safe path

**Files:**
- Create: `src/solver.js`
- Test: `test/solver.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/solver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/solver.js';
import { applyMove, isSolved, MIN, MAX } from '../src/model.js';

// helper: replay a solution, asserting every step stays in 1..7
function replay(positions, coupling, moves) {
  let p = positions.slice();
  for (const mv of moves) {
    p = applyMove(p, coupling, mv.plate, mv.dir);
    assert.ok(p.every((v) => v >= MIN && v <= MAX), `step left bounds: ${p}`);
  }
  return p;
}

test('already-solved returns an empty move list', () => {
  assert.deepEqual(solve([4, 4], [[1, 0], [0, 1]]), []);
});

test('single uncoupled plate needs two Left moves from 2 to 4', () => {
  const moves = solve([2], [[1]]);
  assert.equal(moves.length, 2);
  assert.deepEqual(replay([2], [[1]], moves), [4]);
});

test('two independent plates: shortest path reaches all-4 in bounds', () => {
  const coupling = [[1, 0], [0, 1]];
  const moves = solve([2, 5], coupling);
  assert.equal(moves.length, 3); // +2 on plate 0, -1 on plate 1
  assert.ok(isSolved(replay([2, 5], coupling, moves)));
});

test('coupled plates: solution respects side effects and stays in bounds', () => {
  // L on plate 0 shifts plate 0 +1 and plate 1 -1
  const coupling = [[1, -1], [0, 1]];
  const moves = solve([3, 5], coupling);
  assert.ok(isSolved(replay([3, 5], coupling, moves)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/solver.test.js`
Expected: FAIL — `../src/solver.js` not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/solver.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/solver.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/solver.js test/solver.test.js
git commit -m "feat(solver): BFS shortest edge-free path to all-4"
```

---

## Task 4: Solver — unsolvable mappings return null

**Files:**
- Modify: `test/solver.test.js`

- [ ] **Step 1: Add failing tests**

```js
// append to test/solver.test.js
test('returns null when no move can change the state', () => {
  // zero coupling: nothing ever moves, and we are not at goal
  assert.equal(solve([3], [[0]]), null);
});

test('returns null when the goal is unreachable within bounds', () => {
  // L on plate 0 only ever moves plate 1; plate 0 can never reach 4
  const coupling = [[0, 1], [0, 1]];
  assert.equal(solve([2, 4], coupling), null);
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `node --test test/solver.test.js`
Expected: PASS already (the BFS exhausts the reachable set and returns null). If either case hangs or fails, the bug is in `solve`'s termination — fix `solve` so exhausted search returns `null`.

- [ ] **Step 3: No implementation change expected**

These tests lock in the null-return contract. If Step 2 passed, proceed.

- [ ] **Step 4: Commit**

```bash
git add test/solver.test.js
git commit -m "test(solver): lock in null return for unsolvable mappings"
```

---

## Task 5: Discovery — mapping state and observation recording

**Files:**
- Create: `src/discovery.js`
- Test: `test/discovery.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/discovery.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapping, leftEffect, recordShifts } from '../src/discovery.js';

test('createMapping makes an n-plate zeroed matrix marked unstarted', () => {
  const m = createMapping(3);
  assert.equal(m.n, 3);
  assert.deepEqual(m.coupling, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(m.status, ['unstarted', 'unstarted', 'unstarted']);
});

test('leftEffect converts an observed shift into a Left-frame value', () => {
  assert.equal(leftEffect('L', 'L'), 1);  // probed Left, saw Left  => +1
  assert.equal(leftEffect('L', 'R'), -1); // probed Left, saw Right => -1
  assert.equal(leftEffect('R', 'L'), -1); // probed Right, saw Left => Left would be -1
  assert.equal(leftEffect('R', 'R'), 1);
});

test('recordShifts writes observed cells in the Left frame', () => {
  const m = createMapping(3);
  // probed plate 0 with Right; saw plate 0 shift Right and plate 2 shift Left
  recordShifts(m, 0, 'R', { 0: 'R', 2: 'L' });
  assert.deepEqual(m.coupling[0], [1, 0, -1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/discovery.test.js`
Expected: FAIL — `../src/discovery.js` not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/discovery.js
import { MIN, MAX, applyMove, isLegal } from './model.js';

export function createMapping(n) {
  return {
    n,
    coupling: Array.from({ length: n }, () => Array(n).fill(0)),
    status: Array(n).fill('unstarted'),
  };
}

// Convert an observed screen shift ('L' = +1) into the Left-press effect value,
// accounting for which direction was actually probed.
export function leftEffect(probeDir, shift) {
  return (probeDir === 'L' ? 1 : -1) * (shift === 'L' ? 1 : -1);
}

export function recordShifts(mapping, plate, probeDir, shifts) {
  for (const j of Object.keys(shifts)) {
    mapping.coupling[plate][Number(j)] = leftEffect(probeDir, shifts[j]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/discovery.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/discovery.js test/discovery.test.js
git commit -m "feat(discovery): mapping state and Left-frame observation recording"
```

---

## Task 6: Discovery — probe safety

**Files:**
- Modify: `src/discovery.js`
- Test: `test/discovery.test.js`

- [ ] **Step 1: Add failing tests**

```js
// append to test/discovery.test.js
import { probeSafe } from '../src/discovery.js';

test('probe is safe when every other plate is interior (2..6)', () => {
  const m = createMapping(3);
  assert.equal(probeSafe([4, 3, 5], m, 0, 'L'), true);
});

test('probe is unsafe when another plate sits at an edge', () => {
  const m = createMapping(3);
  assert.equal(probeSafe([4, 1, 5], m, 0, 'L'), false); // plate 1 at edge
  assert.equal(probeSafe([4, 5, 7], m, 0, 'R'), false); // plate 2 at edge
});

test('probe is unsafe when the selected plate is pushed past its own edge', () => {
  const m = createMapping(2);
  assert.equal(probeSafe([7, 4], m, 0, 'L'), false); // 7 -> 8
  assert.equal(probeSafe([1, 4], m, 0, 'R'), false); // 1 -> 0
  assert.equal(probeSafe([7, 4], m, 0, 'R'), true);  // 7 -> 6 ok, other interior
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/discovery.test.js`
Expected: FAIL — `probeSafe` not exported.

- [ ] **Step 3: Add the implementation**

```js
// append to src/discovery.js

// A probe is "guaranteed not to block" when:
//  - the selected plate itself won't be pushed past an edge by its own +/-1, and
//  - every OTHER plate is strictly interior (2..6), so any unknown +/-1 coupling
//    on it still lands in 1..7.
// Unknown cells are stored as 0, indistinguishable from a true zero, so we stay
// conservative: any other plate at an edge makes the probe unsafe.
export function probeSafe(positions, mapping, plate, dir) {
  const sel = positions[plate];
  if (dir === 'L' && sel === MAX) return false;
  if (dir === 'R' && sel === MIN) return false;
  for (let j = 0; j < positions.length; j++) {
    if (j === plate) continue;
    if (positions[j] <= MIN || positions[j] >= MAX) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/discovery.test.js`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/discovery.js test/discovery.test.js
git commit -m "feat(discovery): guaranteed-safe probe detection"
```

---

## Task 7: Discovery — probe recommendation (safe, prep, least-risky)

**Files:**
- Modify: `src/discovery.js`
- Test: `test/discovery.test.js`

- [ ] **Step 1: Add failing tests**

```js
// append to test/discovery.test.js
import { recommendNext } from '../src/discovery.js';

test('recommends a guaranteed-safe probe when one exists', () => {
  const m = createMapping(3);
  const rec = recommendNext([4, 3, 5], m);
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, true);
  assert.equal(m.status[rec.plate] !== 'done', true);
});

test('skips already-done plates and prefers partial ones', () => {
  const m = createMapping(3);
  m.status = ['done', 'partial', 'unstarted'];
  const rec = recommendNext([4, 3, 5], m);
  assert.equal(rec.plate, 1); // partial preferred over unstarted, done skipped
});

test('falls back to a least-risky probe when an edge plate blocks safety', () => {
  const m = createMapping(2);
  m.status = ['unstarted', 'done']; // no known move available to prep with plate 1? see next test
  const rec = recommendNext([1, 7], m); // both at edges, nothing safe
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, false);
});

test('recommends a prep move when a known plate can pull an edge plate inward', () => {
  const m = createMapping(2);
  // plate 1 is fully mapped: pressing Left on it shifts plate 1 by -1 (toward center).
  m.coupling = [[0, 0], [0, -1]];
  m.status = ['unstarted', 'done'];
  // plate 1 sits at the top edge (7); while it's there no probe of plate 0 is safe,
  // so the wizard first nudges plate 1 inward with the known move (Left on plate 1).
  const rec = recommendNext([4, 7], m);
  assert.equal(rec.type, 'prep');
  assert.equal(rec.plate, 1);
  assert.equal(rec.dir, 'L');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/discovery.test.js`
Expected: FAIL — `recommendNext` not exported.

- [ ] **Step 3: Add the implementation**

```js
// append to src/discovery.js

function preferredDirs(positions, plate) {
  // try the direction that moves the selected plate toward center first
  return positions[plate] > 4 ? ['R', 'L'] : ['L', 'R'];
}

function candidateOrder(status) {
  // partial (0) before unstarted (1); 'done' excluded by caller
  return status === 'partial' ? 0 : 1;
}

// Among fully-mapped plates, find a legal known move that pulls a plate currently
// at an edge toward center. Used to de-risk a future probe.
function findPrepMove(positions, mapping) {
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') continue;
    for (const dir of ['L', 'R']) {
      if (!isLegal(positions, mapping.coupling, i, dir)) continue;
      const np = applyMove(positions, mapping.coupling, i, dir);
      let improves = false;
      for (let j = 0; j < mapping.n; j++) {
        const atEdge = positions[j] === MIN || positions[j] === MAX;
        if (atEdge && Math.abs(np[j] - 4) < Math.abs(positions[j] - 4)) improves = true;
      }
      if (improves) {
        return {
          type: 'prep',
          plate: i,
          dir,
          reason: 'Move a known plate first to pull an edge plate toward center, making the next probe safe.',
        };
      }
    }
  }
  return null;
}

export function recommendNext(positions, mapping) {
  const candidates = [];
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') candidates.push(i);
  }
  candidates.sort((a, b) => candidateOrder(mapping.status[a]) - candidateOrder(mapping.status[b]));

  // 1) a guaranteed-safe probe
  for (const plate of candidates) {
    for (const dir of preferredDirs(positions, plate)) {
      if (probeSafe(positions, mapping, plate, dir)) {
        return {
          type: 'probe',
          plate,
          dir,
          safe: true,
          reason: 'Nothing this move can touch is at an edge, so it will go through cleanly.',
        };
      }
    }
  }

  // 2) a prep move that de-risks using known relationships
  const prep = findPrepMove(positions, mapping);
  if (prep) return prep;

  // 3) least-risky probe (no guaranteed-safe option yet)
  const plate = candidates[0];
  const dir = preferredDirs(positions, plate)[0];
  return {
    type: 'probe',
    plate,
    dir,
    safe: false,
    reason: 'No fully safe probe yet — some plates are at an edge. This is the least-risky option.',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/discovery.test.js`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/discovery.js test/discovery.test.js
git commit -m "feat(discovery): probe recommendation with safe/prep/least-risky tiers"
```

---

## Task 8: Discovery — apply probe, defer, completeness

**Files:**
- Modify: `src/discovery.js`
- Test: `test/discovery.test.js`

- [ ] **Step 1: Add failing tests**

```js
// append to test/discovery.test.js
import { applyProbe, defer, allMapped } from '../src/discovery.js';

test('applyProbe records shifts, advances positions, and marks done', () => {
  const m = createMapping(2);
  // probe plate 0 with Left; saw plate 0 shift Left (+1) and plate 1 shift Right (-1)
  const np = applyProbe([3, 5], m, 0, 'L', { 0: 'L', 1: 'R' }, { complete: true });
  assert.deepEqual(m.coupling[0], [1, -1]);
  assert.deepEqual(np, [4, 4]);
  assert.equal(m.status[0], 'done');
});

test('applyProbe with complete:false marks the plate partial but keeps marks', () => {
  const m = createMapping(2);
  applyProbe([3, 5], m, 0, 'L', { 0: 'L' }, { complete: false });
  assert.deepEqual(m.coupling[0], [1, 0]);
  assert.equal(m.status[0], 'partial');
});

test('defer keeps existing marks and sets status partial', () => {
  const m = createMapping(2);
  recordShifts(m, 0, 'L', { 0: 'L' });
  defer(m, 0);
  assert.equal(m.status[0], 'partial');
  assert.deepEqual(m.coupling[0], [1, 0]); // marks retained
});

test('allMapped is true only when every plate is done', () => {
  const m = createMapping(2);
  assert.equal(allMapped(m), false);
  m.status = ['done', 'partial'];
  assert.equal(allMapped(m), false);
  m.status = ['done', 'done'];
  assert.equal(allMapped(m), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/discovery.test.js`
Expected: FAIL — `applyProbe`/`defer`/`allMapped` not exported.

- [ ] **Step 3: Add the implementation**

```js
// append to src/discovery.js
export function applyProbe(positions, mapping, plate, dir, shifts, { complete = true } = {}) {
  recordShifts(mapping, plate, dir, shifts);
  mapping.status[plate] = complete ? 'done' : 'partial';
  // positions advance by exactly what was observed (the recorded row reproduces it)
  return applyMove(positions, mapping.coupling, plate, dir);
}

export function defer(mapping, plate) {
  if (mapping.status[plate] !== 'done') mapping.status[plate] = 'partial';
}

export function allMapped(mapping) {
  return mapping.status.every((s) => s === 'done');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/discovery.test.js`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/discovery.js test/discovery.test.js
git commit -m "feat(discovery): apply probe, defer, and completeness check"
```

---

## Task 9: Storage — locks CRUD with an injectable store

**Files:**
- Create: `src/storage.js`
- Test: `test/storage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/storage.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLocks, saveLock, getLock, deleteLock } from '../src/storage.js';

// minimal localStorage-compatible store for tests
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const lock = (id) => ({ id, name: `Lock ${id}`, n: 3, coupling: [[1,0,0],[0,1,0],[0,0,1]], notes: '' });

test('loadLocks returns [] when nothing is stored', () => {
  assert.deepEqual(loadLocks(memStore()), []);
});

test('saveLock inserts then updates by id', () => {
  const s = memStore();
  saveLock(s, lock('a'));
  saveLock(s, lock('b'));
  assert.equal(loadLocks(s).length, 2);
  saveLock(s, { ...lock('a'), name: 'Renamed' });
  assert.equal(loadLocks(s).length, 2);
  assert.equal(getLock(s, 'a').name, 'Renamed');
});

test('deleteLock removes by id', () => {
  const s = memStore();
  saveLock(s, lock('a'));
  saveLock(s, lock('b'));
  deleteLock(s, 'a');
  assert.equal(getLock(s, 'a'), null);
  assert.equal(loadLocks(s).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL — `../src/storage.js` not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/storage.js
const LOCKS_KEY = 'g1r.locks';
const SESSION_KEY = 'g1r.session';

export function loadLocks(store) {
  const raw = store.getItem(LOCKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveLock(store, lock) {
  const locks = loadLocks(store);
  const i = locks.findIndex((l) => l.id === lock.id);
  if (i >= 0) locks[i] = lock;
  else locks.push(lock);
  store.setItem(LOCKS_KEY, JSON.stringify(locks));
  return locks;
}

export function getLock(store, id) {
  return loadLocks(store).find((l) => l.id === id) || null;
}

export function deleteLock(store, id) {
  const locks = loadLocks(store).filter((l) => l.id !== id);
  store.setItem(LOCKS_KEY, JSON.stringify(locks));
  return locks;
}

export { LOCKS_KEY, SESSION_KEY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/storage.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js test/storage.test.js
git commit -m "feat(storage): lock CRUD over an injectable store"
```

---

## Task 10: Storage — session save/load

**Files:**
- Modify: `src/storage.js`
- Test: `test/storage.test.js`

- [ ] **Step 1: Add failing tests**

```js
// append to test/storage.test.js
import { saveSession, loadSession } from '../src/storage.js';

test('loadSession returns null when nothing is stored', () => {
  assert.equal(loadSession(memStore()), null);
});

test('saveSession then loadSession round-trips the working state', () => {
  const s = memStore();
  const session = { stage: 'solve', positions: [4, 3, 5], n: 3 };
  saveSession(s, session);
  assert.deepEqual(loadSession(s), session);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL — `saveSession`/`loadSession` not exported.

- [ ] **Step 3: Add the implementation**

```js
// append to src/storage.js
export function saveSession(store, session) {
  store.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(store) {
  const raw = store.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/storage.test.js`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js test/storage.test.js
git commit -m "feat(storage): session save/load"
```

---

## Task 11: Integration — map a lock from observations, then solve it

**Files:**
- Create: `test/integration.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/integration.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapping, recordShifts } from '../src/discovery.js';
import { solve } from '../src/solver.js';
import { applyMove, isSolved, MIN, MAX } from '../src/model.js';

// Turn a true coupling row into the screen shifts a player would observe
// when pressing Left on that plate (+1 => 'L', -1 => 'R'; zeros unseen).
function observedLeftShifts(row) {
  const shifts = {};
  row.forEach((v, j) => {
    if (v === 1) shifts[j] = 'L';
    else if (v === -1) shifts[j] = 'R';
  });
  return shifts;
}

test('a discovered mapping reproduces the true coupling and yields a valid solve', () => {
  // Unimodular (det = 1) so any target is reachable with integer presses.
  const trueCoupling = [
    [1, -1, 0],
    [0, 1, -1],
    [0, 0, 1],
  ];

  // Player maps each plate by pressing Left and recording what shifted.
  const m = createMapping(3);
  trueCoupling.forEach((row, i) => recordShifts(m, i, 'L', observedLeftShifts(row)));
  assert.deepEqual(m.coupling, trueCoupling);

  // Solve from a starting position and verify the path is valid and edge-free.
  const start = [3, 4, 4];
  const moves = solve(start, m.coupling);
  assert.notEqual(moves, null);

  let p = start.slice();
  for (const mv of moves) {
    p = applyMove(p, m.coupling, mv.plate, mv.dir);
    assert.ok(p.every((v) => v >= MIN && v <= MAX), `out of bounds at ${p}`);
  }
  assert.ok(isSolved(p));
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `node --test test/integration.test.js`
Expected: PASS if all prior tasks are complete. If it fails, the failure points to a real cross-module bug — fix the implicated module (do not weaken the test).

- [ ] **Step 3: No new implementation**

This test only exercises already-built modules. If Step 2 passed, proceed.

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: PASS — all five test files green.

- [ ] **Step 5: Commit**

```bash
git add test/integration.test.js
git commit -m "test(integration): map-from-observations then solve end-to-end"
```

---

## Self-Review

**Spec coverage** (against `docs/specs/2026-06-05-g1r-lockpick-solver-design.md`):
- §2/§4.1 puzzle model (positions, coupling, Left/Right inverse, edge-blocking) → Tasks 1–2.
- §4.2 solver (shortest edge-free path, null when unreachable) → Tasks 3–4.
- §5.1/§5.2 recording, Left-frame, no-"none", revisable marks → Tasks 5, 8.
- §5.3 risk-aware sequencing (guaranteed-safe, direction choice, prep de-risking, honest fallback) → Tasks 6–7.
- §5.5 defer keeps marks; done/partial/unstarted status → Task 8.
- §8 persistence (locks + session) → Tasks 9–10.
- End-to-end realism → Task 11.
- §6 UI and §5.4 blocked-probe *interaction* are intentionally deferred to the separate UI plan. The engine supports them: blocked probes simply don't call `applyProbe` (positions unchanged), and partial recording + `defer` retain marks.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows real assertions.

**Type consistency:** `move` is `{plate, dir}` everywhere; `dir` is `'L'|'R'`; `coupling[i][j]` is Left-effect of plate `i` on plate `j`; `mapping.status` values are `'unstarted'|'partial'|'done'`; storage functions all take `store` first. Consistent across Tasks 1–11.

---

## Notes for the UI plan (next document)

The browser UI (separate plan) will import these modules unchanged and add: the isometric/2D board renderer with measured gutter labels, the Setup/Discovery/Solve panels, the stage flow, the blocked-probe retry UX, and wiring `storage.js` to the real `localStorage`. Because the browser loads ES modules, it must be served over HTTP (e.g. `python3 -m http.server`) rather than opened via `file://`; that instruction belongs in the UI plan.
