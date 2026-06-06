# Gothic 1 Remake Lockpick Solver

Web tool to map and solve the Gothic 1 Remake lockpicking puzzle.
See `docs/specs/2026-06-05-g1r-lockpick-solver-design.md`.

## Run the app

    python3 scripts/serve.py        # http://localhost:8000

This dev server disables caching, so a normal reload always loads your latest JS/CSS
(plain `python3 -m http.server` can serve stale cached modules). The page also has a
**"⟲ Reset all data & reload"** link at the bottom that clears all saved state
(current work + saved locks) and reloads.

## Run the tests

    node --test

(Requires Node 18+; no dependencies to install.)
