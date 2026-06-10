# Gothic 1 Remake Lockpick Solver

Web tool to map and solve the Gothic 1 Remake lockpicking puzzles.

**▶ Use it now: [g1r.nervemart.com](https://g1r.nervemart.com)** — runs entirely in your
browser, nothing to install. Keep it open on a second monitor or your phone while you play.

## What it does

Gothic 1 Remake locks are a coupled-sliders puzzle: a stack of plates, each with a pin that
has to reach the center hole, where moving one plate also nudges others by hidden, fixed
relationships. Working that out by hand — and finding a move order that never snaps a
lockpick — is tedious and error-prone. This tool maps the lock with you, then computes a
**safe, edge-free solution** (zero durability cost) and walks you through it move by move.

## How to use it

The app moves through four steps, shown as a clickable rail across the top:

1. **Lock** — start a new lock (name it by location and type) or reload a saved one. Saved
   locks jump straight to wherever you left off. Locks travel as share codes: copy one from
   the *Lock open!* screen, and paste a code anywhere on this page to import it on the spot.
2. **Setup** — enter the number of plates and each plate's current pin position. This is
   saved as the lock's *reset point*.
3. **Map the lock** — slide each plate and record how the others move, right on the board:
   each row carries **⇉ with / ⇄ opposite** tags and **◀ ▶** reposition arrows for mapped
   slides. Jams teach the app — report one with **It jammed** (and tap any slides you saw
   wiggle; each one pins down a link) and the guidance routes around it, suggesting
   repositioning moves lit up on the board when nothing is safe. Stray mistakes count via
   **Oops…**; the second mistake breaks the pick and the board resets itself to the lock's
   start, the way the game does.
4. **Solve** — once the lock is mapped, the app computes the shortest safe sequence to bring
   every pin to the center and steps you through it, grouping repeated moves into one
   "Did all N" step. Reset the pins anytime to re-plan.

If the solver reports **no solution**, the mapping is almost certainly incomplete or has a
wrong cell — head back to **Map the lock** and double-check. If a solution **fails in the
game**, there are two cases: a planned move **jams** (nothing moves — hit **It jammed** and
that slide's row is marked as provably mis-recorded, with the wiggle capture to pin the bad
link), or the pins **drift** from the board (use **Edit positions** to enter where they
really are: the app compares the drift against the moves you made and names the rows most
likely mis-recorded, with a one-tap jump to review them). While **mapping**, the same drift
is handled by **"Lock doesn't match?"**: it rewinds your recent moves one physical undo at a
time — undoing a move is always safe — and the first state where lock and board agree again
names the step that lied, leaving everything back in sync.

## Keyboard shortcuts

While solving, you can step through the plan without the mouse:

- **Enter / Space / ↓ / →** — advance to the next move
- **↑ / ← / Backspace** — go back a move
- **R** — reset the pins to the lock's starting positions

In **Setup** (and "Edit positions" while solving), **1–7** set the active plate's pin and the
**arrow keys** move between plates. A checkbox at the bottom of the page turns shortcuts off
for anyone who prefers not to use them; hover the "Keyboard shortcuts" label to see the list.

## Your data stays local

Your saved locks and progress live only in your browser (via `localStorage`) — nothing is
uploaded to a server. Clearing your browser data for the site removes them.

## License

Released under the [MIT License](LICENSE).

## Disclaimer

This is an unofficial, fan-made tool. It is not affiliated with, endorsed by, or
sponsored by THQ Nordic, Alkimia Interactive, or any rights holder of the Gothic
franchise. "Gothic" and "Gothic 1 Remake" are trademarks of their respective
owners. No game assets are included or distributed with this project.
