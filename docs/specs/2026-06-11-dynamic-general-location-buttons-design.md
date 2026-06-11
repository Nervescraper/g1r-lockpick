# Dynamic General-location buttons

**Date:** 2026-06-11
**Status:** Approved design, ready for implementation plan

## Problem

The "General location" field in the naming widget offers 4 hardcoded quick-fill
buttons — `Old Camp`, `New Camp`, `Swamp Camp`, `Orc Camp`. Users who play with
other locations must retype them as free text every time. We want the button set
to grow automatically to include whatever locations the user has actually used.

## Goal

Replace the hardcoded 4-button array with a computed, de-duplicated,
alphabetically-sorted set drawn from the 4 defaults **plus** every distinct
`location` value across the user's saved locks.

## Scope

- **In scope:** Compute the button list dynamically; render it in the naming
  widget.
- **Out of scope:** Any change to the data model, storage format, the
  `loc-fill` click handler, or the `loc-input` free-text field. There is no
  separate user-managed list of locations and no add/remove UI — the list is
  purely derived from saved locks.

## Current state

All relevant code lives in `src/ui/app.js`.

`namingWidgetHtml()` (≈ lines 764–783) renders the buttons inline:

```js
${['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp']
  .map((loc) => `<button class="ap-btn loc-fill${nm.location === loc ? ' primary' : ''}" data-action="loc-fill" data-loc="${loc}">${loc}</button>`)
  .join('')}
```

Saved locks are read with `loadLocks(store)` (imported from `../storage.js`,
used elsewhere in the file, e.g. line 889). Each lock record carries a
`location` string.

The `loc-fill` click handler and the `loc-input` text field both operate on
`nm.location` via `activeName()`, and neither cares how many buttons exist — so
no handler changes are needed. The `primary`-class highlight already lights up
whichever button matches the current `nm.location`.

## Design

### New helper: `generalLocations()`

A small pure function that returns the ordered list of location names to render.

1. Seed with the defaults, in this canonical casing:
   `['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp']`.
2. Read all saved locks via `loadLocks(store)` and collect each `location`,
   trimmed; skip empty/whitespace-only values.
3. De-duplicate **case-insensitively** using a `Map` keyed on
   `location.toLowerCase()`. Seed the map with the defaults first so their
   canonical casing is preserved — a saved lock whose lowercased location
   matches a default does not override the default's display casing. A saved
   location that matches no default keeps its own first-seen casing.
4. Return the map's values sorted alphabetically, case-insensitively
   (`localeCompare` with `{ sensitivity: 'base' }` or `.toLowerCase()`
   comparison).

The 4 defaults and saved locations form one merged, de-duplicated set sorted
A–Z; the defaults are **not** pinned to the front.

### Render change

In `namingWidgetHtml()`, replace the inline literal array with
`generalLocations()`. Each value still renders the same button markup
(`escapeHtml` the value into both the `data-loc` attribute and the label, as the
free-text path already does for user-provided strings).

## Behavior / edge cases

- A location typed into the free-text field but **not yet saved** to a lock gets
  no button until its lock is saved — consistent with "from your saved locks."
  It still highlights an existing button if it matches one.
- Empty / whitespace-only locations are ignored.
- If a custom location's lock is later deleted and nothing else uses it, its
  button disappears on the next render. The 4 defaults always remain.
- Case-insensitive de-dup means `old camp` saved on a lock does not produce a
  second button alongside the `Old Camp` default; the default's casing shows.

## Testing

- `generalLocations()` is a pure function and the primary unit-test target: feed
  it a `state`/`loadLocks` fixture and assert the ordered, de-duplicated output,
  covering — defaults only (no locks), a custom location sorting between
  defaults, case-insensitive de-dup against a default, case-insensitive de-dup
  between two custom locks, and whitespace/empty rejection. If the repo has no
  harness for this, factor the function so its inputs (defaults + a list of
  location strings) can be passed in for testing without DOM/storage.
- Verify the rendered widget by running the app: defaults appear with no saved
  locks; creating a lock with a new location adds its button on the next render;
  the matching button highlights `primary`.

## Files touched

- `src/ui/app.js` — add `generalLocations()`; update `namingWidgetHtml()` to use
  it.
