// Pure logic for the changelog "New" badge. No DOM, no storage — app.js wires
// these into the button and settings.

// Parse a semver-ish string into [major, minor, patch]. Missing or non-numeric
// segments coerce to 0, so malformed input never throws.
function parse(version) {
  const parts = typeof version === 'string' ? version.split('.') : [];
  return [0, 1, 2].map((i) => {
    const n = Number(parts[i]);
    return Number.isFinite(n) ? n : 0;
  });
}

// True when semver string `a` is strictly greater than `b`.
export function semverGt(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

// True when the "New" badge should show: never opened (no last-seen version),
// or the current version is newer than what was last seen.
export function shouldShowBadge(currentVersion, lastSeenVersion) {
  if (!lastSeenVersion) return true;
  return semverGt(currentVersion, lastSeenVersion);
}
