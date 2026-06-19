# Lock photos

**Date:** 2026-06-19
**Status:** Approved design, ready for implementation plan

## Problem

A solved lock records its location, type, and contents (loot), but there is no way
to attach a visual reference — e.g. an in-game screenshot of where the chest sits or
what was inside. Players replaying with 100+ locks want a picture to recognise a lock
later.

## Goal

On the final **"Lock open!"** screen, let the user attach **up to 2 photos** per lock,
via **paste** (clipboard) and **choose file**. Photos are also viewable/manageable from
the saved-lock **✎ Edit** editor, open full-size on click, and appear as a small
thumbnail in the saved-locks list.

## Constraints that shaped the design

- A real playthrough already has **~160 locks**. localStorage holds only ~5 MB total for
  *all* locks combined, so photos **cannot** live in localStorage — 160 × 2 photos would
  not fit even when downscaled.
- Photos are stored in **IndexedDB** (large quota, binary blobs) keyed by lock id + slot.
- Photos are **downscaled to ≤1280px longest edge and re-encoded as JPEG q0.85**
  (~250 KB each; 160 × 2 ≈ 80 MB — comfortable for IndexedDB and keeps full-backup
  exports workable). Measured tradeoff vs. PNG: PNG of 3D scenes is ~8× larger
  (~640 MB total) and would make full exports large enough to crash the tab.
- **Portability (user choice):** photos travel in **JSON exports** but are **stripped from
  the compact share codes**. Achieved structurally — see the golden rule below.

## The golden rule

**localStorage lock records never hold photo bytes.** Photo data lives only in IndexedDB.
The only photo-related field on a localStorage record is a tiny `photoCount` (0–2). A
`photos` field carrying actual image data exists *only transiently* inside export/import
JSON.

Consequences, for free:
- `encodeShare(lock)` encodes a localStorage record → no photo bytes → **share codes stay
  tiny / unchanged**.
- Exports explicitly hydrate photos from IndexedDB → **exports carry them**.
- The saved-locks list reads `photoCount` synchronously to decide whether to show an
  indicator, without touching IndexedDB per row.

## Architecture

### New module: `src/photos.js`

A thin async wrapper over IndexedDB (one object store; key = `"<lockId>:<slot>"`,
value = `{ full: Blob, thumb: Blob }`), plus the canvas-based downscaler.

- `putPhoto(lockId, slot, fileOrBlob)` — decode → draw to canvas, cap longest edge at
  1280px → encode **JPEG q0.85** (`full`) → also encode a ~120px JPEG (`thumb`) → store both.
- `getPhotoURL(lockId, slot)` / `getThumbURL(lockId, slot)` — return `objectURL | null`.
- `deletePhoto(lockId, slot)`.
- `compact(lockId, count)` — renumber slots after a delete so slot 0 is always filled first.
- `deleteAllForLock(lockId)`.
- `listForExport(lockId)` → `[dataURL, …]` (full photos as data URLs, slot order).
- `importForLock(lockId, dataURLs)` — write incoming data URLs into IndexedDB (decoding
  each data URL into the `{ full, thumb }` pair; already-small data is not re-upscaled).

Downscale/encode and IndexedDB are browser-only (absent under `node --test`), so they stay
isolated here. The **pure** transform logic lives in `storage.js` (see below) and is unit-tested.

### `src/storage.js` — pure split/merge for portability

- On **export**, a helper attaches `photos: [dataURL,…]` to a *copy* of each lock record
  (the caller supplies the photos read from IndexedDB; `storage.js` only shapes the JSON).
- On **import**, a helper strips `photos` from the record written to localStorage, sets
  `photoCount = photos.length`, and returns the extracted `photos` for the caller to write
  to IndexedDB. Malformed `photos` entries are dropped, mirroring `sanitizeContents`
  (non-array → `[]`; non-string / non-data-URL entries skipped; capped at 2).
- `lockFingerprint` includes `photoCount` so a photo change bumps `updatedAt`.
- `isValidLock` treats `photoCount` / `photos` as optional and never gates validity on them.

### Bridging async photos into the synchronous render

`render()` rebuilds `appEl.innerHTML` on every event and cannot read IndexedDB synchronously.

- `state.photoCache[lockId] = { thumbs: [url|null, url|null], full: [url|null, url|null], loaded: bool }`.
- When the success screen or editor renders and the cache for the current `lockId` is not
  loaded, it renders placeholder boxes and kicks off an async load; on completion it updates
  the cache and calls `render()` again.
- Object URLs are cached across renders (they survive the `innerHTML` wipe) and revoked only
  when a photo is replaced/removed, the lock is deleted, or the active lock changes — so the
  per-event re-render does not thrash blob URLs.

## UI

### Shared photo picker — `photosEditorHtml(lockId, count)`

Used on **both** the "Lock open!" screen and the ✎ Edit-lock editor (`contentsView`).

- Two slots rendered as thumbnails.
- **Empty slot:** **＋ Add** with a "Choose file" `<input type="file" accept="image/*">` and
  a **Paste** button; **Ctrl/Cmd+V** while the screen is active pastes into the next empty slot.
- **Filled slot:** thumbnail with **✕ remove**; clicking the thumbnail opens the lightbox;
  re-adding replaces.
- **Unnamed lock (success screen only):** when `state.lockId` is absent, the block is
  **disabled** with the hint **"Name the lock to add photos"** — matching how the lock record
  itself only persists once named. (Decision: require a name first; no orphan blobs.)

### View surfaces

- **Lock open! screen:** picker rendered below the existing **Contents** section.
- **Edit-lock editor:** same picker below Contents.
- **Click to enlarge:** clicking any thumbnail opens a full-size **lightbox overlay** (the
  full ≤1280px JPEG), dismissed by click or **Esc**.
- **Saved-lock list:** rows with `photoCount > 0` show the small stored thumbnail of slot 0
  (the ~120px blob, not the full photo, so the list stays light).

## Export / import / delete

- `exportAllLocks()` and per-lock export become **async**: for each lock, `listForExport()`
  reads its photos; the `storage.js` helper attaches them as `photos` to a record copy; then
  serialize. **Note:** a full backup of 160 locks × 2 photos is ~110 MB JSON — large but a
  deliberate download. Add a one-line size heads-up near the Export-all control.
- `parseImport()` stays synchronous for validation; the import **commit** step becomes async:
  after writing each record to localStorage (`photos` stripped, `photoCount` set), call
  `importForLock()` to write the blobs into IndexedDB.
- Every `deleteLock()` call site also calls `deleteAllForLock()` so photos do not leak.

## Testing

- **Unit (`node --test`):** the pure split/merge transforms in `storage.js` — export attaches
  `photos`; import strips `photos`, sets `photoCount`, and drops malformed entries (mirrors the
  existing `sanitizeContents` tests).
- **e2e (existing `e2e/` Playwright):** solve a lock, attach an image (paste and/or choose
  file), reload, confirm the thumbnail persists and the lightbox opens; confirm a share code
  contains no photo bytes.

## Scope

- **In scope:** up to 2 photos per lock; paste + choose-file input; IndexedDB storage with
  downscale+JPEG; picker on the success screen and the edit editor; click-to-enlarge lightbox;
  list thumbnail; export carries photos; import restores them; share codes exclude them;
  delete cleans up.
- **Out of scope (YAGNI):** drag-&-drop, more than 2 photos, captions, cropping/rotation,
  cloud sync, embedding photos in share codes.
