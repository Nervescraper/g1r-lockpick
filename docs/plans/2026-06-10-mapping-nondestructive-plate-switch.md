# Non-destructive Plate Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make switching the active plate in mapping mode non-destructive, so a stray tap (or any plate-hop) no longer discards the in-progress tags/direction of the plate you were recording.

**Architecture:** Cache each *touched* tentative recording in a per-plate map (`state.recDrafts`). Stash the current recording when switching away; restore it when switching back, but **only if its `baseline` still matches the live `state.positions`** — any committed move invalidates the snapshot and forces a fresh recording. The restore/guard decision is two pure functions in `mapping-record.js` (unit-tested); `app.js` is thin glue around them.

**Tech Stack:** Vanilla ES modules, `node:test` + `node:assert/strict` (run via `npm test` → `node --test`). No build step, no new dependencies.

**Spec:** `docs/specs/2026-06-10-mapping-nondestructive-plate-switch-design.md`

---

## File Structure

- **Modify** `src/ui/mapping-record.js` — add two pure exports: `samePositions(a, b)` and `restorableDraft(drafts, plate, positions)`. This file already owns the recording data shape and its pure operations.
- **Modify** `test/mapping-record.test.js` — unit tests for the two new functions.
- **Modify** `src/ui/app.js` — wire the draft cache into `seedRecording` (stash + guarded restore), drop a draft in `saveActivePlate`, reset the cache on the two mapping-entry transitions. These are DOM-coupled and not import-testable; covered by keeping the suite green + manual verification.

Why the split: the real decisions (equality, guard) live in pure, tested functions. `app.js` only orchestrates module-level `state`, matching the existing pattern where `app.js` carries no unit tests and pure logic lives in sibling modules.

---

## Task 1: `samePositions` pure helper

**Files:**
- Modify: `src/ui/mapping-record.js` (append a new export)
- Test: `test/mapping-record.test.js`

- [ ] **Step 1: Write the failing test**

Add to the end of `test/mapping-record.test.js`. First add `samePositions` to the existing import block at the top (lines 3-15), so the import line becomes:

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
  samePositions,
} from '../src/ui/mapping-record.js';
```

Then append the test:

```js
test('samePositions: true only when arrays are element-wise equal', () => {
  assert.equal(samePositions([4, 7, 2], [4, 7, 2]), true);
  assert.equal(samePositions([4, 7, 2], [4, 7, 3]), false);
  assert.equal(samePositions([4, 7], [4, 7, 2]), false); // different lengths
  assert.equal(samePositions([], []), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `samePositions` import is `undefined`, the new test throws (e.g. "samePositions is not a function").

- [ ] **Step 3: Write minimal implementation**

Append to `src/ui/mapping-record.js` (after `validRecording`, around line 95):

```js
// True when two position arrays are element-wise equal. Used to decide whether a stashed
// recording draft is still valid for the current board (a committed move changes positions).
export function samePositions(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/mapping-record.js test/mapping-record.test.js
git commit -m "feat(mapping): samePositions helper for draft validity checks"
```

---

## Task 2: `restorableDraft` guarded-restore helper

**Files:**
- Modify: `src/ui/mapping-record.js` (append a new export)
- Test: `test/mapping-record.test.js`

- [ ] **Step 1: Write the failing test**

Add `restorableDraft` to the import block in `test/mapping-record.test.js` (alongside `samePositions` from Task 1):

```js
  validRecording,
  samePositions,
  restorableDraft,
} from '../src/ui/mapping-record.js';
```

Append the tests:

```js
test('restorableDraft: returns the draft when its baseline matches current positions', () => {
  const draft = createRecording([4, 7, 2], 0); // baseline [4,7,2]
  const drafts = { 0: draft };
  assert.equal(restorableDraft(drafts, 0, [4, 7, 2]), draft);
});

test('restorableDraft: returns null when positions have changed (stale baseline)', () => {
  const draft = createRecording([4, 7, 2], 0);
  const drafts = { 0: draft };
  assert.equal(restorableDraft(drafts, 0, [4, 7, 3]), null); // board moved since stash
});

test('restorableDraft: returns null when no draft exists for the plate', () => {
  assert.equal(restorableDraft({}, 2, [4, 4, 4]), null);
  assert.equal(restorableDraft(undefined, 2, [4, 4, 4]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `restorableDraft` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/ui/mapping-record.js`, immediately after `samePositions`:

```js
// A stashed draft is restorable only if it exists AND its baseline still matches the live
// board. Any committed move (Save, apply-move, jam) changes positions and invalidates every
// stale draft, so switching back to such a plate builds a fresh recording instead.
export function restorableDraft(drafts, plate, positions) {
  const d = drafts && drafts[plate];
  if (d && samePositions(d.baseline, positions)) return d;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/mapping-record.js test/mapping-record.test.js
git commit -m "feat(mapping): restorableDraft guard for non-destructive plate switching"
```

---

## Task 3: Stash + guarded restore in `seedRecording`

**Files:**
- Modify: `src/ui/app.js:286-296` (`seedRecording`)
- Modify: `src/ui/app.js` import of `mapping-record.js` (add the two new names)

No new unit test: `seedRecording` reads/writes module-level `state` and is not import-testable. It is exercised by the existing suite (which must stay green) and the manual check in Task 6. Its real logic now lives in the Task 1–2 pure functions.

- [ ] **Step 1: Add the new imports**

Find the existing import from `'./mapping-record.js'` in `src/ui/app.js` and add `samePositions` is NOT needed here — only `restorableDraft`. Add `restorableDraft` to that import list. For example if the line reads:

```js
import { createRecording, relFromMapping /* … existing names … */ } from './mapping-record.js';
```

(the actual list will differ — `createRecording`, `setActiveDir`, `positionsOf`, `couplingRow`, `validRecording`, `tagOf`, `toggleTag`, `dragActive`, `dragOther` are used in app.js) add `restorableDraft` to it:

```js
import { /* … existing names … */, restorableDraft } from './mapping-record.js';
```

Verify with: `grep -n "from './mapping-record.js'" src/ui/app.js`

- [ ] **Step 2: Replace `seedRecording` with the stash/restore version**

Replace the whole function at `src/ui/app.js:286-296`:

```js
function seedRecording(plate) {
  state.recDrafts ??= {};
  // Switching away is non-destructive: stash the current recording if the player has
  // touched it, so a stray tap (or any plate-hop) can be recovered by switching back.
  if (state.recTouched && Number.isInteger(state.activePlate)) {
    state.recDrafts[state.activePlate] = state.rec;
  }
  state.activePlate = plate;
  if (plate == null) {
    state.rec = null;
    state.recTouched = false;
    return;
  }
  // Restore a previously stashed draft for this plate, but only if it's still valid for the
  // current board (restorableDraft enforces the baseline === positions guard).
  const draft = restorableDraft(state.recDrafts, plate, state.positions);
  if (draft) {
    state.rec = draft;
    state.recTouched = true; // a restored draft is, by definition, work in progress
    return;
  }
  // Fresh recording (unchanged from the original behaviour).
  state.rec = createRecording(state.positions, plate, relFromMapping(plate));
  state.recTouched = false;
  if (suggestEnabled()) {
    const rec = recommendNext(state.positions, state.mapping, blockedNow(), softLinksSet());
    if (rec && rec.type === 'probe' && rec.plate === plate) {
      state.rec = setActiveDir(state.rec, rec.dir === 'L' ? 1 : -1);
    }
  }
}
```

Note: the original guarded the suggestion block with `if (state.rec && suggestEnabled())`. Here that block is only reached on the fresh-recording path where `state.rec` was just assigned a non-null recording, so the `state.rec &&` check is redundant and dropped.

- [ ] **Step 3: Run the full suite to verify no regression**

Run: `npm test`
Expected: PASS — all existing tests still green (this change adds behaviour, removes none).

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(mapping): stash and restore tentative recordings on plate switch"
```

---

## Task 4: Drop the draft on save

**Files:**
- Modify: `src/ui/app.js:311-322` (`saveActivePlate`)

- [ ] **Step 1: Clear the committed plate's draft before re-seeding**

In `saveActivePlate`, change the tail of the function (currently lines 320-321):

```js
  state.knownLinks = (state.knownLinks || []).filter((k) => !k.startsWith(`${rec.active}|`));
  suggestDefault(); // re-seed the next recording against the new positions
```

to:

```js
  state.knownLinks = (state.knownLinks || []).filter((k) => !k.startsWith(`${rec.active}|`));
  // This row is committed truth now — discard its tentative draft, and mark the recording
  // clean so the upcoming re-seed doesn't re-stash the just-saved work.
  state.recTouched = false;
  if (state.recDrafts) delete state.recDrafts[rec.active];
  suggestDefault(); // re-seed the next recording against the new positions
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(mapping): drop a plate's draft once it is saved"
```

---

## Task 5: Reset the draft cache on mapping entry

**Files:**
- Modify: `src/ui/app.js` — `start-mapping` case (~line 1985) and `goto-stage`→discovery branch (~line 2002)

Resets the cache when (re)entering the mapping stage so tentative work never leaks across separate mapping sessions. (The baseline guard already makes leaks inert, but an explicit reset keeps state clean and predictable.)

- [ ] **Step 1: Reset on `start-mapping`**

In the `case 'start-mapping':` block, find:

```js
      state.activePlate = undefined;
      state.rec = null;
      state.stage = 'discovery';
```

and insert the reset:

```js
      state.activePlate = undefined;
      state.rec = null;
      state.recDrafts = {};
      state.stage = 'discovery';
```

- [ ] **Step 2: Reset on `goto-stage`→discovery**

In the `case 'goto-stage':` block, find the discovery branch:

```js
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; state.rec = null; state.driftReport = undefined; suggestDefault(); }
```

and add `state.recDrafts = {};`:

```js
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; state.rec = null; state.recDrafts = {}; state.driftReport = undefined; suggestDefault(); }
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(mapping): reset draft cache when entering the mapping stage"
```

---

## Task 6: Manual verification in the running app

**Files:** none (verification only)

`seedRecording`, `onMapClick`, and the board live behind the DOM, so verify the end-to-end behaviour by hand. This is the acceptance gate for the spec's behavioural claims.

- [ ] **Step 1: Launch the app**

Use the project's normal run path (see `/run` or the project README). Open the lock, reach the **Map the lock** (discovery) stage with at least 3 plates.

- [ ] **Step 2: Stash + restore round-trip (the core fix)**

1. Select plate A (tap it). Tag another plate (drag it, or use the With/Opposite buttons) so A's recording is *touched*.
2. Tap plate B (simulate the stray tap) — A's row switches away.
3. Tap plate A again.
4. **Expect:** A's tag/direction are exactly as you left them; the board preview reflects them. (Before this change, they would be gone.)

- [ ] **Step 3: Guard invalidates after a move**

1. Select plate A, tag a plate (touch it).
2. Save a *different* fully-tagged plate, or apply a known move, so `state.positions` changes.
3. Return to plate A.
4. **Expect:** A starts from a *fresh* recording (no stale restored tags), since its draft's baseline no longer matches the board.

- [ ] **Step 4: Untouched recordings are not pinned**

1. Select plate A but make no edits.
2. Switch to B, then back to A.
3. **Expect:** A shows the normal fresh/suggested recording (nothing odd restored).

- [ ] **Step 5: Save clears the draft**

1. Tag and **Save** plate A.
2. Later, return to plate A (e.g. via re-edit).
3. **Expect:** A reflects the committed mapping, not a leftover tentative draft.

- [ ] **Step 6: Full suite green + finish**

Run: `npm test`
Expected: PASS — entire suite green.

If all manual checks pass, the feature is complete. Consider following up with `superpowers:finishing-a-development-branch` to decide how to integrate the work.

---

## Self-Review Notes

- **Spec coverage:** `recDrafts` field (Tasks 3/5), stash-on-switch-away (Task 3), guarded restore (Tasks 2/3), drop-on-save (Task 4), `samePositions` helper (Task 1), all 5 spec test cases (Tasks 1–2 unit + Task 6 manual #2–5). The "no time buffer" non-goal needs no task. ✅
- **Type consistency:** `restorableDraft(drafts, plate, positions)` and `samePositions(a, b)` signatures match between definition (Tasks 1–2), tests, and the app.js call site (Task 3). Recording shape (`baseline`/`active`/`deltaI`/`tags`) is unchanged. ✅
- **Placeholder scan:** every code step shows complete code; no TBD/TODO. The one import-list edit (Task 3 Step 1) is intentionally described against the actual existing list rather than guessed verbatim, with a `grep` to confirm. ✅
