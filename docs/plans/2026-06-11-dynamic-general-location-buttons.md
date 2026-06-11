# Dynamic General-location Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "General location" quick-fill buttons grow automatically to include every distinct location across the user's saved locks, merged with the 4 defaults, de-duplicated case-insensitively and sorted A–Z.

**Architecture:** Add one pure function, `generalLocations(locks)`, to the existing `src/locks-view.js` module (which already holds pure lock-derived view transforms and is unit-tested with `node --test`). `src/ui/app.js` — the browser entry, which is not unit-testable because it touches `window` — imports the function and renders its output in `namingWidgetHtml()`. No storage, data-model, or event-handler changes.

**Tech Stack:** Vanilla ES modules, `node --test` (node built-in test runner), `node:assert/strict`.

---

## File Structure

- `src/locks-view.js` — **Modify.** Add `DEFAULT_LOCATIONS` const and `generalLocations()` pure function; export both. This file already owns "flat lock array → view data" transforms (`groupLocks`, `filterLocks`, etc.), so location-button derivation belongs here.
- `test/locks-view.test.js` — **Modify.** Add unit tests for `generalLocations()`.
- `src/ui/app.js` — **Modify.** Import `generalLocations`; replace the hardcoded button array in `namingWidgetHtml()` with a call to it.

---

## Task 1: Add `generalLocations()` pure helper (TDD)

**Files:**
- Modify: `src/locks-view.js`
- Test: `test/locks-view.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the end of `test/locks-view.test.js`. Update the existing import line at the top of the file to include the two new names — change:

```js
import { groupLocks, parseSearch, matchLockContents, filterLocks, allItemNames, suggestItems } from '../src/locks-view.js';
```

to:

```js
import { groupLocks, parseSearch, matchLockContents, filterLocks, allItemNames, suggestItems, generalLocations, DEFAULT_LOCATIONS } from '../src/locks-view.js';
```

Then append these tests:

```js
const locAt = (location) => ({ location });

test('generalLocations: no locks yields the 4 defaults, sorted A–Z', () => {
  assert.deepEqual(generalLocations([]), ['New Camp', 'Old Camp', 'Orc Camp', 'Swamp Camp']);
});

test('generalLocations: a custom location sorts among the defaults', () => {
  const out = generalLocations([locAt('Castle')]);
  assert.deepEqual(out, ['Castle', 'New Camp', 'Old Camp', 'Orc Camp', 'Swamp Camp']);
});

test('generalLocations: de-dups a saved location against a default case-insensitively, default casing wins', () => {
  const out = generalLocations([locAt('old camp')]);
  assert.deepEqual(out, ['New Camp', 'Old Camp', 'Orc Camp', 'Swamp Camp']);
  assert.ok(out.includes('Old Camp'));
  assert.ok(!out.includes('old camp'));
});

test('generalLocations: de-dups two custom locations case-insensitively, first-seen casing wins', () => {
  const out = generalLocations([locAt('Castle'), locAt('castle')]);
  assert.equal(out.filter((l) => l.toLowerCase() === 'castle').length, 1);
  assert.ok(out.includes('Castle'));
});

test('generalLocations: ignores empty, whitespace, and missing locations', () => {
  const out = generalLocations([locAt(''), locAt('   '), locAt(undefined), {}]);
  assert.deepEqual(out, ['New Camp', 'Old Camp', 'Orc Camp', 'Swamp Camp']);
});

test('generalLocations: trims surrounding whitespace on custom locations', () => {
  const out = generalLocations([locAt('  Castle  ')]);
  assert.ok(out.includes('Castle'));
  assert.ok(!out.includes('  Castle  '));
});

test('generalLocations: DEFAULT_LOCATIONS holds the 4 camps in canonical casing', () => {
  assert.deepEqual(DEFAULT_LOCATIONS, ['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/locks-view.test.js`
Expected: FAIL — `generalLocations` / `DEFAULT_LOCATIONS` are `undefined` (e.g. "generalLocations is not a function" or a SyntaxError about the import binding not being exported).

- [ ] **Step 3: Write the minimal implementation**

In `src/locks-view.js`, add the following. Place `DEFAULT_LOCATIONS` near the other module constants at the top (e.g. just below `const OTHER_LABEL = 'Other';`), and place the `generalLocations` function next to `groupLocks` (both are flat-lock-array transforms):

```js
// The built-in quick-fill locations, in display (canonical) casing. Saved locks that
// match one of these case-insensitively reuse this casing rather than their own.
export const DEFAULT_LOCATIONS = ['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp'];

// Merge the default quick-fill locations with every distinct, non-empty location used
// across saved locks. De-duplicated case-insensitively (a default's canonical casing
// wins; otherwise first-seen casing wins), sorted A–Z case-insensitively. Pure: takes
// the lock array in, returns names out — no DOM, no storage.
export function generalLocations(locks, defaults = DEFAULT_LOCATIONS) {
  const byKey = new Map();
  for (const name of defaults) byKey.set(name.toLowerCase(), name);
  for (const l of locks) {
    const name = String(l?.location ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/locks-view.test.js`
Expected: PASS — all new `generalLocations` tests and the existing tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(locations): derive General-location list from saved locks"
```

---

## Task 2: Render the dynamic buttons in the naming widget

**Files:**
- Modify: `src/ui/app.js` (import at line ~17; `namingWidgetHtml()` at lines ~767–772)

There is no unit test for this task: `src/ui/app.js` imports `window.localStorage` at module load (`const store = window.localStorage;`), so it cannot be imported under `node --test`. Verification is by running the app (final step) plus the full suite to confirm nothing regressed.

- [ ] **Step 1: Add `generalLocations` to the existing locks-view import**

In `src/ui/app.js`, change the import on line ~17 from:

```js
import { groupLocks, parseSearch, filterLocks, allItemNames, suggestItems } from '../locks-view.js';
```

to:

```js
import { groupLocks, parseSearch, filterLocks, allItemNames, suggestItems, generalLocations } from '../locks-view.js';
```

- [ ] **Step 2: Replace the hardcoded button array in `namingWidgetHtml()`**

In `src/ui/app.js`, inside `namingWidgetHtml()`, replace this block (lines ~768–772):

```js
    <div class="fill-row">
      ${['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp']
        .map((loc) => `<button class="ap-btn loc-fill${nm.location === loc ? ' primary' : ''}" data-action="loc-fill" data-loc="${loc}">${loc}</button>`)
        .join('')}
    </div>
```

with:

```js
    <div class="fill-row">
      ${generalLocations(loadLocks(store))
        .map((loc) => `<button class="ap-btn loc-fill${nm.location === loc ? ' primary' : ''}" data-action="loc-fill" data-loc="${escapeHtml(loc)}">${escapeHtml(loc)}</button>`)
        .join('')}
    </div>
```

Note: `loadLocks`, `store`, and `escapeHtml` are all already in scope in this file (`loadLocks` imported at line 14, `store` defined at line 20, `escapeHtml` used on the adjacent input at line 773). User-provided locations may contain quotes or HTML, so both the `data-loc` attribute and the label are now `escapeHtml`-wrapped; the browser un-escapes the attribute before the `loc-fill` handler reads `t.dataset.loc`, so the existing toggle logic is unaffected.

- [ ] **Step 3: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS — the whole suite (including `locks-view.test.js`) passes. `app.js` has no unit tests, so this only confirms nothing else broke.

- [ ] **Step 4: Verify in the running app**

Launch the app (use the `/run` skill or the project's documented dev command) and check the "General location" row on the Lock-creation screen and the saved-lock editor:
1. With no saved locks, exactly the 4 default camps appear, sorted A–Z (New, Old, Orc, Swamp).
2. Create/save a lock with a new free-text location (e.g. "Castle"); on the next render of the naming widget a "Castle" button appears, sorted into place.
3. The button matching the current `nm.location` shows the `primary` highlight.
4. Saving a lock whose location is `old camp` (lowercase) does **not** produce a second button — only the canonical "Old Camp" remains.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(locations): render dynamic General-location buttons in naming widget"
```

---

## Self-Review Notes

- **Spec coverage:** Defaults seeding (Task 1, Step 3) ✓; derive distinct locations from saved locks ✓; case-insensitive de-dup with default casing preserved ✓ (tested); A–Z sort ✓ (tested); ignore empty/whitespace ✓ (tested); render via `namingWidgetHtml()` with `escapeHtml` ✓ (Task 2); no handler/storage/data-model changes ✓; typed-but-unsaved location getting no button is the natural consequence of reading `loadLocks(store)` and needs no code.
- **Placeholders:** none — all code shown in full.
- **Type/name consistency:** `generalLocations` and `DEFAULT_LOCATIONS` are used with identical names and signatures across Task 1 (definition + tests) and Task 2 (import + call).
