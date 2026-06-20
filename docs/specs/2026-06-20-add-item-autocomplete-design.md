# Autocomplete on the add-item (contents editor) rows

**Date:** 2026-06-20
**Status:** Approved

## Goal

Give each **item-name input** in the contents editor a typeahead dropdown that
suggests item names drawn from across all saved locks — the same data, look, and
keyboard/mouse behaviour as the existing **Search contents…** box on the Lock step.

As you type an item name while recording a chest's contents, you get a dropdown of
matching item names you've used in other locks; pick one with the mouse or keyboard
to fill the row. This lands in **both** places the editor appears — the "Lock open!"
success screen and the saved-lock editor — because both render the same component.

Suggestions are an **ephemeral UI affordance**: nothing about them is persisted,
shared, or exported. They only ever fill the existing `item` field.

## Current state

- The item/quantity rows are rendered by `contentsEditorHtml(items)`
  (`src/ui/app.js`). Each row is `.ct-row` containing a `.ct-item` text input
  (`data-action="content-item"`, `data-i="<index>"`), a `.ct-qty` number input, and
  a `.ct-del` button, followed by a single `＋ Add item` button
  (`data-action="content-add"`).
- The editor is shared by two entry points, both via `contentsEditorHtml`:
  - the **success screen** after solving a lock, editing `state.contents`;
  - the **saved-lock editor** (`contentsView()`), editing
    `state.contentsEdit.items`.
  `activeContents()` returns whichever array is being edited.
- Typing in a `.ct-item` input is handled in the `input` listener
  (`src/ui/app.js`): it mutates `row.item`, calls `persistContents()` and
  `refreshLiveShare()`, and — like the other focus-preserving inputs — **does not**
  call `render()`, so the field keeps focus and caret while typing.
- Adding a row (`content-add`) pushes `{ item: '', qty: 1 }` and sets
  `state.focusContentItem` so the new input is auto-focused after the next render.
- The **search box** already implements the exact interaction we want, built on two
  pure helpers in `src/locks-view.js`:
  - `allItemNames(locks)` — every `contents` item name across `locks`, trimmed,
    blanks dropped, **case-insensitively deduped** keeping first-seen casing. The
    autocomplete pool.
  - `suggestItems(names, token, alreadyChosen, limit = 8)` — names whose lowercased
    value contains `token` (substring), excluding any in the `alreadyChosen` set,
    sorted alphabetically (case-insensitive), capped at `limit`. Empty token → `[]`.
- The search box's pool is `allItemNames(currentLockList())`, where
  `currentLockList()` is every saved lock except the current session lock.
- The search dropdown markup is `suggestDropdownHtml()` emitting `.ls-opt` rows
  (with `.sel` on the highlighted one, `data-action="pick-suggest"`,
  `data-value`), inside a `.ls-suggest` container. Search keeps focus during typing
  via `refreshSearchView()` (surgical `innerHTML` swap, never `render()`), and drives
  selection from `state.searchSel` / `state.suggestOpen`.

## Design

No new matching logic is needed: we reuse `allItemNames` and `suggestItems`
unchanged. The work is wiring per-row dropdowns into the contents editor, mirroring
the search box's event/refresh pattern.

### 1. Suggestion pool and per-row filtering

- **Pool:** `allItemNames(allLocksForSuggest())`, computed lazily when a row's
  dropdown is open.
  - `allLocksForSuggest()` returns the full saved-lock set, `loadLocks(store)`. We
    do **not** exclude the session lock here (unlike search): when recording contents
    on the success screen the lock may not be saved yet, and including all saved locks
    gives the richest pool. Self-matches are handled by the exclusion set below.
- **Token:** the **entire trimmed value** of the row's `.ct-item` input (each row is
  exactly one item — there is no multi-term tokenisation as in search). Empty/blank
  value → no dropdown.
- **Exclude already-added (per the approved decision):** build a lowercased set of
  the `item` names of **every other row** in `activeContents()` (i.e. all rows except
  the one being edited) and pass it as `alreadyChosen`. This prevents suggesting a
  name that is already a row in the lock being edited, and avoids accidental duplicate
  rows. The current row's own (partial) text is **not** in the set, so it never
  filters itself out while typing.
- A suggestion is also suppressed when it is an exact (case-insensitive) match of the
  current row's value (nothing left to complete) — naturally falls out of substring
  matching only partially, so suppress an exact full-value match explicitly to avoid a
  one-item dropdown that just echoes what's typed.

### 2. State (ephemeral, never saved)

A single object tracks which row (if any) currently owns an open dropdown and the
keyboard highlight within it:

- `state.contentSuggest = { row: <index|null>, sel: <int> }`
  - `row` — index into `activeContents()` of the row whose dropdown is open, or
    `null` when none is open.
  - `sel` — index of the highlighted suggestion (default `-1`, none).

Only the row matching `state.contentSuggest.row` ever renders a dropdown, so at most
one dropdown is visible at a time. This state is not added to `saveSession`'s
persisted set, mirroring `state.lockSearch` / `state.searchSel`.

Helper functions parallel to the search helpers, scoped to the editor:

- `contentSuggestions(rowIndex)` → `string[]` — `[]` unless
  `state.contentSuggest.row === rowIndex`; otherwise
  `suggestItems(pool, value, otherRowNames(rowIndex))` with the exact-match
  suppression from §1.
- `otherRowNames(rowIndex)` → lowercased `Set` of the other rows' item names.
- `contentSuggestDropdownHtml(rowIndex)` → the `.ls-opt` rows for that row's
  suggestions (reusing the search dropdown's markup/classes, with `.sel` at
  `state.contentSuggest.sel`), each carrying `data-action="pick-content-suggest"`,
  `data-i="<rowIndex>"`, and `data-value`.

### 3. Rendering (`contentsEditorHtml`)

- Wrap each `.ct-item` input in a relatively-positioned container (e.g.
  `.ct-item-wrap`) so an absolutely-positioned dropdown sits under it, exactly like
  `.lock-search` wraps `.ls-input` + `.ls-suggest`.
- Inside that wrapper, after the input, render a dropdown container with a
  **per-row id** — `id="ct-suggest-<i>"`, class `.ls-suggest` — whose `innerHTML` is
  `contentSuggestDropdownHtml(i)` (empty string for non-active rows). Reusing
  `.ls-suggest` / `.ls-opt` means no new dropdown CSS.
- Add `autocomplete="off"` to the `.ct-item` input so the browser's native
  autofill doesn't overlap our dropdown.
- The `.ct-qty`, `.ct-del`, and `＋ Add item` markup is unchanged.

### 4. Event handling (no full `render()` while typing)

A small surgical refresh keeps focus, mirroring `refreshSearchView` but scoped to one
row's dropdown:

- `refreshContentSuggest(rowIndex)` — replace `#ct-suggest-<rowIndex>`'s `innerHTML`
  with `contentSuggestDropdownHtml(rowIndex)`. Never calls `render()`.

Wire into the existing listeners in `src/ui/app.js`:

- **`input` on `.ct-item`** (extend the current `content-item` branch): after the
  existing `row.item = value; persistContents(); refreshLiveShare();`, set
  `state.contentSuggest = { row: i, sel: -1 }` and call
  `refreshContentSuggest(i)`. (Editing the `.ct-qty` field does not open a dropdown.)
- **`keydown` on `.ct-item`** (new branch, parallel to the search box's keydown):
  when the target is a `.ct-item` input and its row's dropdown is open with ≥1
  suggestion:
  - `↓` / `↑` move `state.contentSuggest.sel` within the suggestion list and
    `refreshContentSuggest(i)`.
  - `Enter` with a highlighted suggestion: `preventDefault`, fill the row (see pick
    action), keep focus. With no highlight, fall through (no behaviour change).
  - `Esc`: `preventDefault`, close the dropdown
    (`state.contentSuggest = { row: null, sel: -1 }`), clear the dropdown view.
  These must not collide with global solve/setup shortcuts — those already bail on
  `INPUT`/`TEXTAREA` targets.
- **`mousedown` on `pick-content-suggest`** (extend the existing `mousedown`
  listener, which already handles `pick-suggest`/`clear-search` with
  `preventDefault` so the field doesn't blur first): fill the row identified by
  `data-i` with `data-value`, `persistContents()`, `refreshLiveShare()`, close the
  dropdown, then surgically update the row's `.ct-item` input value and its dropdown,
  and refocus that input. (Use `mousedown`, not `click`, so selection fires before
  blur closes the dropdown.)
- **`focusout` on `.ct-item`** (new branch, parallel to the search box's
  `focusout`): if the blurred element is the active row's `.ct-item`, close the
  dropdown and clear its view. Because pick runs on `mousedown` with
  `preventDefault`, a click on a suggestion lands before this fires.

**Filling a row** sets only `row.item` (qty untouched), via the same
`persistContents()` path used while typing.

### 5. Styling (`css/`)

- Reuse `.ls-suggest` / `.ls-opt` / `.sel` for the dropdown — no new dropdown rules.
- Add `.ct-item-wrap { position: relative; }` (and ensure it doesn't disturb the
  existing `.ct-row` flex layout — the wrapper takes the place the bare `.ct-item`
  held, with the input filling it). Confirm the dropdown's `z-index` sits above
  adjacent rows so it isn't clipped by the next `.ct-row`.

## Edge cases

- **Empty / whitespace-only value:** token is blank → `suggestItems` returns `[]` →
  no dropdown.
- **No saved locks (empty pool):** `allItemNames([])` → `[]` → no dropdown ever
  appears. The editor behaves exactly as today.
- **Multiple rows:** only `state.contentSuggest.row` renders a dropdown; focusing a
  different row's input updates `row` on the next keystroke. Blur closes the previous
  one.
- **Exact match already typed:** suppressed (no dropdown that merely echoes the
  field), per §1.
- **Already-added item:** excluded from suggestions via `otherRowNames`, so you can't
  pick a name that's already another row.
- **Success screen, unsaved lock:** pool is all saved locks; the in-progress lock
  contributes nothing yet, which is fine.
- **Picking then editing:** after a pick the field holds the full name and an exact
  match is suppressed, so the dropdown closes rather than showing a single echo row.
- **Leaving/returning to the editor or a full reload:** `state.contentSuggest` is
  in-memory only; a closed dropdown is the natural default.

## Testing

The matching core (`allItemNames`, `suggestItems`) is already unit-tested in
`test/` from the search feature; no changes there. Add focused coverage for the new
glue:

- **Pure helper** `otherRowNames(rowIndex)` (extract it so it's testable without the
  DOM): given a contents array and an index, returns the lowercased set of the
  **other** rows' names, excluding the indexed row and blank names. Cases: single
  row (empty set), duplicate names, blank/missing `item`, casing.
- **Exact-match suppression:** a row whose value exactly equals a pool name (case-
  insensitively) yields no suggestion for that name.
- **e2e** (`e2e/`, following the existing photos/search e2e pattern): in the contents
  editor, type a partial item name that exists in another saved lock → dropdown
  appears → pick it (mouse and via `↓`+`Enter`) → the row's `item` fills and persists;
  and an already-added name does not appear in the dropdown.

## Out of scope

- Fuzzy matching, ranking, or recents-weighting (strictly "same as search").
- Suggesting or autocompleting quantities.
- Suggesting from item names outside saved locks (e.g. a curated dictionary).
- Persisting, sharing, or exporting anything about the suggestion state.
