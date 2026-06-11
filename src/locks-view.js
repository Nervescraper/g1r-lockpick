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

// A literal "Other" location intentionally merges with blank/whitespace locations
// into the same bucket — same display label means same folder.
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

// Parse a search query into { include, exclude } term lists. Terms are split on
// whitespace and lowercased; a leading "-" marks an exclude term (a bare "-" is
// ignored). Pure and DOM-free, like groupLocks.
export function parseSearch(text) {
  const include = [];
  const exclude = [];
  for (const tok of String(text ?? '').toLowerCase().split(/\s+/)) {
    if (!tok) continue;
    if (tok[0] === '-') {
      const term = tok.slice(1);
      if (term) exclude.push(term);
    } else {
      include.push(tok);
    }
  }
  return { include, exclude };
}

// True if a lock's chest contents satisfy a parsed query. Include terms are ANDed
// (each must be a substring of some item); exclude terms are ORed (any match drops it).
export function matchLockContents(lock, parsed) {
  const items = ((lock && lock.contents) || [])
    .map((c) => String(c && c.item != null ? c.item : '').toLowerCase())
    .filter(Boolean);
  for (const term of parsed.include) {
    if (!items.some((it) => it.includes(term))) return false;
  }
  for (const term of parsed.exclude) {
    if (items.some((it) => it.includes(term))) return false;
  }
  return true;
}

export function filterLocks(locks, parsed) {
  return locks.filter((l) => matchLockContents(l, parsed));
}

// Distinct item names across all locks' contents, case-insensitively deduped while
// keeping the first-seen display casing. The autocomplete pool.
export function allItemNames(locks) {
  const seen = new Set();
  const out = [];
  for (const l of locks) {
    for (const c of (l && l.contents) || []) {
      const name = String(c && c.item != null ? c.item : '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// Suggestions for the term currently being typed: names containing `token`
// (case-insensitive substring), excluding names already chosen in the box, sorted
// alphabetically and capped. Empty token => no suggestions.
export function suggestItems(names, token, alreadyChosen, limit = 8) {
  const t = String(token ?? '').toLowerCase();
  if (!t) return [];
  const chosen = alreadyChosen instanceof Set ? alreadyChosen : new Set(alreadyChosen || []);
  return names
    .map((n) => [n, n.toLowerCase()])
    .filter(([, l]) => l.includes(t) && !chosen.has(l))
    .sort(([, a], [, b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([n]) => n);
}

export { RECENT_LIMIT, OTHER_KEY };
