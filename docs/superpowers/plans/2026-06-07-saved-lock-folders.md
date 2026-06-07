# Saved Lock Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize the Saved Lock list into a Recent section (last 5 saved, expanded by default) plus one collapsible folder per General Location (collapsed by default), with collapse state persisted.

**Architecture:** Add an `updatedAt` timestamp to lock records (stamped on every in-app save, preserved on import). A new pure module `src/locks-view.js` transforms the lock array into `{ recent, folders }`. `lockStep()` in `src/ui/app.js` renders collapsible sections from that structure, reusing the existing `lockRowHtml()` for each row. Collapse state lives in `settings.lockFolders` and toggles via a new `toggle-folder` action that re-renders.

**Tech Stack:** Vanilla ES modules, no framework. Tests run with `node --test` (`npm test`). DOM rendering is string/`innerHTML`-based.

---

## File Structure

- **Create:** `src/locks-view.js` — pure `groupLocks(locks)` transform (recency + folder grouping/sorting). One responsibility, no DOM, no storage.
- **Create:** `test/locks-view.test.js` — unit tests for `groupLocks`.
- **Modify:** `src/storage.js` — `isValidLock` accepts optional numeric `updatedAt`.
- **Modify:** `test/storage.test.js` — cover `updatedAt` validation.
- **Modify:** `src/ui/app.js` — stamp `updatedAt` at save sites; render collapsible sections in `lockStep()`; add `toggle-folder` action.
- **Modify:** `css/styles.css` — folder header styling (caret, count badge, hover).

---

## Task 1: `updatedAt` validation in storage

**Files:**
- Modify: `src/storage.js` (function `isValidLock`, ~line 152)
- Test: `test/storage.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/storage.test.js` (the imports already include `parseImport`; these tests exercise validation through `parseImport`, which calls `isValidLock`):

```js
test('parseImport: accepts a lock with a numeric updatedAt', () => {
  const env = { format: 'g1r-locks', version: 1, locks: [{ id: 'a', n: 3, updatedAt: 1700000000000 }] };
  const out = parseImport(JSON.stringify(env));
  assert.equal(out.locks.length, 1);
  assert.equal(out.invalidCount, 0);
});

test('parseImport: accepts a lock with no updatedAt', () => {
  const env = { format: 'g1r-locks', version: 1, locks: [{ id: 'a', n: 3 }] };
  const out = parseImport(JSON.stringify(env));
  assert.equal(out.locks.length, 1);
});

test('parseImport: rejects a lock whose updatedAt is not a number', () => {
  const env = { format: 'g1r-locks', version: 1, locks: [{ id: 'a', n: 3, updatedAt: 'soon' }] };
  const out = parseImport(JSON.stringify(env));
  assert.equal(out.locks.length, 0);
  assert.equal(out.invalidCount, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/storage.test.js`
Expected: the "rejects ... not a number" test FAILS (the bad lock is currently accepted, so `invalidCount` is 0, not 1). The two accept tests pass already.

- [ ] **Step 3: Add the validation**

In `src/storage.js`, inside `isValidLock`, just before the final `return true;`, add:

```js
  if (l.updatedAt != null && !(typeof l.updatedAt === 'number' && Number.isFinite(l.updatedAt))) {
    return false;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/storage.test.js`
Expected: PASS (all three new tests green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js test/storage.test.js
git commit -m "feat(storage): validate optional numeric updatedAt on lock records"
```

---

## Task 2: `groupLocks` pure transform

**Files:**
- Create: `src/locks-view.js`
- Test: `test/locks-view.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/locks-view.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLocks } from '../src/locks-view.js';

const lock = (id, location, updatedAt) => ({ id, location, updatedAt });

test('groupLocks: empty input yields empty recent and folders', () => {
  const out = groupLocks([]);
  assert.deepEqual(out.recent, []);
  assert.deepEqual(out.folders, []);
});

test('groupLocks: recent holds the 5 most recent by updatedAt desc', () => {
  const locks = [1, 2, 3, 4, 5, 6, 7].map((i) => lock(`l${i}`, 'Camp', i * 1000));
  const out = groupLocks(locks);
  assert.equal(out.recent.length, 5);
  assert.deepEqual(out.recent.map((l) => l.id), ['l7', 'l6', 'l5', 'l4', 'l3']);
});

test('groupLocks: undated locks sort after dated ones in recent', () => {
  const locks = [lock('a', 'Camp', undefined), lock('b', 'Camp', 100), lock('c', 'Camp', undefined)];
  const out = groupLocks(locks);
  // dated first, then undated in original relative order
  assert.deepEqual(out.recent.map((l) => l.id), ['b', 'a', 'c']);
});

test('groupLocks: groups by location, sorted alpha, Other last', () => {
  const locks = [
    lock('a', 'Old Camp', 3),
    lock('b', 'Khorinis', 2),
    lock('c', '', 1),
  ];
  const out = groupLocks(locks);
  assert.deepEqual(out.folders.map((f) => f.label), ['Khorinis', 'Old Camp', 'Other']);
});

test('groupLocks: blank/whitespace location goes to Other with __other__ key', () => {
  const out = groupLocks([lock('a', '   ', 1), lock('b', undefined, 2)]);
  assert.equal(out.folders.length, 1);
  assert.equal(out.folders[0].label, 'Other');
  assert.equal(out.folders[0].key, '__other__');
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['b', 'a']); // updatedAt desc
});

test('groupLocks: a recent lock also appears in its folder', () => {
  const locks = [lock('a', 'Old Camp', 5)];
  const out = groupLocks(locks);
  assert.deepEqual(out.recent.map((l) => l.id), ['a']);
  assert.equal(out.folders.length, 1);
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['a']);
});

test('groupLocks: folder sort is case-insensitive', () => {
  const out = groupLocks([lock('a', 'old camp', 1), lock('b', 'Khorinis', 2)]);
  assert.deepEqual(out.folders.map((f) => f.label), ['Khorinis', 'old camp']);
});

test('groupLocks: locks within a folder are sorted updatedAt desc', () => {
  const out = groupLocks([lock('a', 'Camp', 1), lock('b', 'Camp', 3), lock('c', 'Camp', 2)]);
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['b', 'c', 'a']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/locks-view.test.js`
Expected: FAIL with "Cannot find module '../src/locks-view.js'".

- [ ] **Step 3: Write the implementation**

Create `src/locks-view.js`:

```js
// Pure transform from a flat lock array into the Saved-Lock view model:
//   { recent, folders }
// No DOM, no storage, no ambient time — easy to test in isolation.
//
// recency: locks with a numeric updatedAt sort newest-first; locks without one sort
// after all dated locks, keeping their original relative order (a stable tiebreak).

const RECENT_LIMIT = 5;
const OTHER_KEY = '__other__';
const OTHER_LABEL = 'Other';

// Comparator over the ORIGINAL array: returns a function comparing by updatedAt desc,
// with undated locks pushed last and ties broken by original index for stability.
function byRecency(locks) {
  const index = new Map(locks.map((l, i) => [l, i]));
  return (a, b) => {
    const ta = typeof a.updatedAt === 'number' ? a.updatedAt : null;
    const tb = typeof b.updatedAt === 'number' ? b.updatedAt : null;
    if (ta !== null && tb !== null && ta !== tb) return tb - ta;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    return index.get(a) - index.get(b);
  };
}

const folderLabel = (loc) => {
  const trimmed = String(loc ?? '').trim();
  return trimmed || OTHER_LABEL;
};

export function groupLocks(locks) {
  const recencyCmp = byRecency(locks);

  const recent = [...locks].sort(recencyCmp).slice(0, RECENT_LIMIT);

  // Bucket by label, preserving first-seen order; sort each bucket by recency.
  const buckets = new Map();
  for (const l of locks) {
    const label = folderLabel(l.location);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(l);
  }

  const folders = [...buckets.entries()]
    .map(([label, items]) => ({
      key: label === OTHER_LABEL ? OTHER_KEY : label,
      label,
      locks: [...items].sort(recencyCmp),
    }))
    .sort((a, b) => {
      // Other always last; otherwise case-insensitive label order.
      if (a.label === OTHER_LABEL) return 1;
      if (b.label === OTHER_LABEL) return -1;
      return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
    });

  return { recent, folders };
}

export { RECENT_LIMIT, OTHER_KEY };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/locks-view.test.js`
Expected: PASS (all eight tests green).

- [ ] **Step 5: Commit**

```bash
git add src/locks-view.js test/locks-view.test.js
git commit -m "feat(locks): groupLocks transform for Recent + location folders"
```

---

## Task 3: Stamp `updatedAt` on save

**Files:**
- Modify: `src/ui/app.js` (`syncLock` ~line 125, `persistContents` ~line 508, `runImportParse` ~line 720, `runImportApply` ~line 739)

No new unit test — these are DOM/session glue. Coverage comes from Task 2 (recency ordering) and a manual check at the end. Verify by reading the diff and the manual smoke test in Task 6.

- [ ] **Step 1: Add the in-app stamp helper**

In `src/ui/app.js`, just above `function syncLock()` (currently near line 117), add:

```js
// In-app saves always bump updatedAt to now, so re-saving moves a lock to the top of
// Recent. (Imports preserve an incoming updatedAt instead — see runImport*.)
const stamp = (lock) => ({ ...lock, updatedAt: Date.now() });
```

- [ ] **Step 2: Stamp the autosave in `syncLock`**

Wrap the object passed to `saveLock` (line 125) with `stamp(...)`. Change:

```js
  saveLock(store, {
    id: state.lockId,
    name: composeName(),
    ...
    notes: '',
  });
```

to:

```js
  saveLock(store, stamp({
    id: state.lockId,
    name: composeName(),
    ...
    notes: '',
  }));
```

(Keep the object body byte-for-byte; only the wrapping `stamp(` / `)` is added.)

- [ ] **Step 3: Stamp the contents-edit save in `persistContents`**

Change the line (currently ~508):

```js
    if (base) saveLock(store, { ...base, contents: sanitizeContents(state.contentsEdit.items) });
```

to:

```js
    if (base) saveLock(store, stamp({ ...base, contents: sanitizeContents(state.contentsEdit.items) }));
```

- [ ] **Step 4: Preserve `updatedAt` on import-fresh in `runImportParse`**

Change (currently ~720):

```js
  for (const l of fresh) { saveLock(store, l); newCount++; }
```

to:

```js
  for (const l of fresh) { saveLock(store, { ...l, updatedAt: l.updatedAt ?? Date.now() }); newCount++; }
```

- [ ] **Step 5: Preserve `updatedAt` on import-conflict copy in `runImportApply`**

Change (currently ~739):

```js
      saveLock(store, { ...c.incoming, id: `lock-${Date.now()}-${i}` });
```

to:

```js
      saveLock(store, { ...c.incoming, id: `lock-${Date.now()}-${i}`, updatedAt: c.incoming.updatedAt ?? Date.now() });
```

- [ ] **Step 6: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS (all existing tests still green; nothing references the new field yet that could break).

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(locks): stamp updatedAt on save, preserve it on import"
```

---

## Task 4: Render collapsible sections in `lockStep()`

**Files:**
- Modify: `src/ui/app.js` (imports at top; `lockStep` ~line 553; add section renderers near `lockRowHtml`)

- [ ] **Step 1: Import `groupLocks` and the keys**

At the top of `src/ui/app.js`, add an import (place it near the other `src/` imports, e.g. just after the storage import block):

```js
import { groupLocks, OTHER_KEY } from '../locks-view.js';
```

(`OTHER_KEY` is imported for symmetry/readability; `RECENT_KEY` is defined locally in Step 2 because it's a UI concern, not part of the transform.)

- [ ] **Step 2: Add the section helpers**

Immediately **above** `function lockRowHtml(l)` (~line 595), add:

```js
const RECENT_KEY = '__recent__';

// Is a section open? Recent defaults open, every folder defaults closed; only explicit
// user overrides are stored in settings.lockFolders.
function sectionOpen(key) {
  const overrides = settings.lockFolders || {};
  if (key in overrides) return overrides[key];
  return key === RECENT_KEY;
}

// One collapsible section: clickable header (caret + label + count) and, when open, the
// stack of lock rows. Reuses lockRowHtml unchanged.
function lockSectionHtml(key, label, locks) {
  const open = sectionOpen(key);
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

// The full sectioned list: Recent (when non-empty) followed by one section per folder.
function lockSectionsHtml(locks) {
  const { recent, folders } = groupLocks(locks);
  const parts = [];
  if (recent.length) parts.push(lockSectionHtml(RECENT_KEY, 'Recent', recent));
  for (const f of folders) parts.push(lockSectionHtml(f.key, f.label, f.locks));
  return parts.join('');
}
```

- [ ] **Step 3: Use the sectioned list in `lockStep`**

In `lockStep` (~line 569), replace:

```js
    ${locks.length
      ? `<div class="lock-list">${locks.map(lockRowHtml).join('')}</div>`
      : '<div class="muted">No saved locks yet — start a new one on the right →</div>'}
```

with:

```js
    ${locks.length
      ? lockSectionsHtml(locks)
      : '<div class="muted">No saved locks yet — start a new one on the right →</div>'}
```

- [ ] **Step 4: Add the toggle action handler**

In the click `switch` in `src/ui/app.js`, add a case next to the other `toggle-*` cases (after `toggle-collapse`, ~line 1297):

```js
    case 'toggle-folder': {
      const key = t.dataset.folder;
      const overrides = settings.lockFolders || (settings.lockFolders = {});
      overrides[key] = !sectionOpen(key);
      saveSettings(store, settings);
      break;
    }
```

(The switch falls through to `render()` at its end, so the re-render is automatic.)

- [ ] **Step 5: Verify the suite still passes**

Run: `npm test`
Expected: PASS (no test imports `app.js`'s DOM code directly; this guards against syntax errors via the other suites that do import shared modules — and confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): render Saved Locks as Recent + collapsible location folders"
```

---

## Task 5: Folder header styling

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Find an anchor and existing vars**

Run: `grep -n "\.lock-list\|\.lock-row\|--muted\|--line\|--accent" css/styles.css | head`
Expected: shows the existing `.lock-list` / `.lock-row` rules and confirms which color variables exist (use whatever muted/border/accent vars the file already defines; substitute them below if the names differ).

- [ ] **Step 2: Add the folder styles**

Append near the existing `.lock-list` / `.lock-row` rules in `css/styles.css` (use the project's actual variable names from Step 1 in place of the placeholders):

```css
.lock-folder { margin-bottom: 6px; }

.lock-folder-h {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
}
.lock-folder-h:hover { background: var(--hover, rgba(255, 255, 255, 0.05)); }

.lf-caret { width: 1em; color: var(--muted, #888); font-size: 0.85em; }
.lf-label { font-weight: 600; }
.lf-count {
  margin-left: auto;
  color: var(--muted, #888);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
}

/* Inset the rows so they read as belonging to the folder above them. */
.lock-folder .lock-list { margin-left: 10px; }
```

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "style(ui): folder header styling for the Saved Lock list"
```

---

## Task 6: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Serve and open the app**

Run the project's usual dev/preview command (e.g. `just dev` or open `index.html`; check `justfile`). Open the **Lock** step.

- [ ] **Step 2: Verify behavior against the spec**

Confirm each:
- With no saved locks: the "No saved locks yet" message shows.
- Save a few locks under two different General Locations, plus one with the location left blank.
- **Recent** appears first and is **expanded**; shows up to 5, newest first.
- Each location renders as its own **collapsed** folder; the blank-location lock is under **Other**, which sorts **last**.
- A lock in Recent also appears inside its location folder.
- Clicking a folder header toggles it (caret ▸/▼) and the count is correct.
- Re-saving (edit) a lock moves it to the top of Recent.
- Reload the page: the folders you opened/closed keep their state; a never-touched folder is collapsed and Recent is open.

- [ ] **Step 3: Final full-suite run**

Run: `npm test`
Expected: PASS (entire suite green).

---

## Self-Review Notes

- **Spec coverage:** updatedAt model (Task 1+3), groupLocks transform/sort/Other/dup-in-both (Task 2), collapsible render (Task 4), persistence via `settings.lockFolders` (Task 4 Step 4 + `sectionOpen`), CSS (Task 5), tests (Tasks 1–2), manual check (Task 6). All spec sections mapped.
- **Type consistency:** `groupLocks` returns `{ recent, folders:[{key,label,locks}] }` — consumed exactly that way in `lockSectionsHtml`. Keys: `__recent__` (UI-local `RECENT_KEY`), `__other__` (`OTHER_KEY` from the module), raw location otherwise — consistent across render and `sectionOpen`/`toggle-folder`.
- **Persistence default:** `sectionOpen` returns `true` only for `__recent__` when no override exists → "Recent expanded, rest collapsed" for a fresh user, matching the spec.
