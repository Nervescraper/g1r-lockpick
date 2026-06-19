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
