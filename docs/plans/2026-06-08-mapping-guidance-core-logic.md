# Mapping Guidance — Core Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edge-first probe ordering and a multi-step edge-clearing planner to the lock-mapping recommender, as pure functions with full unit tests.

**Architecture:** Three pure-logic changes — a position predicate `allInterior` in `model.js`, a breadth-first `planEdgeClear` search in `solver.js` that finds a sequence of already-mapped-plate moves clearing every edge, and an updated `recommendNext` in `discovery.js` that orders edge plates first and returns a `plan` suggestion (the new planner) where it previously returned a single-step `prep`. No UI changes — `suggestDefault` and the suggestion render already ignore non-`probe` suggestions, so the running app is unaffected until the separate UI plan wires the planner in.

**Tech Stack:** Vanilla ES modules, `node --test` (`node:test` + `node:assert/strict`).

This is plan 1 of 2 for the spec `docs/specs/2026-06-08-lock-mapping-guidance-design.md`. Plan 2 (mapping UI: live/draggable positions, synchronized drag↔tag recording, two-mode Done/Skip panel, coaching) builds on the `plan`-typed suggestion contract introduced here.

---

## File Structure

- `src/model.js` — add `allInterior(positions)` predicate alongside `isSolved`.
- `src/solver.js` — add `planEdgeClear(positions, coupling, donePlates, opts)` BFS.
- `src/discovery.js` — update `recommendNext`: edge-first candidate ordering; replace the single-step `findPrepMove` tier with a `planEdgeClear` `plan` tier; edge-aware reason strings. Remove the now-unused `findPrepMove`.
- `test/model.test.js` — tests for `allInterior`.
- `test/solver.test.js` — tests for `planEdgeClear`.
- `test/discovery.test.js` — update the existing `prep` test to the new `plan` contract; add edge-ordering and plan-tier tests.

### Suggestion contract (after this plan)

`recommendNext(positions, mapping)` returns one of:
- `{ type: 'probe', plate, dir, safe, reason }` — press one plate (tiers 1 and 3).
- `{ type: 'plan', moves: [{plate, dir}, ...], reason }` — a sequence of known moves that clears all edges (tier 2).
- `null` — everything mapped.

---

## Task 1: `allInterior` predicate (`model.js`)

**Files:**
- Modify: `src/model.js`
- Test: `test/model.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/model.test.js` (add `allInterior,` to the existing multi-line import block from `../src/model.js` at the top of the file):

```js
test('allInterior is true only when every plate is strictly inside the edges', () => {
  assert.equal(allInterior([2, 4, 6]), true);
  assert.equal(allInterior([4, 4, 4]), true);
  assert.equal(allInterior([1, 4]), false); // 1 is the MIN edge
  assert.equal(allInterior([4, 7]), false); // 7 is the MAX edge
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/model.test.js`
Expected: FAIL — `allInterior is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/model.js`, add after `isSolved` (which returns `positions.every((v) => v === GOAL)`):

```js
// True when no plate sits on an edge (every position is strictly in MIN+1..MAX-1).
// A successful probe is guaranteed safe in this state, since any unknown ±1 coupling
// still lands in bounds.
export function allInterior(positions) {
  return positions.every((v) => v > MIN && v < MAX);
}
```

`MIN` and `MAX` are already defined at the top of `model.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model.js test/model.test.js
git commit -m "feat(model): add allInterior position predicate"
```

---

## Task 2: `planEdgeClear` BFS (`solver.js`)

**Files:**
- Modify: `src/solver.js`
- Test: `test/solver.test.js`

The planner does a breadth-first search over positions, expanding only **legal** presses of **already-mapped (`done`) plates**, and returns the shortest move sequence reaching an all-interior state. Because every expanded move is legal and the goal is "no plate on an edge," a returned plan never strands a plate on an edge it cannot recover — defeating the whack-a-mole problem. Returns `[]` if already all-interior, or `null` if no such sequence exists.

- [ ] **Step 1: Write the failing tests**

Add to `test/solver.test.js`. Change its existing solver import (line 3, `import { solve, countSwitches } from '../src/solver.js';`) to:

```js
import { solve, countSwitches, planEdgeClear } from '../src/solver.js';
```

Then add:

```js
test('planEdgeClear returns an empty plan when already all-interior', () => {
  assert.deepEqual(planEdgeClear([4, 4], [[1, 0], [0, 1]], [0, 1]), []);
});

test('planEdgeClear returns null when no mapped plate can clear an edge', () => {
  // plate 0 is stuck at the MIN edge; only plate 1 is done and it moves only itself.
  assert.equal(planEdgeClear([1, 4], [[1, 0], [0, 1]], [1]), null);
});

test('planEdgeClear returns null when there are no done plates and an edge exists', () => {
  assert.equal(planEdgeClear([1, 4], [[1, 0], [0, 1]], []), null);
});

test('planEdgeClear finds a single known move that clears one edge', () => {
  // plate 1 done, moves only itself; pressing it Left moves 1 -> 2 (interior).
  assert.deepEqual(planEdgeClear([4, 1], [[1, 0], [0, 1]], [1]), [{ plate: 1, dir: 'L' }]);
});

test('planEdgeClear finds a multi-step sequence (no single move clears both edges)', () => {
  // both plates at the MIN edge, independent self-moves: needs one Left press each.
  const plan = planEdgeClear([1, 1], [[1, 0], [0, 1]], [0, 1]);
  assert.deepEqual(plan, [{ plate: 0, dir: 'L' }, { plate: 1, dir: 'L' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/solver.test.js`
Expected: FAIL — `planEdgeClear is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/solver.js`, update the model import on line 1 to add `isLegal` and `allInterior`:

```js
import { applyMove, isSolved, isLegal, legalMoves, allInterior, GOAL } from './model.js';
```

Then add at the end of the file:

```js
// Breadth-first search for a shortest sequence of moves on already-mapped (`done`)
// plates that drives every plate off the edges (all-interior). Only legal moves are
// expanded, so a returned plan never strands a plate on an edge — directly avoiding
// the "clear one edge, create another" whack-a-mole. Returns move[] (possibly empty
// when already all-interior) or null when no done-plate sequence reaches all-interior.
export function planEdgeClear(positions, coupling, donePlates, { maxNodes = 200_000 } = {}) {
  if (allInterior(positions)) return [];
  const start = positions.slice();
  const visited = new Set([start.join(',')]);
  const queue = [{ pos: start, path: [] }];
  let count = 0;
  while (queue.length) {
    const cur = queue.shift();
    for (const plate of donePlates) {
      for (const dir of ['L', 'R']) {
        if (!isLegal(cur.pos, coupling, plate, dir)) continue;
        const np = applyMove(cur.pos, coupling, plate, dir);
        const key = np.join(',');
        if (visited.has(key)) continue;
        const path = [...cur.path, { plate, dir }];
        if (allInterior(np)) return path;
        visited.add(key);
        queue.push({ pos: np, path });
        if (++count > maxNodes) return null;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/solver.test.js`
Expected: PASS (all five new tests plus the existing solver tests).

- [ ] **Step 5: Commit**

```bash
git add src/solver.js test/solver.test.js
git commit -m "feat(solver): add planEdgeClear BFS for known-move edge clearing"
```

---

## Task 3: edge-first ordering and the `plan` tier (`discovery.js`)

**Files:**
- Modify: `src/discovery.js` (`recommendNext`, lines 80-119; remove `findPrepMove`, lines 53-78)
- Test: `test/discovery.test.js`

`recommendNext` keeps its three tiers but (a) orders candidate plates so edge plates come first within each tier-1 scan, (b) replaces the single-step `findPrepMove` tier with the multi-step `planEdgeClear`, returning `{ type: 'plan', moves, reason }`, and (c) uses an edge-aware reason for a safe probe that clears an edge.

- [ ] **Step 1: Update the existing prep test and add new tests**

In `test/discovery.test.js`, **replace** the existing test `'recommends a prep move when a known plate can pull an edge plate inward'` (the one asserting `rec.type === 'prep'`) with this `plan`-contract version:

```js
test('recommends an edge-clearing plan when a known plate can pull an edge plate inward', () => {
  const m = createMapping(2);
  // plate 1 is fully mapped: pressing Left on it shifts plate 1 by -1 (toward center).
  m.coupling = [[0, 0], [0, -1]];
  m.status = ['unstarted', 'done'];
  // plate 1 sits at the top edge (7); no probe of plate 0 is safe while it's there,
  // so the recommender returns a known-move plan that nudges plate 1 inward (Left).
  const rec = recommendNext([4, 7], m);
  assert.equal(rec.type, 'plan');
  assert.deepEqual(rec.moves, [{ plate: 1, dir: 'L' }]);
});
```

Then add these new tests:

```js
test('orders an at-edge plate ahead of an interior one for a guaranteed-safe probe', () => {
  const m = createMapping(3); // all unstarted
  // plate 2 sits on the MAX edge, plates 0 and 1 are interior. With no OTHER plate at
  // an edge, probing plate 2 toward center (R) is safe and should be preferred.
  const rec = recommendNext([3, 5, 7], m);
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, true);
  assert.equal(rec.plate, 2);
  assert.equal(rec.dir, 'R');
});

test('a safe probe that clears an edge gets an edge-aware reason', () => {
  const m = createMapping(3);
  const rec = recommendNext([3, 5, 7], m);
  assert.match(rec.reason, /edge/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/discovery.test.js`
Expected: FAIL — the replaced test expects `type: 'plan'` (currently `'prep'`); the new ordering/reason tests fail against current behavior.

- [ ] **Step 3: Update `recommendNext` and remove `findPrepMove`**

In `src/discovery.js`:

a) Replace the import on line 1 (`import { MIN, MAX, applyMove, isLegal } from './model.js';`) with these two lines:

```js
import { MIN, MAX, applyMove } from './model.js';
import { planEdgeClear } from './solver.js';
```

`isLegal` is dropped because only `findPrepMove` (removed in this task) used it. `applyMove` is kept — `applyProbe` still uses it. `allInterior` is not imported here; it is used inside `planEdgeClear` (in `solver.js`), not in `discovery.js`.

b) Delete the entire `findPrepMove` function (the block starting with the comment `// Among fully-mapped plates, find a legal known move...` through its closing `}` — lines 53-78).

c) Add an `atEdge` helper just above `recommendNext`:

```js
function atEdge(positions, i) {
  return positions[i] <= MIN || positions[i] >= MAX;
}
```

d) Replace the body of `recommendNext` with:

```js
export function recommendNext(positions, mapping) {
  const candidates = [];
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') candidates.push(i);
  }
  if (candidates.length === 0) return null; // everything is mapped
  // Edge plates first (clear them before they block safe probing), then fresh before deferred.
  candidates.sort((a, b) => {
    const ea = atEdge(positions, a) ? 0 : 1;
    const eb = atEdge(positions, b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return candidateOrder(mapping.status[a]) - candidateOrder(mapping.status[b]);
  });

  // 1) a guaranteed-safe probe (edge plates preferred, pressed toward center)
  for (const plate of candidates) {
    for (const dir of preferredDirs(positions, plate)) {
      if (probeSafe(positions, mapping, plate, dir)) {
        return {
          type: 'probe',
          plate,
          dir,
          safe: true,
          reason: atEdge(positions, plate)
            ? 'On the edge — press toward center to clear it safely.'
            : 'Nothing this move can touch is at an edge, so it will go through cleanly.',
        };
      }
    }
  }

  // 2) an edge-clearing plan using already-mapped plates
  const donePlates = [];
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] === 'done') donePlates.push(i);
  }
  const moves = planEdgeClear(positions, mapping.coupling, donePlates);
  if (moves && moves.length) {
    return {
      type: 'plan',
      moves,
      reason: 'Clear the edges first with these known moves, then the next probe is safe.',
    };
  }

  // 3) least-risky probe (no guaranteed-safe option, no clearing plan yet)
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

Leave `probeSafe`, `preferredDirs`, `candidateOrder`, `recordShifts`, `leftEffect`, `applyProbe`, `defer`, `allMapped`, and `createMapping` unchanged.

- [ ] **Step 4: Run the discovery tests to verify they pass**

Run: `node --test test/discovery.test.js`
Expected: PASS — including the updated plan test and the new ordering/reason tests.

- [ ] **Step 5: Run the full suite to check nothing else regressed**

Run: `node --test`
Expected: PASS for all files (model, solver, discovery, integration, etc.). The integration test uses `recordShifts`/`applyProbe`, which are untouched.

- [ ] **Step 6: Commit**

```bash
git add src/discovery.js test/discovery.test.js
git commit -m "feat(discovery): edge-first ordering and multi-step edge-clearing plan in recommendNext"
```

---

## Self-Review Notes

- **Spec coverage (logic portions):**
  - "Recommender: candidate sort edge-first" → Task 3 (sort) + test.
  - "Tier 2 becomes the edge-clearing planner (multi-step generalization of findPrepMove)" → Task 2 (`planEdgeClear`) + Task 3 (tier wiring), `findPrepMove` removed.
  - "Reason strings call out the intent" → Task 3 edge-aware reason + test.
  - "goal = no plate at an edge (all interior 2..6); allowed moves = legal presses of done plates; output a short sequence; fallback returns nothing" → Task 2.
- **Out of scope here (Plan 2 — UI):** live/draggable positions, the ±1 drag clamp, synchronized drag↔tag recording, the two-mode UI with Done/Skip board sync, the coaching panel, and rendering the `plan` suggestion. This plan deliberately stops at the pure functions; the existing app ignores non-`probe` suggestions (`suggestDefault` falls back to the first unmapped plate; the suggestion HTML only renders `type === 'probe'`), so shipping Plan 1 alone changes no user-visible behavior while making the logic fully testable.
- **Type consistency:** `planEdgeClear` returns `move[]` of `{plate, dir}`; tier 2 surfaces them verbatim as `suggestion.moves`. `allInterior` is the single shared predicate used by both `planEdgeClear` and (conceptually) the safe-probe state. `atEdge` is local to `discovery.js`.
- **Placeholder scan:** none — every step has exact code and an exact `node --test` command.

## Execution note

After Plan 1 lands and `node --test` is green, write Plan 2 (mapping UI) against the concrete `recommendNext` contract above — in particular the `{ type: 'plan', moves }` suggestion, which Plan 2 renders as the Done/Skip edge-clearing panel.
