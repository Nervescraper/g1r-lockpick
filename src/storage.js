const LOCKS_KEY = 'g1r.locks';
const SESSION_KEY = 'g1r.session';
const SETTINGS_KEY = 'g1r.settings';

export function loadLocks(store) {
  const raw = store.getItem(LOCKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveLock(store, lock) {
  const locks = loadLocks(store);
  const i = locks.findIndex((l) => l.id === lock.id);
  if (i >= 0) locks[i] = lock;
  else locks.push(lock);
  store.setItem(LOCKS_KEY, JSON.stringify(locks));
  return locks;
}

export function getLock(store, id) {
  return loadLocks(store).find((l) => l.id === id) || null;
}

export function deleteLock(store, id) {
  const locks = loadLocks(store).filter((l) => l.id !== id);
  store.setItem(LOCKS_KEY, JSON.stringify(locks));
  return locks;
}

export function saveSession(store, session) {
  store.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(store) {
  const raw = store.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadSettings(store) {
  const raw = store.getItem(SETTINGS_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function saveSettings(store, settings) {
  store.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export { LOCKS_KEY, SESSION_KEY, SETTINGS_KEY };

// ---------- import / export ----------

const FORMAT = 'g1r-locks';
const VERSION = 1;
const N_MIN = 3;
const N_MAX = 8;

// Build the transport envelope. `exportedAt` is stamped by the caller (which has Date)
// so this module stays free of ambient time.
function envelope(locks, exportedAt) {
  return { format: FORMAT, version: VERSION, exportedAt: exportedAt ?? null, locks };
}

// Pretty JSON for the bulk "Export all" file download.
export function exportLocks(locks, exportedAt) {
  return JSON.stringify(envelope(locks, exportedAt), null, 2);
}

// Compact, paste-safe base64 code for sharing a single lock.
export function encodeShare(lock, exportedAt) {
  const json = JSON.stringify(envelope([lock], exportedAt));
  return base64Encode(json);
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in browsers and modern Node globals.
  return btoa(bin);
}

function base64Decode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Accept either raw envelope JSON (file) or a base64 share code. Returns
// { locks, invalidCount } with malformed records dropped, or null if the input
// can't be read as a g1r export at all.
export function parseImport(text) {
  const env = readEnvelope(text);
  if (!env || env.format !== FORMAT || !Array.isArray(env.locks)) return null;
  const locks = [];
  let invalidCount = 0;
  for (const l of env.locks) {
    if (isValidLock(l)) locks.push(l);
    else invalidCount++;
  }
  return { locks, invalidCount };
}

function readEnvelope(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  // First try as raw JSON (file/paste), then as a base64 share code.
  let env = tryParse(text);
  if (env && typeof env === 'object') return env;
  let decoded;
  try {
    decoded = base64Decode(text.trim());
  } catch {
    return null;
  }
  return tryParse(decoded);
}

function isInt(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

function isValidLock(l) {
  if (!l || typeof l !== 'object') return false;
  if (typeof l.id !== 'string' || !l.id) return false;
  if (!isInt(l.n, N_MIN, N_MAX)) return false;
  const n = l.n;
  if (l.initial != null) {
    if (!Array.isArray(l.initial) || l.initial.length !== n) return false;
    if (!l.initial.every((p) => isInt(p, 1, 7))) return false;
  }
  if (l.coupling != null) {
    if (!Array.isArray(l.coupling) || l.coupling.length !== n) return false;
    for (const row of l.coupling) {
      if (!Array.isArray(row) || row.length !== n) return false;
      if (!row.every((v) => v === -1 || v === 0 || v === 1)) return false;
    }
  }
  if (l.status != null) {
    if (!Array.isArray(l.status) || l.status.length !== n) return false;
  }
  return true;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Two lock records describe the same physical lock: same location + type + description.
export function sameIdentity(a, b) {
  return (
    norm(a.location) === norm(b.location) &&
    (a.kind || 'Chest') === (b.kind || 'Chest') &&
    norm(a.description) === norm(b.description)
  );
}

function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Split incoming locks against the existing collection:
//   fresh     — no match; import as-is
//   identical — same id and deep-equal content; skip silently (clean re-import)
//   conflicts — same id with different content, OR different id but same identity;
//               each is { incoming, existing } for review
export function classifyImport(incoming, existing) {
  const fresh = [];
  const identical = [];
  const conflicts = [];
  for (const inc of incoming) {
    const byId = existing.find((e) => e.id === inc.id);
    if (byId) {
      if (sameContent(byId, inc)) identical.push(inc);
      else conflicts.push({ incoming: inc, existing: byId });
      continue;
    }
    const byIdentity = existing.find((e) => sameIdentity(e, inc));
    if (byIdentity) conflicts.push({ incoming: inc, existing: byIdentity });
    else fresh.push(inc);
  }
  return { fresh, identical, conflicts };
}
