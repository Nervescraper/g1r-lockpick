# Lock Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user attach up to 2 photos to a lock from the "Lock open!" screen (paste + choose-file), stored in IndexedDB, viewable in the edit editor / a lightbox / the saved-locks list, and carried through exports but never through share codes.

**Architecture:** Photo bytes live only in IndexedDB (`src/photos.js`, a new browser-only module wrapping IndexedDB + a canvas downscaler). localStorage lock records carry only a tiny `photoCount` (0–2). The `photos` field with real image data exists only transiently inside export/import JSON, shaped by pure helpers in `src/storage.js`. `render()` is synchronous, so the UI reads photo object-URLs from an in-memory `state.photoCache` that is filled asynchronously and triggers a re-render on completion.

**Tech Stack:** Vanilla ES modules, IndexedDB, Canvas 2D (browser), `node --test` for the pure storage layer, Playwright (`e2e/`) for the browser flow.

**Spec:** `docs/specs/2026-06-19-lock-photos-design.md`

---

## File Structure

- **Create `src/photos.js`** — IndexedDB store + canvas downscaler. Async API: `putPhoto`, `getPhotoURL`, `getThumbURL`, `deletePhoto`, `compact`, `deleteAllForLock`, `listForExport`, `importForLock`. Browser-only (uses `indexedDB`, `Image`, `document.createElement('canvas')`), verified via e2e + manual.
- **Modify `src/storage.js`** — pure photo helpers: `sanitizePhotos`, `splitPhotos`, `attachPhotos`; add `photoCount` to `lockFingerprint`. Unit-tested.
- **Modify `src/ui/app.js`** — photo state/cache, the shared `photosEditorHtml` widget, success-screen + editor integration, add/remove/paste handlers, lightbox, list thumbnail, export buttons + single-lock export, import commit, delete cleanup, changelog entry.
- **Modify `css/styles.css`** — styles for the picker, thumbnails, lightbox, list thumbnail.
- **Modify `test/storage.test.js`** — tests for the pure photo helpers.
- **Create `e2e/photos.js`** — Playwright flow (attach via file, reload, lightbox, share-code excludes photos).

### Conventions to follow (already in the codebase)
- `state` is the single mutable store; almost every handler ends by calling `render()`, which does `appEl.innerHTML = ''` then rebuilds.
- localStorage access goes through `src/storage.js` helpers and the `store` (= `window.localStorage`) object in `app.js`.
- `escapeHtml(s)` exists in `app.js` for interpolating user text.
- Overlays that live outside the render cycle (changelog, full-plan modal) are appended to `document.body` and manage their own listeners — the lightbox follows this pattern.

---

## Task 1: `sanitizePhotos` in storage.js (pure)

Mirror of the existing `sanitizeContents`: normalize an untrusted `photos` value to a clean array of at most 2 image data-URL strings.

**Files:**
- Modify: `src/storage.js` (add export near `sanitizeContents`, ~line 125)
- Test: `test/storage.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/storage.test.js` (and add `sanitizePhotos` to the import list at the top of the file):

```js
test('sanitizePhotos keeps image data URLs and caps at 2', () => {
  const a = 'data:image/jpeg;base64,AAAA';
  const b = 'data:image/png;base64,BBBB';
  const c = 'data:image/jpeg;base64,CCCC';
  assert.deepEqual(sanitizePhotos([a, b, c]), [a, b]);
});

test('sanitizePhotos drops non-string and non-image entries', () => {
  assert.deepEqual(
    sanitizePhotos(['data:image/jpeg;base64,AAAA', 'http://x/y.png', 42, null, '']),
    ['data:image/jpeg;base64,AAAA'],
  );
});

test('sanitizePhotos returns [] for non-array input', () => {
  assert.deepEqual(sanitizePhotos(undefined), []);
  assert.deepEqual(sanitizePhotos(null), []);
  assert.deepEqual(sanitizePhotos('nope'), []);
  assert.deepEqual(sanitizePhotos({}), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/storage.test.js`
Expected: FAIL — `sanitizePhotos is not a function` (also an import error until the export exists).

- [ ] **Step 3: Implement `sanitizePhotos`**

Add to `src/storage.js` immediately after `sanitizeContents` (after line 125):

```js
// Normalize an untrusted photos value to at most 2 image data-URL strings. Mirrors
// sanitizeContents: non-array input yields []. Keeps only strings that look like an
// image data URL (the only thing photos.js ever writes), so a hostile/old export can't
// smuggle other URLs into IndexedDB on import.
export function sanitizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  const out = [];
  for (const p of photos) {
    if (typeof p === 'string' && p.startsWith('data:image/')) out.push(p);
    if (out.length === 2) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/storage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage.js test/storage.test.js
git commit -m "feat(storage): sanitizePhotos for untrusted photo lists"
```

---

## Task 2: `splitPhotos` + `attachPhotos` + fingerprint in storage.js (pure)

`splitPhotos` separates an imported lock into a photo-free record (with `photoCount` set) and its cleaned photo array. `attachPhotos` is the export-side inverse. `lockFingerprint` learns about `photoCount` so a photo change re-saves the record.

**Files:**
- Modify: `src/storage.js` (helpers after `sanitizePhotos`; `lockFingerprint` lives in `app.js` — see Step 5)
- Test: `test/storage.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/storage.test.js` (add `splitPhotos, attachPhotos` to the import list):

```js
test('splitPhotos strips photos into a separate array and sets photoCount', () => {
  const lock = { id: 'a', n: 3, photos: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'] };
  const { record, photos } = splitPhotos(lock);
  assert.equal('photos' in record, false);
  assert.equal(record.photoCount, 2);
  assert.deepEqual(photos, ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB']);
});

test('splitPhotos on a lock with no photos yields photoCount 0 and empty array', () => {
  const { record, photos } = splitPhotos({ id: 'a', n: 3 });
  assert.equal(record.photoCount, 0);
  assert.deepEqual(photos, []);
});

test('splitPhotos drops malformed photo entries via sanitizePhotos', () => {
  const { record, photos } = splitPhotos({ id: 'a', n: 3, photos: ['nope', 'data:image/png;base64,CCCC'] });
  assert.equal(record.photoCount, 1);
  assert.deepEqual(photos, ['data:image/png;base64,CCCC']);
});

test('attachPhotos adds a photos array to a record copy without mutating the input', () => {
  const record = { id: 'a', n: 3, photoCount: 1 };
  const out = attachPhotos(record, ['data:image/jpeg;base64,AAAA']);
  assert.deepEqual(out.photos, ['data:image/jpeg;base64,AAAA']);
  assert.equal('photos' in record, false); // original untouched
});

test('attachPhotos with no photos omits the field', () => {
  const out = attachPhotos({ id: 'a', n: 3, photoCount: 0 }, []);
  assert.equal('photos' in out, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/storage.test.js`
Expected: FAIL — `splitPhotos is not a function`.

- [ ] **Step 3: Implement the helpers**

Add to `src/storage.js` after `sanitizePhotos`:

```js
// Separate an imported lock into the photo-free record that goes to localStorage (with a
// tiny photoCount) and the cleaned data-URL list that goes to IndexedDB. The golden rule:
// localStorage records never carry photo bytes.
export function splitPhotos(lock) {
  const photos = sanitizePhotos(lock.photos);
  const { photos: _omit, ...rest } = lock;
  return { record: { ...rest, photoCount: photos.length }, photos };
}

// Export-side inverse: return a copy of the record with a `photos` array attached (omitted
// when empty so photo-free exports stay byte-identical to today's). Never mutates `record`.
export function attachPhotos(record, photos) {
  const clean = sanitizePhotos(photos);
  return clean.length ? { ...record, photos: clean } : { ...record };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/storage.test.js`
Expected: PASS.

- [ ] **Step 5: Add `photoCount` to `lockFingerprint` in app.js**

In `src/ui/app.js` line 188, change:

```js
const lockFingerprint = (l) =>
  JSON.stringify([l.name, l.location, l.kind, l.description, l.n, l.initial, l.coupling, l.status, l.contents, l.notes]);
```

to:

```js
const lockFingerprint = (l) =>
  JSON.stringify([l.name, l.location, l.kind, l.description, l.n, l.initial, l.coupling, l.status, l.contents, l.notes, l.photoCount]);
```

- [ ] **Step 6: Run the full test suite**

Run: `node --test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/storage.js src/ui/app.js test/storage.test.js
git commit -m "feat(storage): splitPhotos/attachPhotos + photoCount fingerprint"
```

---

## Task 3: `src/photos.js` — IndexedDB store + canvas downscaler (browser-only)

The full async photo backend. No node unit tests (IndexedDB/canvas are browser-only); verified by the e2e flow in Task 12 and manual check. Write the whole module in one task.

**Files:**
- Create: `src/photos.js`

- [ ] **Step 1: Create the module**

Create `src/photos.js`:

```js
// Photo storage for locks. Bytes live ONLY here (IndexedDB), never in localStorage lock
// records — those carry just a photoCount. One object store, key "<lockId>:<slot>",
// value { full: Blob, thumb: Blob }. All entry points are async.
//
// Browser-only: uses indexedDB, Image, and a <canvas>. Not unit-tested under node:test;
// covered by the e2e flow.

const DB_NAME = 'g1r-photos';
const STORE = 'photos';
const MAX_EDGE = 1280; // longest-edge cap for the stored "full" image
const THUMB_EDGE = 120; // longest-edge for the list/picker thumbnail
const JPEG_Q = 0.85;

let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const key = (lockId, slot) => `${lockId}:${slot}`;

async function tx(mode, fn) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const t = conn.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// ---- image encoding (canvas) ----

function loadImage(blobOrFile) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blobOrFile);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

function scaledCanvas(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas;
}

const toBlob = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_Q),
  );

// Downscale to a { full, thumb } JPEG pair.
async function encodePair(blobOrFile) {
  const img = await loadImage(blobOrFile);
  const full = await toBlob(scaledCanvas(img, MAX_EDGE));
  const thumb = await toBlob(scaledCanvas(img, THUMB_EDGE));
  return { full, thumb };
}

// ---- public API ----

// Downscale + store a file/blob at (lockId, slot). Throws if the input isn't an image.
export async function putPhoto(lockId, slot, fileOrBlob) {
  const pair = await encodePair(fileOrBlob);
  await tx('readwrite', (store) => reqP(store.put(pair, key(lockId, slot))));
}

async function getBlob(lockId, slot, which) {
  const rec = await tx('readonly', (store) => reqP(store.get(key(lockId, slot))));
  return rec ? rec[which] : null;
}

// Object URL for the full (or thumb) image at a slot, or null if absent. Caller owns the URL
// (revoke it when done) — app.js caches these in state.photoCache and revokes on invalidation.
export async function getPhotoURL(lockId, slot) {
  const blob = await getBlob(lockId, slot, 'full');
  return blob ? URL.createObjectURL(blob) : null;
}
export async function getThumbURL(lockId, slot) {
  const blob = await getBlob(lockId, slot, 'thumb');
  return blob ? URL.createObjectURL(blob) : null;
}

export async function deletePhoto(lockId, slot) {
  await tx('readwrite', (store) => reqP(store.delete(key(lockId, slot))));
}

// After a delete, renumber the remaining `count` slots so slot 0 is always filled first
// (slots are 0..1). Reads both, rewrites compactly.
export async function compact(lockId, count) {
  await tx('readwrite', async (store) => {
    const recs = [];
    for (let s = 0; s < count; s++) {
      const r = await reqP(store.get(key(lockId, s)));
      if (r) recs.push(r);
    }
    for (let s = 0; s < count; s++) await reqP(store.delete(key(lockId, s)));
    for (let s = 0; s < recs.length; s++) await reqP(store.put(recs[s], key(lockId, s)));
  });
}

export async function deleteAllForLock(lockId) {
  await tx('readwrite', async (store) => {
    for (let s = 0; s < 2; s++) await reqP(store.delete(key(lockId, s)));
  });
}

// Read a lock's full photos as JPEG data URLs (slot order) for export. [] when none.
export async function listForExport(lockId) {
  const out = [];
  for (let s = 0; s < 2; s++) {
    const blob = await getBlob(lockId, s, 'full');
    if (blob) out.push(await blobToDataURL(blob));
  }
  return out;
}

// Write imported data URLs into IndexedDB, re-deriving the { full, thumb } pair through the
// same downscaler so an oversized imported image is normalized like a fresh one.
export async function importForLock(lockId, dataURLs) {
  for (let s = 0; s < dataURLs.length && s < 2; s++) {
    const blob = await dataURLToBlob(dataURLs[s]);
    await putPhoto(lockId, s, blob);
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL) {
  return await (await fetch(dataURL)).blob();
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/photos.js`
Expected: no output (valid ES module syntax).

- [ ] **Step 3: Commit**

```bash
git add src/photos.js
git commit -m "feat(photos): IndexedDB photo store with canvas downscaler"
```

---

## Task 4: Photo state + async cache bridge in app.js

The synchronous-render bridge: an in-memory cache of object URLs, an async loader that re-renders on completion, and an invalidation helper that revokes URLs.

**Files:**
- Modify: `src/ui/app.js` (import block ~line 14; state init; helpers near other helpers ~line 220)

- [ ] **Step 1: Import the photos module**

In `src/ui/app.js`, after the storage import block (ends ~line 18), add:

```js
import {
  putPhoto, getPhotoURL, getThumbURL, deletePhoto, compact, deleteAllForLock,
  listForExport, importForLock,
} from '../photos.js';
```

Also add `splitPhotos, attachPhotos` to the existing `from '../storage.js'` import list (line 14–17).

- [ ] **Step 2: Add the photo cache helpers**

Add near the other helpers (after `escapeHtml`, ~line 360):

```js
// ---- photos: async object-URL cache over a synchronous render ----
// render() can't read IndexedDB, so the picker/list render from this cache. A miss kicks off
// an async load that fills the cache and calls render() again. Object URLs survive the
// innerHTML wipe; they're revoked only on invalidation (replace/remove/delete/lock change).
const photoCache = new Map(); // lockId -> { loaded, loading, thumbs:[url|null,url|null], full:[url|null,url|null] }

function photoEntry(lockId) {
  let e = photoCache.get(lockId);
  if (!e) { e = { loaded: false, loading: false, thumbs: [null, null], full: [null, null] }; photoCache.set(lockId, e); }
  return e;
}

// Ensure slots 0..count-1 are loaded for lockId; re-render when the async load finishes.
function ensurePhotosLoaded(lockId, count) {
  if (!lockId || count <= 0) return;
  const e = photoEntry(lockId);
  if (e.loaded || e.loading) return;
  e.loading = true;
  (async () => {
    for (let s = 0; s < count; s++) {
      e.thumbs[s] = await getThumbURL(lockId, s);
      e.full[s] = await getPhotoURL(lockId, s);
    }
    e.loaded = true;
    e.loading = false;
    render();
  })();
}

// Revoke and forget a lock's cached URLs so the next render reloads from IndexedDB.
function invalidatePhotos(lockId) {
  const e = photoCache.get(lockId);
  if (!e) return;
  for (const u of [...e.thumbs, ...e.full]) if (u) URL.revokeObjectURL(u);
  photoCache.delete(lockId);
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/ui/app.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): async object-URL cache bridge in app.js"
```

---

## Task 5: Shared `photosEditorHtml` widget + CSS

The presentational widget used on both the success screen and the editor. Renders 2 slots from the cache, with disabled state and per-screen wiring via data attributes.

**Files:**
- Modify: `src/ui/app.js` (add near `contentsEditorHtml`, ~line 852)
- Modify: `css/styles.css` (append)

- [ ] **Step 1: Add the widget function**

In `src/ui/app.js`, after `contentsEditorHtml` (line 852):

```js
// The 2-slot photo picker, shared by the "Lock open!" screen and the saved-lock editor.
// `lockId` is the record the photos attach to (null on an unnamed success-screen lock, which
// disables the controls). `count` is the record's photoCount. Reads object URLs from the cache.
function photosEditorHtml(lockId, count) {
  if (!lockId) {
    return `<div class="photos-editor disabled"><div class="muted">Name the lock to add photos.</div></div>`;
  }
  ensurePhotosLoaded(lockId, count);
  const e = photoEntry(lockId);
  const slots = [0, 1].map((s) => {
    if (s < count) {
      const url = e.thumbs[s];
      const img = url
        ? `<img class="photo-thumb" src="${url}" alt="Lock photo ${s + 1}" data-action="photo-open" data-id="${lockId}" data-slot="${s}" />`
        : `<div class="photo-thumb loading"></div>`;
      return `<div class="photo-slot filled">${img}
        <button class="photo-del" data-action="photo-del" data-id="${lockId}" data-slot="${s}" title="Remove photo" aria-label="Remove photo">✕</button>
      </div>`;
    }
    if (s === count) {
      // The single "add" slot: choose-file + paste, both targeting the next empty slot.
      return `<div class="photo-slot empty">
        <label class="photo-add" title="Choose an image file">＋ Add photo
          <input type="file" accept="image/*" data-action="photo-file" data-id="${lockId}" data-slot="${s}" hidden />
        </label>
        <button class="ap-btn photo-paste" data-action="photo-paste" data-id="${lockId}" data-slot="${s}" title="Paste an image from the clipboard">Paste</button>
      </div>`;
    }
    return ''; // beyond the add slot — nothing
  }).join('');
  return `<div class="photos-editor">${slots}</div>`;
}
```

- [ ] **Step 2: Add CSS**

Append to `css/styles.css`:

```css
/* Lock photos */
.photos-editor { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
.photos-editor.disabled { color: var(--muted); }
.photo-slot { position: relative; width: 96px; height: 96px; border: 1px solid var(--line, #444);
  border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.photo-slot.empty { flex-direction: column; gap: 6px; border-style: dashed; padding: 6px; height: auto; min-height: 96px; }
.photo-thumb { width: 96px; height: 96px; object-fit: cover; cursor: zoom-in; display: block; }
.photo-thumb.loading { background: repeating-linear-gradient(45deg, #333, #333 6px, #3a3a3a 6px, #3a3a3a 12px); }
.photo-add { cursor: pointer; font-size: 13px; text-align: center; }
.photo-paste { font-size: 12px; padding: 2px 8px; }
.photo-del { position: absolute; top: 2px; right: 2px; border: none; border-radius: 50%;
  width: 20px; height: 20px; line-height: 18px; cursor: pointer; background: rgba(0,0,0,.6); color: #fff; }
/* List row thumbnail */
.lock-row-thumb { width: 28px; height: 28px; object-fit: cover; border-radius: 4px; vertical-align: middle; margin-right: 6px; }
/* Lightbox */
.photo-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: flex;
  align-items: center; justify-content: center; z-index: 1000; cursor: zoom-out; }
.photo-lightbox img { max-width: 92vw; max-height: 92vh; box-shadow: 0 4px 30px rgba(0,0,0,.6); }
```

(If `--line` / `--muted` custom properties don't exist, the fallbacks apply — verify against the file's `:root` and adjust the literal colors to match the existing palette.)

- [ ] **Step 3: Syntax check**

Run: `node --check src/ui/app.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js css/styles.css
git commit -m "feat(photos): shared photo-picker widget + styles"
```

---

## Task 6: Render the picker on the success screen + editor

Wire the widget into the two surfaces. Track `state.photoCount` for the session lock and include it in `syncLock`/`persist` so it survives re-render.

**Files:**
- Modify: `src/ui/app.js` (success screen ~line 1928; `contentsView` ~line 872; `syncLock` ~line 198; `persist` ~line 136; initial state ~line 129; `load-lock` handler ~line 2420; `edit-contents` ~line 2476)

- [ ] **Step 1: Track photoCount on session state**

In the initial `state` object (the block containing `contents: []`, ~line 129), add `photoCount: 0,`.

In `persist()` (line 136) add `photoCount` to BOTH the destructure and the `saveSession(...)` object.

In `syncLock()`'s `record` (line 198–212), add after `notes: ''`:

```js
    photoCount: state.photoCount || 0,
```

- [ ] **Step 2: Render the picker on the "Lock open!" screen**

In the success card (`state.planIndex >= state.plan.length`, ~line 1923), after the Contents block (`${contentsEditorHtml(state.contents)}`, line 1928) and before the "Share this lock" header (line 1929), insert:

```js
      <div class="ap-h" style="margin-top:16px">Photos <span class="muted" style="text-transform:none;letter-spacing:0">— up to 2 (optional)</span></div>
      ${photosEditorHtml(state.lockId, state.photoCount || 0)}
```

- [ ] **Step 3: Render the picker in the editor**

In `contentsView()` (~line 869), after the contents editor line (`${contentsEditorHtml(ed.items)}`) add:

```js
    <div class="muted" style="margin:16px 0 4px">Photos</div>
    ${photosEditorHtml(ed.id, (getLock(store, ed.id) || {}).photoCount || 0)}
```

- [ ] **Step 4: Sync photoCount when loading a saved lock**

In the `load-lock` handler (the case that sets `state.contents` from a loaded lock, ~line 2420), add alongside the contents assignment:

```js
        state.photoCount = lock.photoCount || 0;
```

Also in the `del-lock` handler reset block (line 2463), add `state.photoCount = 0;` where it clears `state.contents = []`.

- [ ] **Step 5: Manual verify (browser)**

Run the app (see project `run` skill / open `index.html` via the dev server). Solve a lock, name it. Confirm the **Photos** section shows with an enabled "＋ Add photo" + "Paste". Before naming, confirm it shows "Name the lock to add photos." Open the ✎ editor on a saved lock and confirm the Photos section renders.

Run: `node --check src/ui/app.js` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): render picker on success screen and lock editor"
```

---

## Task 7: Add / remove / paste handlers

The async mutations: choose-file (`change`), remove (`click`), paste (`paste`). Each updates IndexedDB, bumps `photoCount` on the right record, invalidates the cache, and re-renders.

**Files:**
- Modify: `src/ui/app.js` (mutation helpers near photo cache ~line 360; click handler ~line 2470; change handler ~line 2702; new paste handler near line 2688)

- [ ] **Step 1: Add the mutation helpers**

Add after `invalidatePhotos` (from Task 4):

```js
// Update photoCount on the right holder: the session lock (state) when it's the session lock,
// and always the saved record. Keeps state.photoCount in sync when editing the loaded lock.
function setPhotoCount(lockId, count) {
  const base = getLock(store, lockId);
  if (base) saveLock(store, stamp({ ...base, photoCount: count }));
  if (state.lockId === lockId) state.photoCount = count;
}

// The next free slot for a lock equals its current photoCount (slots fill 0 then 1).
function nextPhotoSlot(lockId) {
  const base = getLock(store, lockId);
  return base ? (base.photoCount || 0) : 0;
}

async function addPhoto(lockId, fileOrBlob) {
  const slot = nextPhotoSlot(lockId);
  if (slot >= 2) return; // already full
  try {
    await putPhoto(lockId, slot, fileOrBlob);
  } catch {
    return; // not a decodable image — silently ignore
  }
  setPhotoCount(lockId, slot + 1);
  invalidatePhotos(lockId);
  render();
}

async function removePhoto(lockId, slot) {
  const base = getLock(store, lockId);
  const count = base ? (base.photoCount || 0) : 0;
  await deletePhoto(lockId, slot);
  await compact(lockId, count);
  setPhotoCount(lockId, Math.max(0, count - 1));
  invalidatePhotos(lockId);
  render();
}
```

- [ ] **Step 2: Wire the click actions (remove + paste-button + the lightbox open is Task 8)**

In the main click handler `switch` (`src/ui/app.js` ~line 2470, near the `content-del` case), add:

```js
    case 'photo-del': removePhoto(t.dataset.id, +t.dataset.slot); return; // async re-renders
    case 'photo-paste': pastePhotoFromClipboard(t.dataset.id); return;
```

`photo-file` is a hidden `<input>` inside a `<label>`, so clicking "＋ Add photo" opens the OS picker natively — no click-case needed; the `change` listener handles it (Step 3).

The Paste **button** can't read the clipboard without a user gesture + permission; implement `pastePhotoFromClipboard` using the async Clipboard API, with the keyboard Ctrl/Cmd+V path (Step 4) as the reliable fallback:

```js
// Paste-button path: try the async Clipboard API (needs clipboard-read permission). On any
// failure, hint the user to use Ctrl/Cmd+V instead (the paste-event path always works).
async function pastePhotoFromClipboard(lockId) {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) { await addPhoto(lockId, await item.getType(type)); return; }
    }
    window.alert('No image found on the clipboard. Copy a screenshot, or press Ctrl/Cmd+V here.');
  } catch {
    window.alert('Press Ctrl/Cmd+V to paste an image here.');
  }
}
```

- [ ] **Step 3: Handle the file input in the `change` listener**

Extend the existing `change` listener (`src/ui/app.js` ~line 2702). At the TOP of the listener body, before the import-file check, add:

```js
  const pf = e.target.closest('[data-action="photo-file"]');
  if (pf) {
    const file = e.target.files && e.target.files[0];
    if (file) addPhoto(pf.dataset.id, file); // async; re-renders on completion
    e.target.value = ''; // allow re-choosing the same file later
    return;
  }
```

- [ ] **Step 4: Add the image paste listener**

Add a NEW `window` paste listener (separate from the import-text paste at line 2688), placed just after it:

```js
// Paste an image onto the success screen or the lock editor → next free photo slot. Separate
// from the import-code paste above (that one only fires on the Lock step and ignores images).
window.addEventListener('paste', (e) => {
  const lockId = activePhotoLockId();
  if (!lockId) return;
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (file) { e.preventDefault(); addPhoto(lockId, file); return; }
    }
  }
});

// The lock id that photo paste targets, or null when no photo surface is active. The success
// screen edits the session lock (state.lockId, only once named); the editor edits ed.id.
function activePhotoLockId() {
  if (state.stage === 'contents' && state.contentsEdit) return state.contentsEdit.id;
  const onSuccess = state.stage === 'solve' && Array.isArray(state.plan) && state.planIndex >= state.plan.length;
  if (onSuccess && state.lockId) return state.lockId;
  return null;
}
```

- [ ] **Step 5: Manual verify (browser)**

Solve + name a lock. Choose a file → thumbnail appears, the add slot moves to slot 2; choose a second → "＋ Add" disappears (2/2). Copy a screenshot, click into the page, Ctrl/Cmd+V → adds. Click ✕ on the first photo → the second shifts to slot 0. Reload the page → thumbnails persist.

Run: `node --check src/ui/app.js` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): add/remove/paste handlers"
```

---

## Task 8: Click-to-enlarge lightbox

A full-size overlay outside the render cycle (changelog-modal pattern). Opens on thumbnail click, closes on click or Esc.

**Files:**
- Modify: `src/ui/app.js` (click handler ~line 2470; new overlay helpers near `openChangelog`)

- [ ] **Step 1: Add the lightbox open/close helpers**

Add near the other overlay helpers (search `openChangelog`):

```js
// Full-size photo overlay. Lives outside the render cycle (like the changelog modal). The
// full image URL comes from the photo cache; ensure it's loaded first.
function openLightbox(lockId, slot) {
  const show = () => {
    const url = (photoCache.get(lockId)?.full || [])[slot];
    if (!url) return;
    closeLightbox();
    const ov = document.createElement('div');
    ov.className = 'photo-lightbox';
    ov.id = 'photo-lightbox';
    ov.innerHTML = `<img src="${url}" alt="Lock photo" />`;
    ov.addEventListener('click', closeLightbox);
    document.body.appendChild(ov);
  };
  const e = photoEntry(lockId);
  if (e.loaded) show();
  else ensurePhotosLoaded(lockId, slot + 1), setTimeout(show, 150); // load then show
}

function closeLightbox() {
  document.getElementById('photo-lightbox')?.remove();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});
```

(Note: `ensurePhotosLoaded` already re-renders on completion; the `setTimeout` is a simple "show once the blob is ready" — acceptable since the cache is usually already warm on a screen that shows the thumbnail.)

- [ ] **Step 2: Wire the click action**

In the click handler `switch`, add:

```js
    case 'photo-open': openLightbox(t.dataset.id, +t.dataset.slot); return;
```

- [ ] **Step 3: Manual verify**

Click a thumbnail on the success screen and in the editor → full image overlays. Click anywhere or press Esc → closes.

Run: `node --check src/ui/app.js` → no output.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): click-to-enlarge lightbox"
```

---

## Task 9: Saved-lock list thumbnail

Show slot-0's thumbnail in each saved-lock row when `photoCount > 0`. Render a src-less `<img>` synchronously, then fill `src` async after render from a persistent thumb-URL cache.

**Files:**
- Modify: `src/ui/app.js` (`lockRowHtml` ~line 1057; `render()` tail ~line 408; thumb cache near photo cache)

- [ ] **Step 1: Add a list-thumb cache + hydrator**

Add near the photo cache helpers:

```js
// Slot-0 thumbnails for the saved-lock list, cached by lockId so the per-event re-render
// (which wipes innerHTML) doesn't re-read IndexedDB every time.
const listThumbCache = new Map(); // lockId -> objectURL

// After each render, fill any list-thumb <img> that lacks a src, from cache or IndexedDB.
function hydrateListThumbs() {
  for (const img of appEl.querySelectorAll('img.lock-row-thumb:not([src])')) {
    const id = img.dataset.id;
    const cached = listThumbCache.get(id);
    if (cached) { img.src = cached; continue; }
    getThumbURL(id, 0).then((url) => {
      if (!url) return;
      listThumbCache.set(id, url);
      // The node may have been replaced by a later render — re-query before assigning.
      const live = appEl.querySelector(`img.lock-row-thumb[data-id="${id}"]:not([src])`);
      if (live) live.src = url;
    });
  }
}
```

Invalidate this cache on photo change and delete: in `setPhotoCount` and `removePhoto`/`addPhoto`, after `invalidatePhotos(lockId)` also add:

```js
  const tu = listThumbCache.get(lockId);
  if (tu) { URL.revokeObjectURL(tu); listThumbCache.delete(lockId); }
```

(Put this in `invalidatePhotos` itself so it's one place.)

- [ ] **Step 2: Render the thumbnail in the row**

In `lockRowHtml(l)` (~line 1058), change the name line to prefix a thumbnail when present. Replace:

```js
      <span data-action="load-lock" data-id="${l.id}" style="cursor:pointer">${escapeHtml(l.name)} <span class="muted">(${l.n} plates)</span></span>
```

with:

```js
      <span data-action="load-lock" data-id="${l.id}" style="cursor:pointer">${
        l.photoCount > 0 ? `<img class="lock-row-thumb" data-id="${l.id}" alt="" />` : ''
      }${escapeHtml(l.name)} <span class="muted">(${l.n} plates)</span></span>
```

- [ ] **Step 3: Call the hydrator at the end of `render()`**

At the very end of `render()` (after the DOM is built; find the function's closing before line ~490 where other post-render DOM tweaks happen), add:

```js
  hydrateListThumbs();
```

(Place it alongside the existing post-render focus/measurement calls so it runs after `appEl` is populated.)

- [ ] **Step 4: Manual verify**

Add a photo to a lock, go to the Lock step, confirm a small thumbnail shows next to that lock's name and not on photo-free locks. Remove the photo → thumbnail disappears.

Run: `node --check src/ui/app.js` → no output.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): saved-lock list thumbnail"
```

---

## Task 10: Export — two "Export all" buttons + single-lock export with photos

`buildExportJSON(locks, { withPhotos })` shapes the file; two bulk buttons; a new per-lock "export with photos" file-download action next to ⇪ Share.

**Files:**
- Modify: `src/ui/app.js` (`exportAllLocks` ~line 1243; the export-all button ~line 900; `lockRowHtml` actions ~line 1060; click handler)

- [ ] **Step 1: Add `buildExportJSON` + a download helper**

Replace `exportAllLocks()` (line 1243) with photo-aware versions:

```js
// Shape the export envelope. With photos, attach each lock's IndexedDB photos as data URLs.
async function buildExportJSON(locks, { withPhotos }) {
  if (!withPhotos) return exportLocks(locks, isoNow());
  const withImgs = [];
  for (const l of locks) withImgs.push(attachPhotos(l, await listForExport(l.id)));
  return exportLocks(withImgs, isoNow());
}

function downloadJSON(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportAllLocks(withPhotos) {
  const locks = loadLocks(store);
  if (!locks.length) return;
  const json = await buildExportJSON(locks, { withPhotos });
  downloadJSON(`g1r-locks-${isoNow().slice(0, 10)}.json`, json);
}

// One lock + its photos, as a file download (the share code stays photo-free text).
async function exportLockWithPhotos(id) {
  const lock = getLock(store, id);
  if (!lock) return;
  const json = await buildExportJSON([lock], { withPhotos: true });
  const slug = (lock.name || 'lock').replace(/[^\w-]+/g, '-').slice(0, 40);
  downloadJSON(`g1r-lock-${slug}.json`, json);
}
```

- [ ] **Step 2: Two bulk buttons**

At the export-all button (line 900), replace:

```js
      ${allLocks.length ? '<span class="ap-btn" data-action="export-all">⬆ Export all</span>' : ''}
```

with:

```js
      ${allLocks.length ? `<span class="ap-btn" data-action="export-all">⬆ Export all</span>
        <span class="ap-btn" data-action="export-all-photos" title="Larger file — includes all photos">⬆ Export all + photos</span>` : ''}
```

- [ ] **Step 3: Per-lock "export with photos" action**

In `lockRowHtml` actions (line 1061–1063), add after the ⇪ Share span, but only when the lock has photos:

```js
        ${l.photoCount > 0 ? `<span class="io" data-action="export-lock-photos" data-id="${l.id}" title="Download this lock with its photos">⬇</span>` : ''}
```

- [ ] **Step 4: Wire the click actions**

Replace the existing `export-all` case (line 2466) and add the others:

```js
    case 'export-all': exportAllLocks(false); return;
    case 'export-all-photos': exportAllLocks(true); return;
    case 'export-lock-photos': exportLockWithPhotos(t.dataset.id); return;
```

- [ ] **Step 5: Manual verify**

"⬆ Export all" downloads a small photo-free JSON (open it — no `photos` fields). "⬆ Export all + photos" downloads a larger file containing `photos` arrays. On a lock with photos, the ⬇ action downloads a one-lock file containing its `photos`. The ⇪ share code is unchanged (no photo bytes — verify the textarea content stays short).

Run: `node --check src/ui/app.js` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): photo-free + with-photos export paths"
```

---

## Task 11: Import commit writes photos to IndexedDB + delete cleanup

On import, write each incoming lock's photos to IndexedDB and strip them from the localStorage record. On delete, purge the lock's photos.

**Files:**
- Modify: `src/ui/app.js` (`runImportParse` ~line 1198; `runImportApply` ~line 1212; `del-lock` handler ~line 2461)

- [ ] **Step 1: Strip + persist photos on the fresh-import path**

In `runImportParse()` (line 1197–1198), replace:

```js
  let newCount = 0;
  for (const l of fresh) { saveLock(store, preserve(l)); newCount++; }
```

with:

```js
  let newCount = 0;
  for (const l of fresh) {
    const { record, photos } = splitPhotos(l);
    saveLock(store, preserve(record));
    if (photos.length) { importForLock(record.id, photos).then(() => { invalidatePhotos(record.id); render(); }); }
    newCount++;
  }
```

- [ ] **Step 2: Same on the conflict "copy" path**

In `runImportApply()` (line 1215–1219), replace the `if (imp.choices[i] === 'copy')` body:

```js
    if (imp.choices[i] === 'copy') {
      const { record, photos } = splitPhotos(c.incoming);
      const id = `lock-${Date.now()}-${i}`;
      saveLock(store, preserve({ ...record, id }));
      if (photos.length) importForLock(id, photos);
      added++;
    }
```

- [ ] **Step 3: Purge photos on delete**

In the `del-lock` handler (line 2461), after `deleteLock(store, id);` add:

```js
      deleteAllForLock(id); // async fire-and-forget; the record is already gone
      invalidatePhotos(id);
```

- [ ] **Step 4: Manual verify**

Export a lock-with-photos file (Task 10). Delete the lock (confirm its photos are gone from the picker and the list). Import the file back → the lock returns and its photo reappears after a moment. Confirm the saved localStorage record has `photoCount` but no `photos` field (DevTools → Application → Local Storage → `g1r.locks`).

Run: `node --test` → all pass. `node --check src/ui/app.js` → no output.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(photos): restore photos on import, purge on delete"
```

---

## Task 12: e2e flow + changelog entry + final verification

**Files:**
- Create: `e2e/photos.js`
- Modify: `src/ui/app.js` (CHANGELOG ~line 31; CHANGELOG_VERSION line 28)

- [ ] **Step 1: Inspect the e2e harness**

Read `e2e/harness.js` and `e2e/locks.js` to learn the existing browser-driving helpers (how a page is launched, how a lock is created/solved). Reuse them — do NOT invent a new harness.

- [ ] **Step 2: Write the e2e flow**

Create `e2e/photos.js` driving a real browser (follow `e2e/locks.js`'s structure exactly — same import of the harness, same launch/teardown):

```js
// e2e: attach a photo on the success screen, confirm persistence + lightbox, and that the
// share code carries no photo bytes. Mirrors the structure of e2e/locks.js.
import { /* the same harness exports e2e/locks.js uses */ } from './harness.js';

// 1. Launch the app, build + solve a small lock so the "Lock open!" screen shows.
// 2. Name the lock (so state.lockId exists and the picker enables).
// 3. Set the hidden file input (input[data-action="photo-file"]) to a tiny PNG fixture via
//    Playwright's setInputFiles, then wait for img.photo-thumb to appear.
// 4. Reload the page; navigate back to the solved lock; assert the thumbnail still renders
//    (IndexedDB persisted it).
// 5. Click the thumbnail; assert .photo-lightbox img appears; press Escape; assert it's gone.
// 6. Open the lock's ⇪ share code; assert the textarea value length is small (< 2000 chars),
//    proving photos are excluded from share codes.
// Print "photos e2e: OK" on success; throw on any failed assertion.
```

Fill in the body using the concrete harness API discovered in Step 1 and a small PNG fixture (a few-pixel data URL written to a temp file, or an existing fixture under `e2e/artifacts`). Add the run to `justfile`'s `e2e` recipe if other suites are listed there.

- [ ] **Step 3: Run the e2e flow**

Run: `node e2e/photos.js`
Expected: prints `photos e2e: OK`, exit 0.

- [ ] **Step 4: Add the changelog entry**

In `src/ui/app.js`, bump `CHANGELOG_VERSION` (line 28) from `'1.4.0'` to `'1.5.0'`, and prepend a new entry to `CHANGELOG` (line 31):

```js
  {
    date: '2026-06-19',
    items: [
      'Save up to 2 photos on the “Lock open!” screen — paste a screenshot or choose an image file. Photos show as thumbnails, click to enlarge, and you can manage them later from a saved lock’s ✎ editor. They’re kept on this device (in your browser) and stay out of share codes; use “Export all + photos” or a lock’s ⬇ button to back them up to a file.',
    ],
  },
```

- [ ] **Step 5: Full verification**

Run: `node --test` → all pass.
Run: `node --check src/ui/app.js src/photos.js src/storage.js` → no output.
Run: `node e2e/photos.js` → `photos e2e: OK`.
Manual: re-run the whole happy path (add via file, add via paste, remove, reload, lightbox, edit-from-editor, list thumbnail, all three export paths, import round-trip, delete cleanup).

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js e2e/photos.js justfile
git commit -m "feat(photos): e2e coverage + changelog entry"
```

---

## Self-Review notes (for the implementer)

- **Golden rule check:** the localStorage record must NEVER contain a `photos` field. It's enforced in `splitPhotos` (import) and by `syncLock` never adding one. If you ever see `photos` in `g1r.locks`, a path is bypassing `splitPhotos`.
- **Async/sync bridge:** every photo mutation is async and ends by calling `render()` itself — the click/change cases `return` WITHOUT the trailing `render()` (they're in the early-return group like `copy-share`).
- **Object-URL leaks:** URLs are revoked only in `invalidatePhotos` (and list-thumb invalidation). Don't create object URLs in `render()` directly — always go through the caches.
- **Spec coverage map:** Task 1–2 = data model/portability; Task 3 = IndexedDB+downscale; Tasks 5–6 = picker on both surfaces; Task 7 = paste+choose-file; Task 8 = lightbox; Task 9 = list thumbnail; Task 10 = export (photo-free + with-photos, bulk + single-lock); Task 11 = import restore + delete cleanup; Task 12 = tests + changelog.
- **Out of scope (do not add):** drag-&-drop, >2 photos, captions, cropping, cloud sync, photos-in-share-codes.
