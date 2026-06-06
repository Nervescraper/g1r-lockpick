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

# Stamp content hashes so every republish is fetched fresh when (and only when)
# files change — no manual version bumps, even behind a long browser cache TTL.
# index.html itself is always revalidated, so it hands clients the new hashed URLs.
#
# The CSS is a leaf: it gets its own content hash. The JS is one module graph, so a
# single build-wide token (hashed over the whole src/ tree) is stamped on BOTH the
# index.html entry reference AND every relative import inside the modules. That way
# any change to any module bumps every JS URL together and busting is unconditional —
# a dependent can never load against a stale dependency, the failure you'd get if
# only the entry point's URL changed while a cached import quietly stayed behind.
css_v="$(shasum "$DIST/css/styles.css" | cut -c1-10)"
# Hash of per-file content hashes (sorted, paths stripped) — stable and path-independent.
build_v="$(find "$DIST/src" -type f -name '*.js' | sort | xargs shasum | awk '{print $1}' | shasum | cut -c1-10)"

# index.html references.
perl -0pi -e "s{(\Qcss/styles.css\E)\?v=[^\"']*}{\$1?v=$css_v}g; s{(\Qsrc/ui/app.js\E)\?v=[^\"']*}{\$1?v=$build_v}g" "$DIST/index.html"

# Every relative .js import specifier inside the modules, e.g. from '../storage.js'
# -> from '../storage.js?v=<build_v>'. Resolution ignores the query, so /src/* still
# resolves to the file (and the _headers /src/* rule still matches).
find "$DIST/src" -type f -name '*.js' -print0 \
  | xargs -0 perl -0pi -e "s{(from\s+['\"])(\.\.?/[^'\"]+?\.js)(['\"])}{\$1\$2?v=$build_v\$3}g"

echo "Stamped cache-busters: styles.css?v=$css_v  js?v=$build_v"

echo "Built site into $DIST"
find "$DIST" -type f | sed "s|$DIST/|  |" | sort
