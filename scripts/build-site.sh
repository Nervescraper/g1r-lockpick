#!/usr/bin/env bash
# Assemble dist/ with only the files the live site needs.
# Everything else (docs/, test/, scripts/, package.json, README, LICENSE) stays
# out of the public deploy. Run from anywhere; paths resolve to the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

# Site assets — the runtime app, styles, markup, and icons.
cp "$ROOT/index.html" "$DIST/"
cp -R "$ROOT/css" "$DIST/"
cp -R "$ROOT/src" "$DIST/"
cp "$ROOT/favicon.ico" "$ROOT/favicon-32.png" "$ROOT/favicon.svg" \
   "$ROOT/apple-touch-icon.png" "$DIST/"

# Cloudflare Pages config — cache-control headers so app code revalidates.
cp "$ROOT/_headers" "$DIST/"

# Stamp the CSS/JS references with short content hashes so every republish is
# fetched fresh when (and only when) those files change — no manual version
# bumps, even behind a long browser cache TTL. index.html itself is always
# revalidated, so it hands clients the new hashed URLs immediately.
css_v="$(shasum "$DIST/css/styles.css" | cut -c1-10)"
app_v="$(shasum "$DIST/src/ui/app.js" | cut -c1-10)"
perl -0pi -e "s{(\Qcss/styles.css\E)\?v=[^\"']*}{\$1?v=$css_v}g; s{(\Qsrc/ui/app.js\E)\?v=[^\"']*}{\$1?v=$app_v}g" "$DIST/index.html"
echo "Stamped cache-busters: styles.css?v=$css_v  app.js?v=$app_v"

echo "Built site into $DIST"
find "$DIST" -type f | sed "s|$DIST/|  |" | sort
