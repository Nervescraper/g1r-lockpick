# Saved Lock Import / Export — Design

**Date:** 2026-06-06
**Status:** Approved (pre-implementation)

## Goal

Let users move their saved locks in and out of the app. Saved locks currently live
only in `localStorage` (`g1r.locks`); clearing site data loses them and there is no way
to move them between browsers/devices or share one with another player. This feature adds:

1. **Bulk backup** — export *all* saved locks to a file, re-import elsewhere or after a
   data wipe.
2. **Single-lock sharing** — export *one* lock as a compact copy/paste code to hand to a
   friend, who imports it into their own collection.

Both paths feed one importer with interactive, non-destructive conflict resolution.

## Format choices (decided)

- **Bulk** → JSON **file** download/upload.
- **Single share** → base64 **text code** (copy/paste).
- **Conflicts** → interactive: incoming locks that collide with existing ones are shown in
  **one review list** with existing-vs-incoming detail and a per-row **Add as copy / Skip**
  choice. No silent overwrite.

## Architecture

Logic split between a pure, testable serialization layer (`src/storage.js`) and a thin UI
layer (`src/ui/app.js`). The import-review screen is modeled as a new app **stage**
(`state.stage === 'import'`), consistent with the existing `lock`/`setup`/`discovery`/`solve`
single-render-tree pattern — no new modal/overlay primitives.

### §1 — Data format & serialization (`src/storage.js`)

Pure functions, unit-tested alongside the existing `memStore()`-based tests.

**Envelope** (same shape for one lock or many):

```json
{
  "format": "g1r-locks",
  "version": 1,
  "exportedAt": "2026-06-06T12:00:00.000Z",
  "locks": [ { /* lock record */ } ]
}
```

A lock record matches what `saveLock` already persists:
`{ id, name, location, kind, description, n, initial, coupling, status, notes }`.

Functions:

- `exportLocks(locks) → string` — pretty-printed envelope JSON for the **file download**.
- `encodeShare(lock) → string` — single-lock envelope JSON, base64-encoded into a compact,
  paste-safe code.
- `parseImport(text) → { locks, invalidCount }` — accepts **either** raw envelope JSON
  (file) **or** a base64 share code. Validates each record and drops malformed ones,
  counting them in `invalidCount`. Validation rules:
  - `id` is a non-empty string;
  - `n` is an integer in 3–8;
  - `initial`, when present, is an array of length `n` with each pin in 1–7;
  - `coupling`, when present, is an `n × n` array of values in `{-1, 0, 1}`;
  - `status`, when present, is an array of length `n`.
  Missing optional fields are tolerated (mirrors `load-lock`, which fills defaults).
- `classifyImport(incoming, existing) → { fresh, identical, conflicts }`:
  - **fresh** — no existing lock matches → import immediately;
  - **identical** — same `id` *and* deep-equal content → silently skipped (clean backup
    round-trip / re-import is a no-op);
  - **conflicts** — same `id` with *different* content, OR different `id` but same identity
    (location + type + description, trimmed/lowercased).
- `sameIdentity(a, b) → boolean` — extracted from `app.js`'s existing `findDuplicate`
  logic and shared by both `classifyImport` and `findDuplicate`.

Timestamp note: `exportedAt` is stamped by the **caller** in `app.js` (which has `Date`),
keeping `storage.js` free of ambient time for testability.

### §2 — UI & flow (`src/ui/app.js` + CSS)

**Entry points — Lock step's "Load a saved lock" card:**

- A footer button row in the card: **⬆ Export all** and **⬇ Import**.
  - *Export all* builds the envelope, serializes via `exportLocks`, and downloads
    `g1r-locks-YYYY-MM-DD.json` using a `Blob` + temporary `<a download>` element.
  - *Export all* is hidden when there are no saved locks.
- Each lock row gains a small **⇪ Share** action beside the existing ✕. It opens a tiny
  inline panel under that row showing the `encodeShare` code in a read-only field with a
  **Copy** button (uses `navigator.clipboard`, with text-selection fallback).

**Import stage (`state.stage === 'import'`):**

- Reached from the *Import* button. Shows:
  - a file picker (`<input type="file" accept=".json,application/json">`), and
  - a paste `<textarea>` for a share code.
  Either source's text is run through `parseImport`.
- On submit, `classifyImport(parsed.locks, loadLocks(store))`:
  - **fresh** committed immediately via `saveLock`;
  - **identical** skipped;
  - **conflicts** rendered as the **review list** — one row each, showing **existing**
    (`name · n plates · mapped/in-progress`) vs **incoming**, with a per-row radio
    **Add as copy / Skip** (default **Skip**), and a final **Apply** button.
- **Add as copy** commits the incoming lock with a fresh id (`lock-${Date.now()}-${i}`),
  so nothing existing is overwritten.
- A summary line reports counts, e.g.
  *"Imported 3 new · 2 already present · 1 invalid · 4 to review below."*
- **Done / Back** returns to the Lock step.

**State:** a transient `state.import = { fresh, conflicts, choices }` exists only while the
`import` stage is active. It is **excluded from `persist()`** (not part of a saved session).

**Error handling:**
- Unparseable file/code → friendly inline message: *"That doesn't look like a g1r lock
  export."*
- Empty store → *Export all* hidden.
- `saveLock` quota failure → `alert` with a short explanation.

### §3 — Testing

Extend `test/storage.test.js` (existing `memStore()` pattern):

- `exportLocks` → `parseImport` round-trips a multi-lock set.
- `encodeShare` → `parseImport` round-trips a single lock.
- `parseImport` drops malformed records and reports `invalidCount`; rejects non-g1r JSON
  and garbage strings.
- `classifyImport` buckets correctly:
  - empty store → all fresh;
  - re-import of identical content → all identical;
  - same id, changed content → conflict;
  - different id, same identity → conflict;
  - different id, different identity → fresh.
- `sameIdentity` matches on trimmed/lowercased location+type+description.

No DOM-level test is added for the stage view, consistent with `app.js` currently having no
UI-level harness; all branching logic lives in the pure storage functions above.

## Out of scope (YAGNI)

- Cloud sync / server storage (the app is deliberately local-only).
- Merging *progress* across two versions of the same lock (conflict = copy or skip only).
- Encryption / signing of share codes.
- Export of session/settings (only saved locks travel).
```
