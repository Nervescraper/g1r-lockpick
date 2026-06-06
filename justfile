# List available recipes
default:
    @just --list

# Assemble the clean dist/ (site assets only — no docs/tests/scripts)
build:
    ./scripts/build-site.sh

# Build, then deploy dist/ to Cloudflare Pages
publish: build
    npx wrangler pages deploy dist --project-name=g1r-lockpick

# Run the test suite
test:
    node --test
