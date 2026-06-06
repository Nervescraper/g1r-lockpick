# Gothic 1 Remake Lockpick Solver

Web tool to map and solve the Gothic 1 Remake lockpicking puzzle.
See `docs/specs/2026-06-05-g1r-lockpick-solver-design.md`.

## Run the app

    python3 scripts/serve.py        # http://localhost:8000

This dev server disables caching, so a normal reload always loads your latest JS/CSS
(plain `python3 -m http.server` can serve stale cached modules).

While solving, keyboard shortcuts step through the plan — **Enter / Space / ↓ / →** to
advance and **↑ / ← / Backspace** to go back (**R** resets the pins). A checkbox at the
bottom of the page turns the shortcuts off for anyone who prefers not to use them; hover
the "Keyboard shortcuts" label to see the full list.

## Run the tests

    node --test

(Requires Node 18+; no dependencies to install.)

## License

Released under the [MIT License](LICENSE).

## Disclaimer

This is an unofficial, fan-made tool. It is not affiliated with, endorsed by, or
sponsored by THQ Nordic, Alkimia Interactive, or any rights holder of the Gothic
franchise. "Gothic" and "Gothic 1 Remake" are trademarks of their respective
owners. No game assets are included or distributed with this project.
