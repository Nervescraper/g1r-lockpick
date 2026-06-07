# Saved Lock list: folder organization

**Date:** 2026-06-07
**Status:** Approved

## Goal

Organize the Saved Lock list (the left column of the **Lock** step) into
expand/collapse sections instead of one flat list:

- A **Recent** section showing the last 5 saved locks, **expanded by default**.
- One **folder per General Location**, each **collapsed by default**.
- Locks with no General Location collapse into an **"Other"** folder.
- Only folders that actually contain saved locks are shown.
- A lock in **Recent also still appears** inside its location folder (Recent is a
  shortcut view, not a move).
- Each section's expanded/collapsed state **persists across reloads**.

## Current state

- Saved locks render in `lockStep()` (`src/ui/app.js`) as a flat
  `<div class="lock-list">` mapping `loadLocks(store)` through `lockRowHtml()`.
- The currently-loaded lock is filtered out of the list (`l.id !== state.lockId`).
- Lock records have **no timestamp** — they sit in array insertion order
  (`storage.js`, `locks.push`). "Last 5 saved" therefore needs a real save time.
- Settings already persist via `loadSettings`/`saveSettings`; the `collapseCycles`
  toggle (`app.js`) is the established pattern for a persisted UI toggle.

## Design

### 1. Data model: `updatedAt`

Add an optional `updatedAt` field (epoch milliseconds, a number) to lock records,
stamped on **every** save.

- There are four `saveLock` call sites in `app.js`: autosave (`syncLock`), contents
  edit, import-fresh, and import-conflict ("keep both"). All four funnel through one
  helper so stamping can't drift:

  ```js
  const stamp = (lock) => ({ ...lock, updatedAt: Date.now() });
  ```

- Imported locks **keep their existing `updatedAt`** when present (it reflects when
  they were really saved); if absent, they are stamped at import time.
- `isValidLock` in `storage.js` gains an optional check: if `updatedAt` is present it
  must be a finite number; absent is valid. Records predating this change sort last in
  Recent until their next save bumps them.

This keeps `storage.js` free of ambient time — the caller supplies the clock, matching
the existing `exportLocks(locks, exportedAt)` convention.

### 2. Grouping: new pure module `src/locks-view.js`

`app.js` is already ~1430 lines and the codebase favors small, independently testable
units. The pure transform lives in its own module:

```js
groupLocks(locks) => {
  recent: Lock[],                      // up to 5
  folders: [{ key, label, locks }]     // one per distinct location
}
```

Rules:

- **recent**: the up-to-5 locks with the greatest `updatedAt`, descending. Locks with
  no `updatedAt` sort last (after all dated ones), preserving their relative array
  order as a stable tiebreak.
- **folders**: grouped by `location` string.
  - Blank/whitespace-only location → the **"Other"** folder.
  - Folder `label` is the location string ("Other" for the blank bucket).
  - Folder `key` is the raw location string, or the sentinel for Other (see §4).
  - Folders sorted alphabetically, case-insensitive, with **"Other" always last**.
  - Within a folder, locks sorted by `updatedAt` descending (undated last).
  - Only non-empty folders are emitted.
- A lock appears in **both** `recent` and its folder (no removal).

`groupLocks` takes the already-filtered list (current lock excluded) — filtering stays
in `app.js`, so the module is pure data-in/data-out.

### 3. Rendering: collapsible sections in `lockStep()`

The flat `<div class="lock-list">` is replaced by a stack of collapsible sections,
each a clickable header plus a body:

```
▼ Recent                 (5)
   [lock rows…]
▸ Khorinis Harbor        (3)
▸ Old Camp               (7)
▸ Other                  (2)
```

- **Recent** renders first, only when it has at least one lock.
- Each header shows the label, a count badge, and a ▼ (open) / ▸ (closed) caret.
- Each body reuses the **existing `lockRowHtml()` unchanged**, so load / share / edit /
  delete keep working identically.
- A header carries `data-action="toggle-folder"` and `data-folder="<key>"`.
- The no-locks-at-all empty state keeps the current
  "No saved locks yet — start a new one" message.
- The `<div class="lock-io">` export/import row below the list is unchanged.

### 4. Persistence: `settings.lockFolders`

Store only **explicit user overrides**, in the existing settings object:

```js
settings.lockFolders = { "Old Camp": true, "__recent__": false, ... }
```

- Default when a key is absent: **Recent → open**, every folder → **closed**. A fresh
  user therefore sees exactly "Recent expanded, the rest collapsed."
- Section keys: `__recent__` for Recent, `__other__` for the Other bucket, the raw
  location string for a normal folder.
- The toggle handler flips the stored value, calls `saveSettings(store, settings)`, and
  re-renders — identical in shape to the existing `collapseCycles` handler.

### 5. CSS

A small number of rules in `css/` for the folder header (caret, count badge, hover,
`cursor: pointer`), reusing existing color variables. The lock rows themselves are
unchanged.

## Testing

- `test/locks-view.test.js` (new):
  - Recent caps at 5 and orders by `updatedAt` desc.
  - Undated locks sort after dated ones (in Recent and in folders).
  - Blank location lands in **Other**; Other sorts last among folders.
  - Folders sorted alphabetically, case-insensitive.
  - A recent lock also appears in its folder (dup-in-both).
  - Empty input → empty `recent` and empty `folders`.
- `test/storage.test.js` (extend):
  - `updatedAt` present-and-numeric is valid; absent is valid; non-number rejected.
- Run with `npm test` (`node --test`).

## Out of scope

- Renaming / reordering folders manually (folders derive purely from location).
- Drag-and-drop between folders.
- Nested folders or multi-level grouping.
- Changing how locks are named, shared, imported, or exported.
