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

export { RECENT_LIMIT, OTHER_KEY };
