# List available recipes
default:
    @just --list

# Assemble the clean dist/ (site assets only — no docs/tests/scripts)
build:
    ./scripts/build-site.sh

# Build, then deploy dist/ to Cloudflare Pages
publish: build
    npx wrangler pages deploy dist --project-name=g1r

# Run the test suite
test:
    node --test

# Fixture sanity checks (no browser), then the full end-to-end suite
e2e:
    node e2e/preflight.js
    node e2e/strategy-sim.js
    node e2e/run.js
    node e2e/explore.js
