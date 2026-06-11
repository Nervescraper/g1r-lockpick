# Search saved locks by chest contents

**Date:** 2026-06-10
**Status:** Approved

## Goal

Add a search box to the **Lock** step (the saved-locks list) that filters locks by
the **items their chests contain**, with include and exclude terms and item-name
autocomplete.

- Find locks that contain an item: `gold`.
- Exclude an item or items and show everything else: `-gold`, or `-gold -sword`.
- Combine: `gold -sword` → locks with "gold" but not "sword".
- Autocomplete the item name you are typing against the full set of item names
  across all saved locks.

The query is an **ephemeral UI filter**: it is not persisted to `localStorage`, not
included in the session, and not part of share/export.

## Current state

- The saved-locks list renders in `lockStep()` (`src/ui/app.js`). It calls
  `lockSectionsHtml(locks)`, which runs `groupLocks(locks)` (`src/locks-view.js`,
  pure) into `{ recent, folders }` and emits a **Recent** section plus one
  **folder per location** via `lockSectionHtml(key, label, locks)`.
- The currently-loaded session lock is filtered out of the list
  (`l.id !== state.lockId`) before grouping.
- Section open/closed state comes from `sectionOpen(key)`: **Recent** defaults open,
  folders default closed, with explicit user toggles stored in
  `settings.lockFolders`.
- Each lock record carries `contents`: a list of `{ item: string, qty: int>=1 }`
  (see `sanitizeContents` in `src/storage.js`). `contentsSummary(l)` already renders
  this list per row.
- `render()` rebuilds `appEl` wholesale (`appEl.innerHTML = ''`). Text inputs that
  must keep focus while typing (import paste, contents item/qty, name/location) are
  handled in the `input` listener **without** calling `render()` — they mutate state
  and update only what is needed. The search box follows this same no-full-render
  pattern.

## Design

### 1. Pure search logic (`src/locks-view.js`)

All matching logic is pure and DOM-free, alongside `groupLocks`, and unit-tested the
same way.

**`parseSearch(text)` → `{ include: string[], exclude: string[] }`**

- Split `text` on whitespace into tokens; drop empties.
- A token with a leading `-` is an **exclude** term; its remainder (after the `-`) is
  used. A bare `-` (empty remainder) is ignored.
- All other non-empty tokens are **include** terms.
- Terms are lowercased and trimmed for matching. Duplicate terms within a list are
  harmless (deduped is optional, not required).

**`matchLockContents(lock, parsed)` → boolean**

- Let `items` = `lock.contents` mapped to lowercased item-name strings (missing/blank
  contents → empty list).
- **Include (AND):** for **every** include term, **some** item must contain it as a
  substring. If any include term has no matching item, the lock fails.
- **Exclude (ANY):** if **any** exclude term is a substring of **any** item, the lock
  fails.
- A lock with empty contents: passes an exclude-only query (nothing to exclude),
  fails whenever there is ≥1 include term.
- Empty `parsed` (no include and no exclude) → always true (no filtering).

**`filterLocks(locks, parsed)` → locks[]**

- Returns `locks.filter((l) => matchLockContents(l, parsed))`, preserving order.

**`allItemNames(locks)` → string[]**

- Collects every `contents` item name across `locks`, trims, drops blanks, and
  **dedupes case-insensitively** keeping the **first-seen display casing**. Used as
  the autocomplete pool.

**`suggestItems(names, token, alreadyChosen, limit = 8)` → string[]**

- `token` is the current term being typed (already stripped of any leading `-`,
  lowercased by the caller or internally — caller passes the raw remainder; function
  lowercases for comparison).
- Empty `token` → return `[]` (no dropdown until the user types something).
- Keep names whose lowercased value **contains** `token` (substring).
- Exclude names already present as a chosen term in the box (`alreadyChosen`, a
  lowercased set of the other tokens' remainders).
- Sort alphabetically (case-insensitive); cap at `limit`.

### 2. Lock-step wiring (`src/ui/app.js`)

**State (ephemeral, never saved):**

- `state.lockSearch` — the raw query string (default `''`).
- `state.searchSel` — index of the highlighted suggestion (default `-1`, none).

Neither is added to `saveSession`'s persisted set.

**Rendering the search UI** — at the top of the "Load a saved lock" card, above the
sections, rendered only when there are saved locks:

- A text input bound to `state.lockSearch`, an inline `✕` **clear** button shown when
  the query is non-empty, and a suggestion dropdown.
- The dropdown lists `suggestItems(...)` for the **current token** (the token at the
  caret / the last token — see below), each row a `pick-suggest` action carrying its
  value; the row at `state.searchSel` is highlighted.

**Current token:** for simplicity and predictability, the "current token" is the
**last whitespace-delimited token** of the field value. Selecting a suggestion
replaces that last token (preserving its leading `-` if present) and appends a
trailing space, so the user continues onto the next term. This avoids caret-position
bookkeeping and matches how the box is typed left-to-right.

**Filtering + layout:**

- `lockSectionsHtml(locks)` parses `state.lockSearch` once; when the query is
  **active** (has ≥1 include or exclude term):
  - Filter with `filterLocks` **before** grouping.
  - **Hide the Recent section** entirely — show only real folders.
  - Render only folders that still contain matches (naturally handled: `groupLocks`
    only buckets locks present in the filtered list).
  - **Force every folder open**, overriding `sectionOpen` (does not touch or persist
    `settings.lockFolders`).
  - If no locks match, render a `No locks match` message in place of the sections.
- When the query is inactive (empty/whitespace/bare `-` only), behavior is exactly
  as today: Recent + folders with persisted open/closed state.

**Event handling (no full `render()` while typing):**

- `input` on the search box: set `state.lockSearch`, reset `state.searchSel = -1`,
  then **surgically re-render** only the list container and the dropdown (replace
  their `innerHTML`), leaving the `<input>` node untouched so focus and caret are
  preserved. (Mirrors the existing focus-preserving input handlers.)
- `keydown` on the search box: `↓`/`↑` move `state.searchSel` within the current
  suggestion list (and re-render the dropdown), `Enter` selects the highlighted
  suggestion (or, if none highlighted, does nothing/keeps the typed text), `Esc`
  closes the dropdown (`searchSel = -1`, clear suggestions view). These must not
  collide with the global solve/setup keyboard shortcuts — those already bail when
  the event target is an `INPUT`/`TEXTAREA`.
- `mousedown`/`click` `pick-suggest`: replace the last token as described, re-render
  list + dropdown, keep focus in the box. Use `mousedown` (not `click`) so selection
  fires before the input loses focus / blur closes the dropdown.
- `click` `clear-search`: set `state.lockSearch = ''`, `searchSel = -1`, re-render
  the list + dropdown (now showing the full grouped view), refocus the box.
- Dropdown closes on blur of the search box.

### 3. Styling (`css/`)

- A search row (input + `✕`) styled to match the existing `lock-io` / `ap-btn` look.
- A suggestion dropdown positioned under the input, with a highlighted-row style for
  `state.searchSel`. Keep it consistent with the app's existing card/muted palette.

## Edge cases

- **Bare `-`** or stray whitespace: ignored by `parseSearch`; treated as inactive if
  nothing else is present.
- **No saved locks:** search box not rendered.
- **No matches:** "No locks match" message; folders/Recent suppressed.
- **Substring collisions** (e.g. `ore` matching "Iron ore" and "Ore chunk"): expected
  and intended for both filtering and suggestions.
- **Session lock:** already excluded from the list upstream; its items still
  contribute to the suggestion pool only if it is also a separate saved record — it is
  not double-counted because the list passed in already excludes it. (Acceptable: the
  pool reflects the visible candidate locks.)
- **Leaving and returning to the Lock step:** `state.lockSearch` persists in memory
  for the session only (not written to storage); acceptable. It is not restored after
  a full reload.

## Testing

Pure unit tests in `test/` (Node `--test`, matching existing `locks-view` tests):

- `parseSearch`: include-only, exclude-only (`-x`), mixed, bare `-`, extra
  whitespace, casing.
- `matchLockContents`: AND across includes, ANY for excludes, empty contents vs
  include vs exclude-only, substring and case-insensitivity.
- `filterLocks`: order preservation, combined include/exclude.
- `allItemNames`: case-insensitive dedupe, first-seen casing, blank/missing contents.
- `suggestItems`: substring match, empty token → `[]`, exclude already-chosen, cap,
  alphabetical sort, token with leading `-` handled by caller (function receives the
  remainder).

DOM/interaction (dropdown keyboard + selection, auto-expand, Recent hidden during
search) can be covered by the existing `e2e/` harness if warranted; the core logic is
fully covered by the pure tests above.

## Out of scope

- Searching by lock name/location/description (this is contents-only).
- Persisting the query across reloads, or sharing/exporting it.
- Fuzzy matching, ranking by relevance, or quantity-aware queries.
