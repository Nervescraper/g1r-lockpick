# Search Saved Locks by Chest Contents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search box to the Lock step that filters saved locks by the items their chests contain (include/exclude terms) with item-name autocomplete.

**Architecture:** All matching/suggestion logic is pure, DOM-free, and lives in `src/locks-view.js` next to `groupLocks` (unit-tested with `node --test`). The Lock-step UI in `src/ui/app.js` parses the query, filters before grouping, hides Recent and force-opens folders while searching, and drives a token-aware autocomplete dropdown. Typing never triggers a full `render()`; the list and dropdown are surgically re-rendered so the input keeps focus and caret.

**Tech Stack:** Vanilla ES modules, no framework. `node --test` for unit tests. CSS in `css/styles.css`.

**Spec:** `docs/specs/2026-06-10-search-locks-by-contents-design.md`

---

## File Structure

- **`src/locks-view.js`** (modify) — add pure functions: `parseSearch`, `matchLockContents`, `filterLocks`, `allItemNames`, `suggestItems`. `groupLocks` is unchanged.
- **`test/locks-view.test.js`** (modify) — add tests for the five new functions.
- **`src/ui/app.js`** (modify) — search UI in `lockStep`, filtering in `lockSectionsHtml`, `forceOpen` param on `lockSectionHtml`, transient `state.lockSearch`/`state.searchSel`/`state.suggestOpen`, and input/keydown/mousedown handlers. Add a changelog entry + version bump.
- **`css/styles.css`** (modify) — styles for the search row, clear button, and suggestion dropdown.

Notes for the implementer:
- The app re-renders all of `appEl` on `render()` (`appEl.innerHTML = ''`). Focus-sensitive inputs (import paste, contents item/qty, name) are updated in the `input` listener **without** calling `render()`. The search box follows that same pattern.
- `escapeHtml(s)` exists in `app.js` (around line 348) — use it for all interpolated user text and `data-value` attributes.
- The currently-loaded session lock is excluded from the list via `l.id !== state.lockId`.

---

## Task 1: `parseSearch` — split the query into include/exclude terms

**Files:**
- Modify: `src/locks-view.js`
- Test: `test/locks-view.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/locks-view.test.js`:

```js
import { parseSearch } from '../src/locks-view.js';

test('parseSearch: plain terms are includes, lowercased', () => {
  assert.deepEqual(parseSearch('Gold Sword'), { include: ['gold', 'sword'], exclude: [] });
});

test('parseSearch: leading dash makes a term exclude', () => {
  assert.deepEqual(parseSearch('gold -sword'), { include: ['gold'], exclude: ['sword'] });
});

test('parseSearch: bare dash and extra whitespace are ignored', () => {
  assert.deepEqual(parseSearch('  -  gold   -ore '), { include: ['gold'], exclude: ['ore'] });
});

test('parseSearch: empty / whitespace yields empty lists', () => {
  assert.deepEqual(parseSearch(''), { include: [], exclude: [] });
  assert.deepEqual(parseSearch('   '), { include: [], exclude: [] });
  assert.deepEqual(parseSearch(null), { include: [], exclude: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/locks-view.test.js`
Expected: FAIL — `parseSearch` is not exported / not a function.

- [ ] **Step 3: Implement `parseSearch`**

Add to `src/locks-view.js`:

```js
// Parse a search query into { include, exclude } term lists. Terms are split on
// whitespace and lowercased; a leading "-" marks an exclude term (a bare "-" is
// ignored). Pure and DOM-free, like groupLocks.
export function parseSearch(text) {
  const include = [];
  const exclude = [];
  for (const tok of String(text ?? '').toLowerCase().split(/\s+/)) {
    if (!tok) continue;
    if (tok[0] === '-') {
      const term = tok.slice(1);
      if (term) exclude.push(term);
    } else {
      include.push(tok);
    }
  }
  return { include, exclude };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/locks-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(search): parseSearch — include/exclude query parsing"
```

---

## Task 2: `matchLockContents` + `filterLocks` — the filter

**Files:**
- Modify: `src/locks-view.js`
- Test: `test/locks-view.test.js`

Matching rules: include terms are **AND** (every include term must be a substring of some item); exclude terms are **ANY** (any exclude term matching any item drops the lock). Matching is case-insensitive substring against each `contents` item's name.

- [ ] **Step 1: Write the failing tests**

Add to `test/locks-view.test.js`:

```js
import { matchLockContents, filterLocks } from '../src/locks-view.js';

const withItems = (id, ...items) => ({ id, contents: items.map((item) => ({ item, qty: 1 })) });

test('matchLockContents: include requires ALL terms (substring, case-insensitive)', () => {
  const lock = withItems('a', 'Gold nugget', 'Rusty Sword');
  assert.equal(matchLockContents(lock, parseSearch('gold sword')), true);
  assert.equal(matchLockContents(lock, parseSearch('gold axe')), false);
  assert.equal(matchLockContents(lock, parseSearch('GOLD')), true);
});

test('matchLockContents: exclude drops a lock if ANY term matches', () => {
  const lock = withItems('a', 'Gold nugget', 'Rusty Sword');
  assert.equal(matchLockContents(lock, parseSearch('-sword')), false);
  assert.equal(matchLockContents(lock, parseSearch('-axe')), true);
  assert.equal(matchLockContents(lock, parseSearch('gold -sword')), false);
});

test('matchLockContents: empty contents passes exclude-only, fails any include', () => {
  const lock = { id: 'a', contents: [] };
  assert.equal(matchLockContents(lock, parseSearch('-gold')), true);
  assert.equal(matchLockContents(lock, parseSearch('gold')), false);
  assert.equal(matchLockContents(lock, parseSearch('')), true);
});

test('filterLocks: keeps matching locks in original order', () => {
  const locks = [withItems('a', 'Gold'), withItems('b', 'Sword'), withItems('c', 'Gold', 'Sword')];
  assert.deepEqual(filterLocks(locks, parseSearch('gold')).map((l) => l.id), ['a', 'c']);
  assert.deepEqual(filterLocks(locks, parseSearch('-gold')).map((l) => l.id), ['b']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/locks-view.test.js`
Expected: FAIL — `matchLockContents` / `filterLocks` not exported.

- [ ] **Step 3: Implement both functions**

Add to `src/locks-view.js`:

```js
// True if a lock's chest contents satisfy a parsed query. Include terms are ANDed
// (each must be a substring of some item); exclude terms are ORed (any match drops it).
export function matchLockContents(lock, parsed) {
  const items = ((lock && lock.contents) || [])
    .map((c) => String(c && c.item != null ? c.item : '').toLowerCase())
    .filter(Boolean);
  for (const term of parsed.include) {
    if (!items.some((it) => it.includes(term))) return false;
  }
  for (const term of parsed.exclude) {
    if (items.some((it) => it.includes(term))) return false;
  }
  return true;
}

export function filterLocks(locks, parsed) {
  return locks.filter((l) => matchLockContents(l, parsed));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/locks-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(search): matchLockContents + filterLocks"
```

---

## Task 3: `allItemNames` + `suggestItems` — autocomplete pool & suggestions

**Files:**
- Modify: `src/locks-view.js`
- Test: `test/locks-view.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/locks-view.test.js`:

```js
import { allItemNames, suggestItems } from '../src/locks-view.js';

test('allItemNames: distinct names, case-insensitive dedupe, first-seen casing', () => {
  const locks = [withItems('a', 'Gold', '  '), withItems('b', 'gold', 'Iron Ore')];
  assert.deepEqual(allItemNames(locks), ['Gold', 'Iron Ore']);
});

test('allItemNames: tolerates missing/blank contents', () => {
  assert.deepEqual(allItemNames([{ id: 'a' }, { id: 'b', contents: [] }]), []);
});

test('suggestItems: substring match, sorted, excludes already-chosen', () => {
  const names = ['Iron Ore', 'Ore chunk', 'Gold'];
  assert.deepEqual(suggestItems(names, 'ore', new Set()), ['Iron Ore', 'Ore chunk']);
  assert.deepEqual(suggestItems(names, 'ore', new Set(['iron ore'])), ['Ore chunk']);
});

test('suggestItems: empty token yields nothing; respects the cap', () => {
  assert.deepEqual(suggestItems(['Gold'], '', new Set()), []);
  const many = Array.from({ length: 12 }, (_, i) => `Ore ${String.fromCharCode(97 + i)}`);
  assert.equal(suggestItems(many, 'ore', new Set(), 8).length, 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/locks-view.test.js`
Expected: FAIL — `allItemNames` / `suggestItems` not exported.

- [ ] **Step 3: Implement both functions**

Add to `src/locks-view.js`:

```js
// Distinct item names across all locks' contents, case-insensitively deduped while
// keeping the first-seen display casing. The autocomplete pool.
export function allItemNames(locks) {
  const seen = new Set();
  const out = [];
  for (const l of locks) {
    for (const c of (l && l.contents) || []) {
      const name = String(c && c.item != null ? c.item : '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// Suggestions for the term currently being typed: names containing `token`
// (case-insensitive substring), excluding names already chosen in the box, sorted
// alphabetically and capped. Empty token => no suggestions.
export function suggestItems(names, token, alreadyChosen, limit = 8) {
  const t = String(token ?? '').toLowerCase();
  if (!t) return [];
  const chosen = alreadyChosen instanceof Set ? alreadyChosen : new Set(alreadyChosen || []);
  return names
    .filter((n) => n.toLowerCase().includes(t) && !chosen.has(n.toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/locks-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(search): allItemNames + suggestItems for autocomplete"
```

---

## Task 4: Filter the list while searching (hide Recent, force-open folders)

**Files:**
- Modify: `src/ui/app.js`

This task wires the pure filter into rendering only — no search box yet. With `state.lockSearch` empty, behavior is identical to today; we'll verify by temporarily setting it in the console.

- [ ] **Step 1: Import the new functions**

In `src/ui/app.js`, find the existing import (line ~17):

```js
import { groupLocks } from '../locks-view.js';
```

Replace with:

```js
import { groupLocks, parseSearch, filterLocks, allItemNames, suggestItems } from '../locks-view.js';
```

- [ ] **Step 2: Add a `forceOpen` parameter to `lockSectionHtml`**

Find `lockSectionHtml` (line ~925). Change its signature and the `open` line:

```js
function lockSectionHtml(key, label, locks, forceOpen = false) {
  const open = forceOpen || sectionOpen(key);
  const caret = open ? '▼' : '▸';
  const body = open ? `<div class="lock-list">${locks.map(lockRowHtml).join('')}</div>` : '';
  return `<div class="lock-folder">
    <div class="lock-folder-h" data-action="toggle-folder" data-folder="${escapeHtml(key)}">
      <span class="lf-caret">${caret}</span>
      <span class="lf-label">${escapeHtml(label)}</span>
      <span class="lf-count">${locks.length}</span>
    </div>
    ${body}
  </div>`;
}
```

- [ ] **Step 3: Filter in `lockSectionsHtml`**

Replace the whole `lockSectionsHtml` function (line ~940) with:

```js
// The full sectioned list. With no active search: Recent (when non-empty) + one section
// per folder, using persisted open/closed state. With an active search: Recent is hidden,
// only matching locks remain, empty folders vanish, and every folder is force-opened.
function lockSectionsHtml(locks) {
  const parsed = parseSearch(state.lockSearch);
  const active = parsed.include.length > 0 || parsed.exclude.length > 0;
  if (active) {
    const filtered = filterLocks(locks, parsed);
    if (!filtered.length) return '<div class="muted">No locks match.</div>';
    const { folders } = groupLocks(filtered);
    return folders.map((f) => lockSectionHtml(f.key, f.label, f.locks, true)).join('');
  }
  const { recent, folders } = groupLocks(locks);
  const parts = [];
  if (recent.length) parts.push(lockSectionHtml(RECENT_KEY, 'Recent', recent));
  for (const f of folders) parts.push(lockSectionHtml(f.key, f.label, f.locks));
  return parts.join('');
}
```

- [ ] **Step 4: Verify unit tests still pass and the app loads**

Run: `node --test`
Expected: PASS (all suites).

Then load the app (`just dev` or open `index.html` per the project's run method). In the browser console on the Lock step with a couple of saved locks that have contents, run:

```js
// Replace with how the app exposes state if not global; otherwise verify in Task 5.
```

If `state` is not reachable from the console, defer visual verification to Task 5 (where the search box drives it). The key check here: `node --test` is green and the Lock step still renders Recent + folders unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(search): filter saved-lock list by contents (Recent hidden, folders open)"
```

---

## Task 5: Search box + autocomplete UI and handlers

**Files:**
- Modify: `src/ui/app.js`

Adds the input, clear button, suggestion dropdown, and all event wiring. Transient state (`state.lockSearch`, `state.searchSel`, `state.suggestOpen`) is never persisted — do **not** add it to `saveSession`.

- [ ] **Step 1: Add token/suggestion helpers**

Add these helpers in `src/ui/app.js` near `lockSectionsHtml`:

```js
// The locks offered in the Load list (everything except the current session lock).
function currentLockList() {
  return loadLocks(store).filter((l) => l.id !== state.lockId);
}

// The trailing run of non-space chars: the term the user is currently typing
// (includes a leading "-" if present). Empty when the field ends in a space.
function currentToken(text) {
  const m = String(text ?? '').match(/(\S*)$/);
  return m ? m[1] : '';
}

// Lowercased remainders of every term EXCEPT the one being typed — so a name already
// in the box isn't suggested again.
function chosenTermSet() {
  const text = state.lockSearch || '';
  const endsSpace = /\s$/.test(text);
  const all = text.split(/\s+/).filter(Boolean);
  const committed = endsSpace ? all : all.slice(0, -1);
  return new Set(committed.map((t) => (t[0] === '-' ? t.slice(1) : t).toLowerCase()).filter(Boolean));
}

// Suggestions for the current token, or [] when the dropdown is closed / token empty.
function currentSuggestions() {
  if (state.suggestOpen === false) return [];
  const tok = currentToken(state.lockSearch);
  const term = tok[0] === '-' ? tok.slice(1) : tok;
  if (!term) return [];
  return suggestItems(allItemNames(currentLockList()), term, chosenTermSet());
}

// Replace the current token with the chosen name (preserving a leading "-") and append a
// space so the next term can be typed.
function applySuggestion(value) {
  const text = state.lockSearch || '';
  const tok = currentToken(text);
  const dash = tok[0] === '-' ? '-' : '';
  const head = text.slice(0, text.length - tok.length);
  state.lockSearch = head + dash + value + ' ';
  state.searchSel = -1;
}
```

- [ ] **Step 2: Add the search-bar and dropdown HTML builders**

Add near the helpers above:

```js
function suggestDropdownHtml() {
  const sugg = currentSuggestions();
  if (!sugg.length) return '';
  return sugg
    .map((name, i) =>
      `<div class="ls-opt${i === state.searchSel ? ' sel' : ''}" data-action="pick-suggest" data-value="${escapeHtml(name)}">${escapeHtml(name)}</div>`
    )
    .join('');
}

function searchBarHtml() {
  const q = state.lockSearch || '';
  return `<div class="lock-search">
    <input id="lock-search" class="ls-input" type="text" autocomplete="off"
      placeholder="Search contents…  e.g. gold -sword" data-action="search-input"
      value="${escapeHtml(q)}" />
    <span id="lock-clear" class="ls-clear${q ? '' : ' hidden'}" data-action="clear-search" title="Clear search">✕</span>
    <div id="lock-suggest" class="ls-suggest">${suggestDropdownHtml()}</div>
  </div>`;
}

// Surgical re-render used while typing — never calls render(), so the input keeps focus
// and caret. Updates the filtered list, the dropdown, and the clear button's visibility.
function refreshSearchView() {
  const host = document.getElementById('lock-list-host');
  if (host) host.innerHTML = lockSectionsHtml(currentLockList());
  const sg = document.getElementById('lock-suggest');
  if (sg) sg.innerHTML = suggestDropdownHtml();
  const clr = document.getElementById('lock-clear');
  if (clr) clr.classList.toggle('hidden', !(state.lockSearch || '').length);
}
```

- [ ] **Step 3: Render the search bar and wrap the sections in a host**

Find the `left.innerHTML = ...` block in `lockStep` (line ~887). Replace it with:

```js
  left.innerHTML = `<div class="ap-card">
    <div class="ap-h">Load a saved lock</div>
    ${locks.length ? searchBarHtml() : ''}
    <div id="lock-list-host">${locks.length
      ? lockSectionsHtml(locks)
      : '<div class="muted">No saved locks yet — start a new one on the right →</div>'}</div>
    <div class="lock-io">
      ${allLocks.length ? '<span class="ap-btn" data-action="export-all">⬆ Export all</span>' : ''}
      <span class="ap-btn" data-action="import-open">⬇ Import</span>
    </div>
  </div>`;
```

(The `allLocks`/`locks` variables already exist just above this block — `locks` is `allLocks` minus the session lock. Leave them as-is.)

- [ ] **Step 4: Handle typing in the existing `input` listener**

In the `appEl.addEventListener('input', ...)` handler (line ~2406), add this as the FIRST check inside the callback, before the import-text block:

```js
  if (e.target.id === 'lock-search') {
    state.lockSearch = e.target.value;
    state.searchSel = -1;
    state.suggestOpen = true;
    refreshSearchView();
    return;
  }
```

- [ ] **Step 5: Guard the click handler against search clicks**

In the `appEl.addEventListener('click', ...)` `switch (a)` (line ~2001), add a case so clicking inside the input doesn't trigger a full `render()`:

```js
    case 'search-input': return;
```

Do NOT add `pick-suggest` or `clear-search` here — they are handled on `mousedown` in the next step (so selection beats the input's blur).

- [ ] **Step 6: Add a `mousedown` listener for suggestion pick + clear**

Add a new top-level listener (next to the other `appEl.addEventListener` calls, e.g. after the `input` listener):

```js
// pick-suggest / clear-search run on mousedown with preventDefault so the search box
// never loses focus (which would close the dropdown before a click could land).
appEl.addEventListener('mousedown', (e) => {
  const t = e.target.closest('[data-action="pick-suggest"], [data-action="clear-search"]');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.action === 'pick-suggest') applySuggestion(t.dataset.value);
  else { state.lockSearch = ''; state.searchSel = -1; }
  state.suggestOpen = true;
  refreshSearchView();
  const box = document.getElementById('lock-search');
  if (box) box.focus();
});
```

- [ ] **Step 7: Add a `keydown` listener for the search box (arrows / Enter / Esc)**

Add a new top-level listener:

```js
// Keyboard within the search box: arrows move the highlight, Enter accepts it, Esc closes
// the dropdown. (The global solve/setup shortcuts already bail on INPUT targets.)
appEl.addEventListener('keydown', (e) => {
  if (e.target.id !== 'lock-search') return;
  const sugg = currentSuggestions();
  if (e.key === 'ArrowDown' && sugg.length) {
    e.preventDefault();
    state.searchSel = (state.searchSel + 1) % sugg.length;
    const sg = document.getElementById('lock-suggest');
    if (sg) sg.innerHTML = suggestDropdownHtml();
  } else if (e.key === 'ArrowUp' && sugg.length) {
    e.preventDefault();
    state.searchSel = (state.searchSel - 1 + sugg.length) % sugg.length;
    const sg = document.getElementById('lock-suggest');
    if (sg) sg.innerHTML = suggestDropdownHtml();
  } else if (e.key === 'Enter') {
    if (state.searchSel >= 0 && state.searchSel < sugg.length) {
      e.preventDefault();
      applySuggestion(sugg[state.searchSel]);
      state.suggestOpen = true;
      refreshSearchView();
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    state.suggestOpen = false;
    state.searchSel = -1;
    const sg = document.getElementById('lock-suggest');
    if (sg) sg.innerHTML = '';
  }
});
```

- [ ] **Step 8: Close the dropdown when the box loses focus**

Add a new top-level listener:

```js
appEl.addEventListener('focusout', (e) => {
  if (e.target.id !== 'lock-search') return;
  state.suggestOpen = false;
  const sg = document.getElementById('lock-suggest');
  if (sg) sg.innerHTML = '';
});
```

- [ ] **Step 9: Verify in the browser**

Run: `node --test`
Expected: PASS (all suites).

Then run the app (project's normal method, e.g. `just dev` / open `index.html`). With several saved locks carrying contents:
- Type `gold` → only locks whose contents include "gold" show; Recent is gone; folders are expanded; counts match.
- Type `gold -sword` → locks with gold but not sword.
- A nonsense term → "No locks match."
- Start typing an item name → dropdown of matching item names appears; ↓/↑ highlight, Enter inserts it with a trailing space; clicking a suggestion inserts it and keeps focus.
- Type `-or` → suggestions still offered (dash stripped); selecting keeps the `-`.
- `✕` clears and restores the normal Recent + folders view.
- Focus/caret stay put while typing (no flicker/jump).

- [ ] **Step 10: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(search): search box + item-name autocomplete on the Lock step"
```

---

## Task 6: Styles for the search row and dropdown

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Add styles**

Add after the saved-lock folder header block (after the `.lock-folder .lock-list` rule, ~line 245):

```css
/* ---- saved-lock contents search ---- */
.lock-search { position: relative; margin-bottom: 10px; }
.ls-input {
  width: 100%; box-sizing: border-box; padding: 7px 28px 7px 10px;
  background: #141310; border: 1px solid #3a3833; border-radius: 6px;
  color: #e8e2d6; font-size: 13px;
}
.ls-input:focus { outline: none; border-color: var(--gold); }
.ls-clear {
  position: absolute; right: 8px; top: 7px; cursor: pointer; color: #8a8378;
  font-size: 13px; user-select: none;
}
.ls-clear:hover { color: var(--gold); }
.ls-clear.hidden { display: none; }
.ls-suggest {
  position: absolute; left: 0; right: 0; top: 100%; z-index: 20;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  margin-top: 2px; overflow: hidden;
}
.ls-suggest:empty { display: none; }
.ls-opt { padding: 6px 10px; font-size: 13px; cursor: pointer; }
.ls-opt:hover, .ls-opt.sel { background: rgba(255, 255, 255, 0.07); color: var(--gold); }
```

- [ ] **Step 2: Verify visually**

Run the app and confirm the search row, the `✕` (only when text present), and the dropdown (highlighted row on hover and on ↑/↓) look consistent with the rest of the Lock card.

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "style(search): search row, clear button, suggestion dropdown"
```

---

## Task 7: Changelog entry + version bump

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Bump the changelog version**

Find `const CHANGELOG_VERSION = '1.3.0';` (line ~28) and change it to:

```js
const CHANGELOG_VERSION = '1.4.0';
```

- [ ] **Step 2: Add a changelog entry**

Insert a new entry as the FIRST element of the `CHANGELOG` array (line ~31), before the existing `2026-06-09` entry:

```js
  {
    date: '2026-06-10',
    items: [
      'Search your saved locks by what’s inside them: type an item to show only chests that contain it, or prefix a term with “-” to hide chests that have it (e.g. “gold -sword”). Item names autocomplete from everything across your saved locks.',
    ],
  },
```

- [ ] **Step 3: Verify**

Run: `node --test`
Expected: PASS.

Load the app: the Changelog button shows a "New" badge, and the modal lists the new entry at the top.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js
git commit -m "chore(changelog): announce contents search (1.4.0)"
```

---

## Final verification

- [ ] Run the full suite: `node --test` → all green.
- [ ] Manual smoke test of every bullet in Task 5 Step 9.
- [ ] Confirm `state.lockSearch` is NOT persisted: type a query, reload the page → the box is empty and the full list returns.
- [ ] Confirm no regression to the no-search view: Recent + collapsed folders behave exactly as before when the box is empty.

---

## Spec coverage check

- Include/exclude parsing, AND/ANY semantics, substring, empty-contents rules → Tasks 1–2.
- Autocomplete pool + token-aware substring suggestions, exclude already-chosen, cap → Task 3, wired in Task 5.
- Recent hidden during search, folders force-open, empty folders gone, "No locks match", filtered counts → Task 4.
- Search box, clear button, dropdown, keyboard nav, focus/caret preservation, ephemeral (non-persisted) state → Task 5.
- Styling → Task 6.
- Changelog → Task 7.
