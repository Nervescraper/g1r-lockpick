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

echo "Built site into $DIST"
find "$DIST" -type f | sed "s|$DIST/|  |" | sort
