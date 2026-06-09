# Mapping Guidance — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All work happens on `main`; commit after each task.

**Goal:** Wire the mapping screen to live, draggable positions with a synchronized drag↔tag recording flow, a Done/Skip edge-clearing panel that consumes the `{type:'plan', moves}` suggestion, and a live coaching line — so every hint reflects where the slides actually are.

**Architecture:** Push all new behavior into small pure modules tested with `node --test` (matching how `board.js`/`active-plate.js` are factored), then make `src/ui/app.js` a thin caller. A new `src/ui/mapping-record.js` holds the per-probe recording state machine (baseline + active press direction + per-plate tags → live positions and a coupling row). A new `src/ui/coaching.js` derives the edge-coaching message. `src/solver.js` gains `applySequence` so the Done button can advance positions through a known move sequence. `app.js` swaps its frozen `state.rel` map for a `state.rec` recording object, makes the mapping board draggable (clamped ±1 per probe), commits recorded positions on Save, renders the plan suggestion as a Done/Skip panel, and shows the coaching line.

**Tech Stack:** Vanilla ES modules, `node --test` (`node:test` + `node:assert/strict`), static site served by `scripts/serve.py` (no build step for source).

This is plan 2 of 2 for the spec `docs/specs/2026-06-08-lock-mapping-guidance-design.md`. Plan 1 (`docs/plans/2026-06-08-mapping-guidance-core-logic.md`) landed the pure recommender logic: `allInterior` (`model.js`), `planEdgeClear` (`solver.js`), and `recommendNext`'s edge-first ordering + `{type:'plan', moves}` tier (`discovery.js`). This plan renders and drives that contract.

---

## Background the implementer needs

**The model (already built):**
- `MIN = 1`, `MAX = 7`, `GOAL = 4` (`src/model.js`).
- `applyMove(positions, coupling, plate, dir)` returns new positions; `dirSign('L') = +1`, `dirSign('R') = -1`. A press of plate `i` in `dir` does `positions[j] += coupling[i][j] * dirSign(dir)`. So the active plate's own one-slot move is `delta_i = dirSign(dir)`: pressing **Left** raises its position by 1 (`+1`), pressing **Right** lowers it (`-1`).
- `recommendNext(positions, mapping)` returns one of `{type:'probe', plate, dir, safe, reason}`, `{type:'plan', moves:[{plate,dir},…], reason}`, or `null`.

**The mapping screen today (`src/ui/app.js`, `state.stage === 'discovery'`):**
- `mappingView()` (around line 1013) renders an `ap-card` header, a board (`createBoard`, `selectable: true`, **not** draggable), and per-row "Moves with / Moves opposite" buttons.
- Recording today: select a plate → press it in game → click each *other* plate's with/opposite → **Save plate**. `saveActivePlate()` writes the coupling row and marks the plate `done` but **never touches `state.positions`** — the root staleness bug.
- `state.rel` is a `{ [otherPlate]: 'with' | 'opposite' }` map for the active plate. `relFromMapping(plate)` rebuilds it from a saved coupling row (`+1 → with`, `-1 → opposite`). `suggestDefault()` picks the active plate and seeds `state.rel`. The `set-rel`, `select-plate`, and `save-next` click actions drive it.
- The board already supports dragging: `createBoard(host, { draggable: true, onSetPosition })` adds pointer handlers that call `onSetPosition(i, pos)` with a snapped `1..7` position. `onDragPosition(i, pos)` is the existing Setup/Solve-edit handler (free, unclamped). The pointer/up listeners live on `window`, and the existing handlers call `render()` every step, so re-rendering mid-drag is already the established pattern.
- The suggestion render block (around line 1029) only handles `type === 'probe'`; a `plan` suggestion currently renders nothing.

**Repo testing discipline:** pure logic → its own `src/...` module + `test/...` test with `node --test`. DOM wiring in `app.js` has no unit tests (only `nextActivePlate` is extracted/tested). This plan keeps every nontrivial computation in a tested module so the two `app.js` wiring tasks are thin glue verified by hand in the browser.

---

## File Structure

- `src/solver.js` — add `applySequence(positions, coupling, moves)` (fold `applyMove` over a known sequence). Used by the Done button.
- `src/ui/mapping-record.js` — **new.** The per-probe recording state machine, all pure: `suggestedDeltaI`, `clampStep`, `createRecording`, `tagOf`, `positionsOf`, `couplingRow`, `setActiveDir`, `toggleTag`, `dragActive`, `dragOther`, `validRecording`.
- `src/ui/coaching.js` — **new.** `edgePlates(positions)` and `coachingMessage(positions)`.
- `src/ui/app.js` — wire it all in: swap `state.rel` → `state.rec`, draggable+clamped mapping board with `onMapDrag`, Save commits recorded positions, render `{type:'plan'}` as a Done/Skip panel, render the coaching line, Done/Skip + implicit-skip handling.
- `test/solver.test.js` — tests for `applySequence`.
- `test/mapping-record.test.js` — **new.** Tests for the recording state machine.
- `test/coaching.test.js` — **new.** Tests for the coaching helpers.

### The recording object (contract introduced here)

```
rec = {
  baseline: number[],          // state.positions snapshotted when the plate became active
  active: number,              // index of the plate being recorded
  deltaI: 1 | -1,              // the active plate's one-slot press direction (+1 = Left, -1 = Right)
  tags: { [j: number]: 'with' | 'opposite' },  // never contains `active`
}
```

Three equivalent views of plate `j` (spec table):

| tag        | coupling[active][j] | live position of `j` |
|------------|---------------------|----------------------|
| `with`     | `+1`                | `baseline[j] + deltaI` |
| `opposite` | `-1`                | `baseline[j] - deltaI` |
| none       | `0`                 | `baseline[j]`        |

Note `coupling[active][j] = delta_j * delta_i` and `delta_i = ±1`, so the coupling row is **independent of `deltaI`'s sign** — flipping the press direction re-derives positions but leaves the learned couplings unchanged.

---

## Task 1: `applySequence` known-move folder (`solver.js`)

**Files:**
- Modify: `src/solver.js`
- Test: `test/solver.test.js`

The Done button applies a whole edge-clearing plan to the live positions at once. `applySequence` folds `applyMove` over the move list. `applyMove` is already imported at the top of `solver.js`.

- [ ] **Step 1: Write the failing tests**

Add to `test/solver.test.js`. Its solver import is currently `import { solve, countSwitches, planEdgeClear } from '../src/solver.js';` — change it to add `applySequence`:

```js
import { solve, countSwitches, planEdgeClear, applySequence } from '../src/solver.js';
```

Then add:

```js
test('applySequence returns a copy of positions for an empty move list', () => {
  const start = [4, 4];
  const out = applySequence(start, [[1, 0], [0, 1]], []);
  assert.deepEqual(out, [4, 4]);
  assert.notEqual(out, start); // a fresh array, not the input
});

test('applySequence applies one known self-move', () => {
  // plate 1 moves only itself; pressing it Left adds +1 to position 1.
  assert.deepEqual(applySequence([4, 1], [[1, 0], [0, 1]], [{ plate: 1, dir: 'L' }]), [4, 2]);
});

test('applySequence applies a multi-step sequence in order', () => {
  // both plates self-moving; one Left press each clears both MIN edges to interior.
  const out = applySequence([1, 1], [[1, 0], [0, 1]], [{ plate: 0, dir: 'L' }, { plate: 1, dir: 'L' }]);
  assert.deepEqual(out, [2, 2]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/solver.test.js`
Expected: FAIL — `applySequence is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add at the end of `src/solver.js`:

```js
// Advance positions through a known move sequence (each move is a press of a plate
// whose coupling row is already mapped). Returns a fresh positions array; the input
// is not mutated. The Done button uses this to apply an edge-clearing plan at once.
export function applySequence(positions, coupling, moves) {
  let p = positions.slice();
  for (const mv of moves) p = applyMove(p, coupling, mv.plate, mv.dir);
  return p;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/solver.test.js`
Expected: PASS (the three new tests plus all existing solver tests).

- [ ] **Step 5: Commit**

```bash
git add src/solver.js test/solver.test.js
git commit -m "feat(solver): add applySequence to fold known moves over positions"
```

---

## Task 2: recording core — positions & coupling derivation (`mapping-record.js`)

**Files:**
- Create: `src/ui/mapping-record.js`
- Test: `test/mapping-record.test.js`

The pure core: snapshot a baseline, pick a default press direction, and derive both the live board positions and the coupling row from the baseline + `deltaI` + tags.

- [ ] **Step 1: Write the failing tests**

Create `test/mapping-record.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestedDeltaI,
  clampStep,
  createRecording,
  tagOf,
  positionsOf,
  couplingRow,
} from '../src/ui/mapping-record.js';

test('suggestedDeltaI points toward center: -1 above the goal, +1 at or below', () => {
  assert.equal(suggestedDeltaI(7), -1); // press Right to come down toward 4
  assert.equal(suggestedDeltaI(5), -1);
  assert.equal(suggestedDeltaI(4), 1);
  assert.equal(suggestedDeltaI(2), 1); // press Left to go up toward 4
});

test('clampStep limits a raw drag to one slot from baseline and to the 1..7 board', () => {
  assert.equal(clampStep(4, 4), 4); // no move
  assert.equal(clampStep(4, 6), 5); // dragged two slots up, clamped to +1
  assert.equal(clampStep(4, 1), 3); // dragged down, clamped to -1
  assert.equal(clampStep(7, 9), 7); // can't exceed MAX even within one slot
  assert.equal(clampStep(1, -3), 1); // can't go below MIN
});

test('createRecording snapshots baseline, derives the default direction, and seeds tags', () => {
  const rec = createRecording([4, 7, 2], 1); // active = plate 1, at the top edge
  assert.deepEqual(rec.baseline, [4, 7, 2]);
  assert.equal(rec.active, 1);
  assert.equal(rec.deltaI, -1); // pos 7 -> toward center is Right
  assert.deepEqual(rec.tags, {});
});

test('createRecording snapshots a copy of positions (later mutation does not leak in)', () => {
  const pos = [4, 4];
  const rec = createRecording(pos, 0);
  pos[1] = 7;
  assert.deepEqual(rec.baseline, [4, 4]);
});

test('createRecording accepts initial tags (re-selecting an already-mapped plate)', () => {
  const rec = createRecording([4, 4, 4], 0, { 1: 'with', 2: 'opposite' });
  assert.equal(tagOf(rec, 1), 'with');
  assert.equal(tagOf(rec, 2), 'opposite');
  assert.equal(tagOf(rec, 0), 'none'); // the active plate is never tagged
});

test('positionsOf moves the active plate by deltaI and coupled plates accordingly', () => {
  // active = plate 0 pressed Left (deltaI +1); plate 1 with, plate 2 opposite, plate 3 none.
  const rec = createRecording([4, 4, 4, 4], 0, { 1: 'with', 2: 'opposite' });
  assert.deepEqual(positionsOf(rec), [5, 5, 3, 4]);
});

test('positionsOf re-derives coupled plates when the active direction flips', () => {
  const rec = { baseline: [4, 4, 4], active: 0, deltaI: -1, tags: { 1: 'with', 2: 'opposite' } };
  assert.deepEqual(positionsOf(rec), [3, 3, 5]); // active down, with-plate down, opposite-plate up
});

test('couplingRow encodes self=1, with=+1, opposite=-1, none=0 (independent of deltaI sign)', () => {
  const recL = createRecording([4, 4, 4, 4], 0, { 1: 'with', 2: 'opposite' });
  const recR = { ...recL, deltaI: -1 };
  const expected = [1, 1, -1, 0];
  assert.deepEqual(couplingRow(recL), expected);
  assert.deepEqual(couplingRow(recR), expected); // press direction does not change learned couplings
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/mapping-record.test.js`
Expected: FAIL — cannot find module `../src/ui/mapping-record.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/mapping-record.js`:

```js
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
  return rec.tags[j] || 'none';
}

// Live position of every plate: the active plate moves by deltaI, with-plates follow
// it, opposite-plates mirror it, untagged plates stay at baseline.
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
  row[rec.active] = 1;
  for (const j of Object.keys(rec.tags)) {
    row[+j] = rec.tags[j] === 'with' ? 1 : -1;
  }
  return row;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/mapping-record.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/mapping-record.js test/mapping-record.test.js
git commit -m "feat(mapping-record): recording core — baseline, live positions, coupling row"
```

---

## Task 3: recording interactions — drag/tag sync & validation (`mapping-record.js`)

**Files:**
- Modify: `src/ui/mapping-record.js`
- Test: `test/mapping-record.test.js`

The live-linked editing operations: set/flip the active direction, toggle a tag by clicking, infer a tag from dragging another plate, set the press direction from dragging the active plate, and validate that no recorded move pushes a plate past an edge.

- [ ] **Step 1: Write the failing tests**

Add to the import block at the top of `test/mapping-record.test.js` (extend the existing `from '../src/ui/mapping-record.js'` import):

```js
import {
  suggestedDeltaI,
  clampStep,
  createRecording,
  tagOf,
  positionsOf,
  couplingRow,
  setActiveDir,
  toggleTag,
  dragActive,
  dragOther,
  validRecording,
} from '../src/ui/mapping-record.js';
```

Then add these tests:

```js
test('setActiveDir normalizes to ±1 and does not mutate the input rec', () => {
  const rec = createRecording([2, 4], 0); // deltaI +1
  const flipped = setActiveDir(rec, -5);
  assert.equal(flipped.deltaI, -1);
  assert.equal(rec.deltaI, 1); // original untouched
  assert.equal(setActiveDir(rec, 3).deltaI, 1);
});

test('toggleTag sets, flips, and clears a plate tag immutably', () => {
  let rec = createRecording([4, 4], 0);
  rec = toggleTag(rec, 1, 'with');
  assert.equal(tagOf(rec, 1), 'with');
  rec = toggleTag(rec, 1, 'opposite'); // different kind -> switch
  assert.equal(tagOf(rec, 1), 'opposite');
  rec = toggleTag(rec, 1, 'opposite'); // same kind -> clear
  assert.equal(tagOf(rec, 1), 'none');
});

test('dragActive sets the press direction from the drag sign; baseline drag keeps it', () => {
  const rec = createRecording([4, 4], 0); // deltaI +1
  assert.equal(dragActive(rec, 5).deltaI, 1);  // dragged up -> Left press
  assert.equal(dragActive(rec, 3).deltaI, -1); // dragged down -> Right press
  assert.equal(dragActive(rec, 4).deltaI, 1);  // back to baseline -> unchanged (a press is always ±1)
});

test('dragOther infers with/opposite/none relative to the active direction, clamped ±1', () => {
  const rec = createRecording([4, 4, 4], 0); // deltaI +1
  assert.equal(tagOf(dragOther(rec, 1, 5), 1), 'with');     // +1 matches deltaI
  assert.equal(tagOf(dragOther(rec, 1, 3), 1), 'opposite'); // -1 opposes deltaI
  assert.equal(tagOf(dragOther(rec, 1, 4), 1), 'none');     // back to baseline -> untagged
  assert.equal(tagOf(dragOther(rec, 1, 7), 1), 'with');     // dragged far -> clamped to +1 -> with
});

test('dragOther flips its sense when the active direction is Right (deltaI -1)', () => {
  const rec = { baseline: [4, 4], active: 0, deltaI: -1, tags: {} };
  assert.equal(tagOf(dragOther(rec, 1, 3), 1), 'with');     // -1 matches deltaI -1
  assert.equal(tagOf(dragOther(rec, 1, 5), 1), 'opposite'); // +1 opposes deltaI -1
});

test('validRecording rejects a move that would push a plate past an edge', () => {
  // active plate 0 at the MAX edge, pressed Left (+1) -> would land on 8.
  const offBoard = { baseline: [7, 4], active: 0, deltaI: 1, tags: {} };
  assert.equal(validRecording(offBoard), false);
  // a with-plate at the edge pushed off:
  const tagOff = { baseline: [4, 7], active: 0, deltaI: 1, tags: { 1: 'with' } };
  assert.equal(validRecording(tagOff), false);
  // an in-bounds recording is valid:
  assert.equal(validRecording(createRecording([4, 4, 4], 0, { 1: 'with', 2: 'opposite' })), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/mapping-record.test.js`
Expected: FAIL — the five new exports are not functions.

- [ ] **Step 3: Write minimal implementation**

Append to `src/ui/mapping-record.js`:

```js
// Set/flip the active plate's press direction (a press is always ±1).
export function setActiveDir(rec, deltaI) {
  return { ...rec, deltaI: deltaI < 0 ? -1 : 1 };
}

// Click a with/opposite button: set it, switch to the other kind, or clear it.
export function toggleTag(rec, j, kind) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/mapping-record.test.js`
Expected: PASS (all Task 2 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/mapping-record.js test/mapping-record.test.js
git commit -m "feat(mapping-record): drag/tag sync interactions and edge validation"
```

---

## Task 4: coaching message (`coaching.js`)

**Files:**
- Create: `src/ui/coaching.js`
- Test: `test/coaching.test.js`

Derive, from live positions alone, the list of slides sitting on an edge and the coaching sentence shown above the suggestion.

- [ ] **Step 1: Write the failing tests**

Create `test/coaching.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePlates, coachingMessage } from '../src/ui/coaching.js';

test('edgePlates lists only plates on pin 1 or 7, with their position', () => {
  assert.deepEqual(edgePlates([4, 7, 2, 1]), [
    { plate: 1, pos: 7 },
    { plate: 3, pos: 1 },
  ]);
  assert.deepEqual(edgePlates([2, 4, 6]), []); // all interior
});

test('coachingMessage reports the safe state when nothing is on an edge', () => {
  assert.match(coachingMessage([2, 4, 6]), /safe to probe freely/i);
});

test('coachingMessage names the edge slides and uses singular for one', () => {
  const msg = coachingMessage([4, 7, 4]);
  assert.match(msg, /1 slide on the edge/i);
  assert.match(msg, /P2 \(pin 7\)/);
  assert.match(msg, /toward center/i);
});

test('coachingMessage uses plural and lists all edge slides', () => {
  const msg = coachingMessage([1, 4, 7]);
  assert.match(msg, /2 slides on the edge/i);
  assert.match(msg, /P1 \(pin 1\)/);
  assert.match(msg, /P3 \(pin 7\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/coaching.test.js`
Expected: FAIL — cannot find module `../src/ui/coaching.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/coaching.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/coaching.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/coaching.js test/coaching.test.js
git commit -m "feat(coaching): live edge-coaching message from positions"
```

---

## Task 5: wire live positions + synchronized recording into `app.js`

**Files:**
- Modify: `src/ui/app.js`

This task replaces the frozen `state.rel` map with a live `state.rec` recording object, makes the mapping board draggable (clamped to ±1 via the recording helpers), keeps the with/opposite buttons in sync with the drag, and — the key fix — **commits the recorded positions to `state.positions` on Save**. No new automated tests (this is DOM glue over the modules tested in Tasks 1–4); verify in the browser at the end.

Make these exact edits. Each `old` snippet is unique in the file.

- [ ] **Step 1: Add the module imports**

Find the solver import near the top:

```js
import { solve } from '../solver.js';
```

Replace with:

```js
import { solve, applySequence } from '../solver.js';
import {
  createRecording, tagOf, positionsOf, couplingRow,
  toggleTag, dragActive, dragOther,
} from './mapping-record.js';
import { coachingMessage } from './coaching.js';
```

- [ ] **Step 2: Seed the recording in `suggestDefault`**

Replace the body of `suggestDefault` (currently ends with the two `state.activePlate` / `state.rel` lines):

```js
  state.activePlate = next;
  state.rel = next == null ? {} : relFromMapping(next);
}
```

with:

```js
  state.activePlate = next;
  state.rec = next == null ? null : createRecording(state.positions, next, relFromMapping(next));
}
```

- [ ] **Step 3: Commit recorded positions in `saveActivePlate`**

Replace the whole `saveActivePlate` function:

```js
function saveActivePlate() {
  const a = state.activePlate;
  const row = state.mapping.coupling[a].map(() => 0);
  row[a] = 1; // the plate moves itself, by definition
  for (const j of Object.keys(state.rel)) row[+j] = state.rel[j] === 'with' ? 1 : -1;
  state.mapping.coupling[a] = row;
  state.mapping.status[a] = 'done';
  suggestDefault();
}
```

with:

```js
function saveActivePlate() {
  const rec = state.rec;
  if (!rec) return;
  state.mapping.coupling[rec.active] = couplingRow(rec);
  state.positions = positionsOf(rec); // commit the live, recorded positions
  state.mapping.status[rec.active] = 'done';
  suggestDefault(); // re-seed the next recording against the new positions
}
```

- [ ] **Step 4: Add the mapping-board drag handler**

Just above `onDragPosition` (the comment block starting `// Positions are set by dragging slides…`), add:

```js
// Mapping-stage board drag. Unlike the free Setup/Solve drag, every press moves at most
// one slot (the recording helpers clamp): dragging the active plate sets its press
// direction, dragging any other plate tags it with/opposite. Positions stay tentative
// in state.rec until Save commits them — the board can't silently drift.
//
// Affordance split (no board.js change needed): board.js attaches the drag handler to
// the *slide* (tray + holes) and calls e.preventDefault() on pointerdown, which suppresses
// the synthetic click — so dragging the slide records and never selects. The row *label*
// carries the select-plate action only, so clicking a label chooses which plate to record.
// In short: click a label to select, drag a slide to record. board.js fires onSetPosition
// once with the start position on pointerdown; for an untagged plate that is a no-op
// (dragOther with delta 0), and for a tagged plate it re-affirms the existing tag, so a
// pointerdown never destroys a tag.
function onMapDrag(i, pos) {
  const rec = state.rec;
  if (!rec) return;
  state.rec = i === rec.active ? dragActive(rec, pos) : dragOther(rec, i, pos);
  render();
}
```

- [ ] **Step 5: Drive the rel buttons and board from `state.rec` in `mappingView`**

(a) Remove the stale `state.rel` initializer. Find, inside `mappingView`:

```js
  const m = state.mapping;
  if (state.rel == null) state.rel = {};
  if (state.activePlate === undefined) suggestDefault();
```

Replace with:

```js
  const m = state.mapping;
  if (state.activePlate === undefined) suggestDefault();
```

(b) Read tags from the recording. Find the `rowsRight` mapping:

```js
    const r = state.rel[i];
    return `<div class="rel">
      <span class="rel-btn ${r === 'with' ? 'on-with' : ''}" data-action="set-rel" data-plate="${i}" data-rel="with">Moves with</span>
      <span class="rel-btn ${r === 'opposite' ? 'on-opp' : ''}" data-action="set-rel" data-plate="${i}" data-rel="opposite">Moves opposite</span>
    </div>`;
```

Replace with:

```js
    const r = state.rec ? tagOf(state.rec, i) : 'none';
    return `<div class="rel">
      <span class="rel-btn ${r === 'with' ? 'on-with' : ''}" data-action="set-rel" data-plate="${i}" data-rel="with">Moves with</span>
      <span class="rel-btn ${r === 'opposite' ? 'on-opp' : ''}" data-action="set-rel" data-plate="${i}" data-rel="opposite">Moves opposite</span>
    </div>`;
```

(c) Show live recorded positions on the board and make it draggable. Find the end of `mappingView`:

```js
  // labels go green once a plate is saved
  const labels = state.positions.map((p, i) => `<b${m.status[i] === 'done' ? ' class="done"' : ''}>P${i + 1}</b> · ${p}`);
  createBoard(boardHost, { positions: state.positions, selectable: true, highlightPlate: active, labels, rowsRight });
  return col;
```

Replace with:

```js
  // While recording, the board shows the tentative live positions (baseline + the press
  // and its coupled shifts); committed positions are unchanged until Save.
  const boardPositions = state.rec ? positionsOf(state.rec) : state.positions;
  // labels go green once a plate is saved
  const labels = boardPositions.map((p, i) => `<b${m.status[i] === 'done' ? ' class="done"' : ''}>P${i + 1}</b> · ${p}`);
  createBoard(boardHost, {
    positions: boardPositions,
    selectable: true,
    draggable: active != null,
    onSetPosition: onMapDrag,
    highlightPlate: active,
    labels,
    rowsRight,
  });
  return col;
```

- [ ] **Step 6: Update the click handlers to use `state.rec`**

(a) `select-plate` — find:

```js
    case 'select-plate': {
      const p = +t.dataset.plate;
      state.activePlate = p;
      state.rel = relFromMapping(p);
      break;
    }
```

Replace with:

```js
    case 'select-plate': {
      const p = +t.dataset.plate;
      state.activePlate = p;
      state.rec = createRecording(state.positions, p, relFromMapping(p));
      break;
    }
```

(b) `set-rel` — find:

```js
    case 'set-rel': {
      const p = +t.dataset.plate;
      const r = t.dataset.rel;
      if (state.rel[p] === r) delete state.rel[p];
      else state.rel[p] = r;
      break;
    }
```

Replace with:

```js
    case 'set-rel':
      if (state.rec) state.rec = toggleTag(state.rec, +t.dataset.plate, t.dataset.rel);
      break;
```

(c) Clear the recording on the two mapping entry points. Find (in `start-mapping`):

```js
      state.activePlate = undefined;
      state.rel = {};
      state.stage = 'discovery';
      suggestDefault();
```

Replace with:

```js
      state.activePlate = undefined;
      state.rec = null;
      state.stage = 'discovery';
      suggestDefault();
```

And in the `goto-stage` handler, find:

```js
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; suggestDefault(); }
```

Replace with:

```js
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; state.rec = null; suggestDefault(); }
```

- [ ] **Step 7: Confirm no `state.rel` references remain**

Run: `grep -n "state.rel" src/ui/app.js`
Expected: no output (every use migrated to `state.rec`). If any remain, migrate them the same way (tags live in `state.rec.tags`, read via `tagOf`).

- [ ] **Step 8: Run the full test suite (no regressions)**

Run: `node --test`
Expected: PASS for all files. (No app.js unit tests exist; this confirms the modules and the rest of the suite are green.)

- [ ] **Step 9: Manual browser verification**

Start the static server and exercise the mapping flow:

```bash
python3 scripts/serve.py
```

Open the served URL, then: Setup a 3-plate lock → **Start mapping**. Verify:
0. Clicking a row **label** selects that plate to record (active highlight moves); dragging a **slide** records without changing the selection. (This is the label-selects / slide-records split.)
1. The active (suggested) plate is highlighted and the board is draggable.
2. Dragging the active plate one slot left/right flips its direction; coupled plates follow on re-render. Dragging more than one slot clamps to one.
3. Clicking **Moves with / Moves opposite** for another plate moves that slider one slot the matching way; dragging that plate instead lights up the matching button. The two stay in sync.
4. **Save plate ›** turns the plate green **and the board positions stay where the recording left them** (they no longer snap back to the start) — confirm by reading the position numbers in the row labels before and after Save.

- [ ] **Step 10: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(mapping-ui): live draggable positions and synchronized drag/tag recording"
```

---

## Task 6: wire the Done/Skip plan panel and coaching line into `app.js`

**Files:**
- Modify: `src/ui/app.js`

Render the `{type:'plan', moves}` suggestion as an ordered list with **Done / Skip** buttons, show the live coaching line above the suggestion, and handle Done (apply the sequence to positions), Skip (dismiss for the current positions), and implicit-skip (starting a mapping action never fabricates a position change — already true, since positions only change on Save or Done). No new automated tests (DOM glue over `applySequence`/`coachingMessage`, both tested); verify in the browser.

- [ ] **Step 1: Render coaching + the plan panel in `mappingView`**

Find the suggestion HTML block:

```js
  const suggestHtml =
    suggestion && suggestion.type === 'probe' && suggestion.plate !== active
      ? `<div class="muted" style="margin-top:6px">Suggested: <b style="color:var(--gold)">${plateLabel(
          suggestion.plate
        )}</b> ${suggestion.safe ? '✓ safe to press' : '⚠ may jam at an edge'}
        <span class="ap-btn" data-action="select-plate" data-plate="${suggestion.plate}" style="margin-left:6px">Select ›</span></div>`
      : '';
```

Replace with:

```js
  const suggestHtml =
    suggestion && suggestion.type === 'probe' && suggestion.plate !== active
      ? `<div class="muted" style="margin-top:6px">Suggested: <b style="color:var(--gold)">${plateLabel(
          suggestion.plate
        )}</b> ${suggestion.safe ? '✓ safe to press' : '⚠ may jam at an edge'}
        <span class="ap-btn" data-action="select-plate" data-plate="${suggestion.plate}" style="margin-left:6px">Select ›</span></div>`
      : '';
  // Live edge coaching, recomputed from committed positions every render.
  const coachHtml = done ? '' : `<div class="coach muted" style="margin-top:6px">${coachingMessage(state.positions)}</div>`;
  // The edge-clearing plan (tier 2 of recommendNext), rendered as a Done/Skip panel.
  // A Skip is remembered against the current positions so it stays dismissed until the
  // board changes (Save, or a Done'd move); any position change re-offers it.
  const planPending =
    suggestion && suggestion.type === 'plan' && state.skipPlanKey !== state.positions.join(',');
  const planHtml = planPending
    ? `<div class="plan-suggest" style="margin-top:6px">
        <div class="muted">${suggestion.reason}</div>
        <div style="margin:4px 0;color:#fff">${suggestion.moves
          .map((mv) => `${plateLabel(mv.plate)} <span class="dir">${dirArrow(mv.dir)} ${DIR_WORD[mv.dir]}</span>`)
          .join(' · ')}</div>
        <span class="ap-btn primary" data-action="plan-done">Done ›</span>
        <span class="ap-btn" data-action="plan-skip">Skip</span>
       </div>`
    : '';
```

- [ ] **Step 2: Insert the coaching + plan HTML into the header card**

Find:

```js
  head.innerHTML = `<div class="ap-h">${title}</div>${headBody}${suggestHtml}`;
```

Replace with:

```js
  head.innerHTML = `<div class="ap-h">${title}</div>${headBody}${coachHtml}${suggestHtml}${planHtml}`;
```

- [ ] **Step 3: Add the Done / Skip click handlers**

Find:

```js
    case 'save-next': saveActivePlate(); break;
```

Replace with:

```js
    case 'save-next': saveActivePlate(); break;

    case 'plan-done': {
      // Apply the known edge-clearing sequence to the live positions, then re-seed.
      const rec = allMapped(state.mapping) ? null : recommendNext(state.positions, state.mapping);
      if (rec && rec.type === 'plan') {
        state.positions = applySequence(state.positions, state.mapping.coupling, rec.moves);
        state.skipPlanKey = undefined; // positions changed; future plans are fresh
        suggestDefault();
      }
      break;
    }
    case 'plan-skip':
      state.skipPlanKey = state.positions.join(','); // dismiss until positions change
      break;
```

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `node --test`
Expected: PASS for all files.

- [ ] **Step 5: Manual browser verification**

```bash
python3 scripts/serve.py
```

Build a scenario that produces a plan suggestion: map at least one plate whose known move can pull another plate off an edge (e.g. map a plate, then drag the board into a state where an unmapped plate sits on pin 1/7 and the mapped plate can shift it inward — the recommender's tier 2 fires when no probe is guaranteed-safe but a known move clears an edge). Verify:
1. The coaching line lists the slides on the edge and updates live as edges clear; it reads "safe to probe freely" when none are on an edge.
2. When a plan is offered, the Done/Skip panel shows the ordered known moves.
3. **Done** advances the board positions by the whole sequence (read the row-label positions before/after) and the panel resolves.
4. **Skip** leaves positions unchanged and dismisses the panel; it reappears only after positions next change.
5. Starting to map a plate (select/drag/Save) while a plan is pending never changes positions on its own (implicit skip): only Save commits the recording, only Done applies a plan.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(mapping-ui): Done/Skip edge-clearing panel and live coaching line"
```

---

## Self-Review Notes

- **Spec coverage:**
  - *Foundation — live/draggable positions, clamped ±1* → Task 2 (`clampStep`, `positionsOf`) + Task 5 (draggable board, `onMapDrag`, board shows `positionsOf`).
  - *Recording — synchronized drag + tag, both affordances live-linked* → Task 2/3 (`createRecording`, `tagOf`, `couplingRow`, `setActiveDir`, `toggleTag`, `dragActive`, `dragOther`) + Task 5 (rel buttons + drag both drive `state.rec`).
  - *Drag clamp to baseline ± 1* → `clampStep` (Task 2), applied in `dragActive`/`dragOther` (Task 3).
  - *Save advances `state.positions`* → Task 5 Step 3 (`state.positions = positionsOf(rec)`).
  - *Edge-clearing planner surfaced with Done/Skip* → Task 1 (`applySequence`) + Task 6 (panel + handlers). The planner itself (`planEdgeClear`, `recommendNext` tier 2) shipped in Plan 1.
  - *Done applies the sequence; Skip leaves positions; implicit Skip on starting a mapping* → Task 6 Step 3 (Done = `applySequence`, Skip = dismiss-key) and the invariant that positions change only via Save/Done.
  - *Coaching panel — edge list/counts from live state* → Task 4 + Task 6 Steps 1–2.
  - *`recommendNext` ordering (at-edge first, toward-center)* → already done in Plan 1; consumed here.
  - *Migration / no storage-shape change* → no new persisted fields; `state.rec` is transient session state, `coupling`/`status`/positions persist exactly as before. Saved locks load unchanged.
  - *Validation: `|delta_i| === 1`, `|delta_j| <= 1`, reject pushing past an edge* → `clampStep` enforces the ±1 bounds; `validRecording` (Task 3) guards the edge. (`validRecording` is provided and tested; wiring a Save-time guard/warning UI is optional polish left to the implementer — the clamp already prevents the over-large-step case.)
- **Type consistency:** the `rec` shape `{baseline, active, deltaI, tags}` is identical across Tasks 2, 3, 5, 6. `deltaI ∈ {+1,-1}`, `tags[j] ∈ {'with','opposite'}`, `tagOf` returns `'none'` for absent. `couplingRow` matches the existing `relFromMapping` convention (`with→+1`, `opposite→-1`), so re-selecting a saved plate round-trips. `applySequence(positions, coupling, moves)` takes the same `moves:[{plate,dir}]` shape that `recommendNext`'s `plan` tier returns.
- **Placeholder scan:** none — every step has exact code and an exact command. The two `app.js` wiring tasks have no `node --test` unit step (consistent with the repo's untested-DOM layer); they are covered by the module tests in Tasks 1–4 plus explicit manual browser verification.

## Execution note

After all tasks land and `node --test` is green, the mapping screen tracks real positions end-to-end: drag-or-tag recording that advances the board on Save, a Done/Skip planner that keeps the model truthful, and a live coaching line — closing the staleness root cause the spec identified. The deferred jam/wiggle unsigned-connection work (`2026-06-08-jam-wiggle-unsigned-connections-deferred.md`) remains out of scope.
