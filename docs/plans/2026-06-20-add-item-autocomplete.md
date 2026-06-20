# Add-item Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each item-name input in the contents editor a typeahead dropdown that suggests item names from across all saved locks, matching the existing Search-contents box.

**Architecture:** Two new pure helpers in `src/locks-view.js` (`otherItemNames`, `itemSuggestions`) wrap the existing `allItemNames`/`suggestItems`. `src/ui/app.js` renders a per-row `.ls-suggest` dropdown inside the shared `contentsEditorHtml`, and drives it through the existing `input`/`keydown`/`mousedown`/`focusout` listeners using a single `state.contentSuggest = { row, sel }`, with a surgical dropdown refresh that never calls `render()` (so focus/caret survive). A small CSS rule positions the dropdown.

**Tech Stack:** Vanilla ES modules, `node --test` unit tests, custom Chromium e2e harness (`e2e/`).

---

### Task 1: Pure helper `otherItemNames(items, skipIndex)`

The lowercased set of the *other* rows' item names — passed as `suggestItems`'s `alreadyChosen` so a name already added to the lock isn't suggested, while the row being typed never filters itself.

**Files:**
- Modify: `src/locks-view.js` (add after `suggestItems`, ~line 150)
- Test: `test/locks-view.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/locks-view.test.js` (and add `otherItemNames, itemSuggestions` to the import on line 3):

```js
test('otherItemNames: lowercased set of other rows, excludes the skipped row and blanks', () => {
  const items = [{ item: 'Gold' }, { item: 'Iron Ore' }, { item: '' }, { item: 'gold' }];
  // Skipping index 0: the other non-blank names, lowercased and deduped.
  assert.deepEqual([...otherItemNames(items, 0)].sort(), ['gold', 'iron ore']);
  // Skipping index 1: index 0 and 3 are both "gold".
  assert.deepEqual([...otherItemNames(items, 1)].sort(), ['gold']);
});

test('otherItemNames: single row yields an empty set; tolerates missing item', () => {
  assert.deepEqual([...otherItemNames([{ item: 'Gold' }], 0)], []);
  assert.deepEqual([...otherItemNames([{}, { item: 'Gold' }], 1)], []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/locks-view.test.js`
Expected: FAIL — `otherItemNames is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Add to `src/locks-view.js` after `suggestItems`:

```js
// The lowercased names of every row EXCEPT `skipIndex`, blanks dropped — used to keep
// the autocomplete from suggesting an item already added to the lock being edited.
export function otherItemNames(items, skipIndex) {
  const out = new Set();
  (items || []).forEach((c, i) => {
    if (i === skipIndex) return;
    const name = String(c && c.item != null ? c.item : '').trim().toLowerCase();
    if (name) out.add(name);
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/locks-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(locks-view): otherItemNames helper for add-item autocomplete"
```

---

### Task 2: Pure helper `itemSuggestions(names, value, otherNames, limit)`

Wraps `suggestItems` for the single-field case (the whole input value is the token) and drops a suggestion that exactly equals the typed value, so the dropdown never just echoes a completed name.

**Files:**
- Modify: `src/locks-view.js` (add after `otherItemNames`)
- Test: `test/locks-view.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/locks-view.test.js`:

```js
test('itemSuggestions: whole value is the token; substring match, sorted', () => {
  const names = ['Iron Ore', 'Ore chunk', 'Gold'];
  assert.deepEqual(itemSuggestions(names, 'ore', new Set()), ['Iron Ore', 'Ore chunk']);
});

test('itemSuggestions: suppresses an exact (case-insensitive) match of the value', () => {
  const names = ['Gold', 'Gold bar'];
  // Typing the full name "gold" should still offer "Gold bar" but not echo "Gold".
  assert.deepEqual(itemSuggestions(names, 'gold', new Set()), ['Gold bar']);
});

test('itemSuggestions: empty/blank value yields nothing; excludes otherNames', () => {
  assert.deepEqual(itemSuggestions(['Gold'], '   ', new Set()), []);
  assert.deepEqual(itemSuggestions(['Gold', 'Gold bar'], 'gold', new Set(['gold bar'])), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/locks-view.test.js`
Expected: FAIL — `itemSuggestions is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/locks-view.js` after `otherItemNames`:

```js
// Suggestions for a single item-name field: the whole trimmed value is the token.
// Reuses suggestItems, then drops a name identical to what's already typed (nothing
// left to complete). `otherNames` excludes items already on the lock.
export function itemSuggestions(names, value, otherNames, limit = 8) {
  const token = String(value ?? '').trim();
  if (!token) return [];
  const exact = token.toLowerCase();
  return suggestItems(names, token, otherNames, limit).filter((n) => n.toLowerCase() !== exact);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/locks-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(locks-view): itemSuggestions helper for add-item autocomplete"
```

---

### Task 3: Render per-row dropdown in `contentsEditorHtml`

Wrap each item input so a dropdown can sit under it, and give each a per-row container id. The dropdown body is filled for the active row only.

**Files:**
- Modify: `src/ui/app.js` — import (top), `contentsEditorHtml` (~1007-1019), add helpers near the search helpers (~1170-1223)

- [ ] **Step 1: Add imports and state default**

In `src/ui/app.js`, add `allItemNames, otherItemNames, itemSuggestions` to the existing import from `../locks-view.js` (the import that already brings in `suggestItems`). Then, near where other ephemeral UI state is initialised (alongside `state.searchSel` / `state.suggestOpen`), add:

```js
state.contentSuggest = state.contentSuggest || { row: null, sel: -1 };
```

- [ ] **Step 2: Add the suggestion helpers**

Add near the existing search helpers (after `suggestDropdownHtml`, ~line 1223) in `src/ui/app.js`:

```js
// Item-name autocomplete for the contents editor. Pool is every saved lock's items
// (the in-progress success-screen lock contributes nothing yet, which is fine).
function contentSuggestPool() {
  return allItemNames(loadLocks(store));
}

// Suggestions for one editor row — [] unless that row's dropdown is the open one.
function contentSuggestions(rowIndex) {
  if (!state.contentSuggest || state.contentSuggest.row !== rowIndex) return [];
  const arr = activeContents() || [];
  const value = arr[rowIndex] ? arr[rowIndex].item : '';
  return itemSuggestions(contentSuggestPool(), value, otherItemNames(arr, rowIndex));
}

// The .ls-opt rows for a given editor row, reusing the search dropdown markup/classes.
function contentSuggestDropdownHtml(rowIndex) {
  const sugg = contentSuggestions(rowIndex);
  if (!sugg.length) return '';
  const sel = state.contentSuggest ? state.contentSuggest.sel : -1;
  return sugg
    .map((name, i) =>
      `<div class="ls-opt${i === sel ? ' sel' : ''}" data-action="pick-content-suggest" data-i="${rowIndex}" data-value="${escapeHtml(name)}">${escapeHtml(name)}</div>`
    )
    .join('');
}

// Surgical refresh of one row's dropdown — never calls render(), so focus/caret stay.
function refreshContentSuggest(rowIndex) {
  const sg = document.getElementById(`ct-suggest-${rowIndex}`);
  if (sg) sg.innerHTML = contentSuggestDropdownHtml(rowIndex);
}
```

- [ ] **Step 3: Wrap the item input in `contentsEditorHtml`**

Replace the `.ct-item` input line (currently line 1012) so it is wrapped and followed by a per-row dropdown container:

```js
        <div class="ct-item-wrap">
          <input class="ct-item" type="text" autocomplete="off" data-action="content-item" data-i="${i}" placeholder="Item…" value="${escapeHtml(c.item || '')}" />
          <div id="ct-suggest-${i}" class="ls-suggest">${contentSuggestDropdownHtml(i)}</div>
        </div>
```

(The `.ct-qty`, `.ct-del`, and `＋ Add item` lines are unchanged.)

- [ ] **Step 4: Verify nothing is broken yet**

Run: `node --test`
Expected: PASS (no behavioural test yet; this confirms the module still parses/loads).

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(contents): render per-row autocomplete dropdown in the item editor"
```

---

### Task 4: Wire the editor's input/keyboard/mouse/blur events

Open and drive the dropdown from the existing listeners, mirroring the search box.

**Files:**
- Modify: `src/ui/app.js` — `input` listener (~2792-2803), `mousedown` listener (~2816-2826), `keydown` listener (~2830-2858), `focusout` listener (~2861-2866)

- [ ] **Step 1: Open the dropdown on item input**

In the `input` listener's `content-item`/`content-qty` branch, after the existing `if (ctItem) row.item = e.target.value; ... persistContents(); refreshLiveShare();`, add — only when it was the item field that changed:

```js
    if (ctItem) {
      const i = +ctItem.dataset.i;
      state.contentSuggest = { row: i, sel: -1 };
      refreshContentSuggest(i);
    }
    return;
```

(Place this so it runs for `ctItem` but not `ctQty`; the `return` already present stays.)

- [ ] **Step 2: Pick a suggestion on mousedown**

In the `mousedown` listener, extend the selector and handling. Change the closest() selector to also match the new action, and branch on it:

```js
appEl.addEventListener('mousedown', (e) => {
  const t = e.target.closest('[data-action="pick-suggest"], [data-action="clear-search"], [data-action="pick-content-suggest"]');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.action === 'pick-content-suggest') {
    const i = +t.dataset.i;
    const arr = activeContents();
    if (arr && arr[i]) { arr[i].item = t.dataset.value; persistContents(); refreshLiveShare(); }
    state.contentSuggest = { row: null, sel: -1 };
    const input = appEl.querySelector(`.ct-item[data-i="${i}"]`);
    if (input) input.value = t.dataset.value;
    refreshContentSuggest(i);
    if (input) input.focus();
    return;
  }
  if (t.dataset.action === 'pick-suggest') applySuggestion(t.dataset.value);
  else { state.lockSearch = ''; state.searchSel = -1; }
  state.suggestOpen = true;
  refreshSearchView();
  const box = document.getElementById('lock-search');
  if (box) box.focus();
});
```

- [ ] **Step 3: Keyboard nav within an item input**

Add a new `keydown` listener (next to the search one) in `src/ui/app.js`:

```js
// Keyboard within a contents item input: arrows move the highlight, Enter accepts it,
// Esc closes. Global solve/setup shortcuts already bail on INPUT targets.
appEl.addEventListener('keydown', (e) => {
  const item = e.target.closest && e.target.closest('.ct-item');
  if (!item) return;
  const i = +item.dataset.i;
  if (!state.contentSuggest || state.contentSuggest.row !== i) return;
  const sugg = contentSuggestions(i);
  if (e.key === 'ArrowDown' && sugg.length) {
    e.preventDefault();
    state.contentSuggest.sel = (state.contentSuggest.sel + 1) % sugg.length;
    refreshContentSuggest(i);
  } else if (e.key === 'ArrowUp' && sugg.length) {
    e.preventDefault();
    state.contentSuggest.sel = (Math.max(state.contentSuggest.sel, 0) - 1 + sugg.length) % sugg.length;
    refreshContentSuggest(i);
  } else if (e.key === 'Enter') {
    if (state.contentSuggest.sel >= 0 && state.contentSuggest.sel < sugg.length) {
      e.preventDefault();
      const arr = activeContents();
      if (arr && arr[i]) { arr[i].item = sugg[state.contentSuggest.sel]; persistContents(); refreshLiveShare(); }
      state.contentSuggest = { row: null, sel: -1 };
      item.value = arr && arr[i] ? arr[i].item : item.value;
      refreshContentSuggest(i);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    state.contentSuggest = { row: null, sel: -1 };
    refreshContentSuggest(i);
  }
});
```

- [ ] **Step 4: Close on blur**

Extend the existing `focusout` listener (or add a sibling) so leaving an item input closes its dropdown:

```js
appEl.addEventListener('focusout', (e) => {
  const item = e.target.closest && e.target.closest('.ct-item');
  if (!item) return;
  const i = +item.dataset.i;
  if (state.contentSuggest && state.contentSuggest.row === i) {
    state.contentSuggest = { row: null, sel: -1 };
    refreshContentSuggest(i);
  }
});
```

- [ ] **Step 5: Run unit tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(contents): wire add-item autocomplete events (type/pick/keys/blur)"
```

---

### Task 5: Position the dropdown (CSS)

Reuse `.ls-suggest`/`.ls-opt`; only the wrapper needs positioning.

**Files:**
- Modify: `css/styles.css` (near the `.ct-row` / `.ct-item` rules)

- [ ] **Step 1: Add the wrapper rule**

Find the `.ct-row` / `.ct-item` block in `css/styles.css`. Add:

```css
.ct-item-wrap { position: relative; flex: 1 1 auto; min-width: 0; }
.ct-item-wrap .ct-item { width: 100%; }
.ct-item-wrap .ls-suggest { z-index: 30; }
```

Confirm `.ct-item` previously carried the flex/width that made it fill the row; the wrapper now owns that role (the input fills the wrapper). If `.ct-item` had `flex: 1 ...`, move that flex onto `.ct-item-wrap` and leave the input at `width: 100%` as above.

- [ ] **Step 2: Visual check in the app**

Run the dev server and open the contents editor (solve a lock, or edit a saved lock). Type into an item field; confirm the dropdown appears under the input, above the next row, and is clickable.

Run: `npm start` (or the project's dev-server command from `package.json` / `e2e` harness, e.g. a static server on the repo root). Manually verify, then stop the server.

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "style(contents): position the add-item autocomplete dropdown"
```

---

### Task 6: End-to-end coverage

Mirror the existing `e2e/photos.js` shape: seed a saved lock with a known item, open the contents editor, type a prefix, assert the dropdown shows the item, pick it, and assert the row filled and persisted; assert an already-added item is not offered.

**Files:**
- Create: `e2e/add-item-autocomplete.js`
- Reference: `e2e/photos.js` (server bootstrap + `Driver`), `e2e/harness.js`, `e2e/locks.js`

- [ ] **Step 1: Write the e2e script**

Create `e2e/add-item-autocomplete.js` following `e2e/photos.js`'s structure (same `waitForServer`, `spawn` dev server on a free PORT, `launchChromium`, `Driver`, `check`/`failures` pattern). The scenario:

1. Seed `localStorage` with two saved locks via the app's storage (or import), one containing an item named `Gold ingot`.
2. Navigate to the saved-lock editor for the *other* lock (click its ✎), or use the success screen — whichever the harness reaches most directly.
3. Add a row (`[data-action="content-add"]`), focus the `.ct-item` input, type `gold`.
4. Assert `#ct-suggest-<i>` contains an `.ls-opt` whose text is `Gold ingot`.
5. Click that `.ls-opt` (dispatch `mousedown`); assert the `.ct-item` value is now `Gold ingot` and that reloading the page preserves it in the lock's contents.
6. Add a second row, type `gold` again; assert `Gold ingot` is NOT offered (already added), confirming `otherItemNames` exclusion.

Use the same DOM-evaluation helpers the photos e2e uses (`driver.eval(...)` / page evaluate) to read `.ls-opt` text and input values.

- [ ] **Step 2: Run the e2e**

Run: `node e2e/add-item-autocomplete.js`
Expected: exits 0, prints no `[FAIL]` lines.

- [ ] **Step 3: Run the full unit suite once more**

Run: `node --test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/add-item-autocomplete.js
git commit -m "test(contents): e2e for add-item autocomplete suggest/pick/persist/exclude"
```

---

### Task 7: Changelog + version bump

Follow the repo convention (see commit `1a653f6` "changelog entry + version bump").

**Files:**
- Modify: the changelog source (search for the existing changelog data, e.g. `grep -rn "1.5.0" src/`), `package.json` version

- [ ] **Step 1: Find the changelog source**

Run: `grep -rn "1.5.0" src/ package.json`
Identify the changelog entries array and the version field.

- [ ] **Step 2: Add an entry and bump**

Add a changelog entry describing "Autocomplete item names when recording chest contents, from items across your saved locks." Bump the version one patch/minor per the repo's convention (match how the photos entry did it).

- [ ] **Step 3: Run tests (changelog badge test may assert the latest version)**

Run: `node --test test/changelog-badge.test.js`
Expected: PASS (update the test's expected latest version if it pins one).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(contents): changelog entry + version bump for add-item autocomplete"
```

---

## Self-Review notes

- **Spec coverage:** pool/all-saved-locks (Task 3 `contentSuggestPool`), whole-value token + exclude-already-added + exact-match suppression (Tasks 1-2), per-row single dropdown via `state.contentSuggest` (Tasks 3-4), both entry points via shared `contentsEditorHtml` (Task 3), surgical refresh keeping focus (Task 3 `refreshContentSuggest`, used in Task 4), CSS reuse of `.ls-suggest` (Task 5), unit + e2e tests (Tasks 1,2,6). Changelog (Task 7) follows repo convention.
- **Naming consistency:** `state.contentSuggest = { row, sel }`, `contentSuggestPool`, `contentSuggestions`, `contentSuggestDropdownHtml`, `refreshContentSuggest`, `otherItemNames`, `itemSuggestions`, action `pick-content-suggest`, container id `ct-suggest-<i>`, wrapper `.ct-item-wrap` — used identically across all tasks.
- **Open verification points for the implementer:** exact line of `state` initialisation and the existing `../locks-view.js` import in app.js; the precise dev-server command; whether `changelog-badge.test.js` pins the latest version.
