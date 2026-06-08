# Changelog "New" badge — design

## Goal

Show a "New" badge on the Changelog button when there are changelog updates the
user hasn't seen yet. Opening the changelog clears the badge until the next
update. The author controls *when* the badge reappears via a single semver
constant, so trivial edits (typo fixes, wording) don't re-badge everyone.

## Approach

A single source of truth for "the latest changelog version", compared against a
per-browser "last seen version" persisted in settings. The badge logic is a
pure, unit-tested helper; `app.js` does the DOM and persistence wiring.

### Data

In `src/ui/app.js`, alongside the existing `CHANGELOG` array, add one constant:

```javascript
// Bump when a changelog update should re-show the "New" badge.
// Leave unchanged for silent edits (typos, rewording).
const CHANGELOG_VERSION = '1.3.0';
```

The `CHANGELOG` array is unchanged — entries stay keyed by `date` for display.

Existing entries map to versions for reference only (not stored): 2026-06-05 =
1.0.0, 2026-06-06 = 1.1.0, 2026-06-07 = 1.2.0, 2026-06-08 = 1.3.0. `package.json`
stays independent of this constant.

### Pure helper — `src/ui/changelog-badge.js`

Two pure functions, no DOM, no storage:

- `semverGt(a, b)` — true when semver string `a` is strictly greater than `b`.
  Compares `major.minor.patch` numerically (split on `.`, coerce to Number,
  compare left to right). Missing parts coerce to 0.
- `shouldShowBadge(currentVersion, lastSeenVersion)` — true when
  `lastSeenVersion` is falsy (never opened) **or**
  `semverGt(currentVersion, lastSeenVersion)`.

### Persistence

New setting key `lastSeenChangelogVersion` on the existing settings object,
stored in `localStorage['g1r.settings']` via the existing
`loadSettings`/`saveSettings` (no change to `storage.js`).

### Wiring in `app.js`

- On building the changelog button (~`app.js:277-281`): if
  `shouldShowBadge(CHANGELOG_VERSION, settings.lastSeenChangelogVersion)`,
  append `<span class="ap-badge-new">New</span>` to the button.
- In `openChangelog()` (~`app.js:245`): set
  `settings.lastSeenChangelogVersion = CHANGELOG_VERSION`, call
  `saveSettings(store, settings)`, and remove the badge span from the button so
  it disappears immediately without a re-render.

### Badge UI

A `.ap-badge-new` span styled to read as a small "New" pill on the button.
Match existing button/badge styling in the stylesheet.

## Data flow

1. Page load → `loadSettings` → `settings.lastSeenChangelogVersion`.
2. Build button → `shouldShowBadge(CHANGELOG_VERSION, lastSeen)` decides badge.
3. User clicks → `openChangelog()` writes `lastSeenChangelogVersion =
   CHANGELOG_VERSION`, saves, removes badge.
4. Next load → versions equal → no badge, until the author bumps
   `CHANGELOG_VERSION`.

## Edge cases

- **Never opened / new browser** (`lastSeenChangelogVersion` undefined): badge
  shows. (Acceptable — a fresh user seeing "New" once is fine; opening clears it.)
- **Stored version ahead of current** (downgrade/rollback): `semverGt` is false,
  no badge. No false positives.
- **Malformed stored value**: numeric coercion of non-numeric parts → `NaN`;
  guard by treating any non-matching comparison as "not greater" (no badge)
  rather than throwing. The helper must never throw on bad input.

## Testing

`test/changelog-badge.test.js` (node:test), covering `semverGt` and
`shouldShowBadge`:

- `semverGt`: greater major/minor/patch true; equal false; lesser false;
  different segment lengths (`1.3` vs `1.2.9`); malformed input never throws.
- `shouldShowBadge`: falsy last-seen → true; equal → false; current greater →
  true; current lesser → false.

DOM wiring in `app.js` follows the existing untested-wiring convention; the
testable logic lives entirely in the helper.

## Out of scope

- Per-entry "New" markers inside the modal (would need per-entry versions; cheap
  to add later if wanted).
- Syncing `package.json` to `CHANGELOG_VERSION`.
