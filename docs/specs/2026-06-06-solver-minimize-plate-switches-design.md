# Solver: Minimize Plate Switches — Design

**Date:** 2026-06-06
**Status:** Approved (pre-implementation)

## Goal

The solver (`src/solver.js`) returns a shortest (fewest-moves) edge-free plan. In the
game, every move is a slide of one selected plate; switching to a *different* plate is an
extra interaction (re-select the plate) and a fresh chance to mis-click. Two plans of the
same length can differ a lot in how often they make the player jump between plates.

Make the solver, **among all shortest solutions, return one with the fewest plate
switches.** Move count stays optimal — we never trade a longer plan for fewer switches.

### Objective (decided)

**Moves first, then switches.** Lexicographic: primary key = total moves (unchanged from
today's optimum), secondary key = number of plate switches. A plan is never lengthened to
save a switch.

### Definitions

- **Plate switch:** an adjacent move-pair `(moves[i], moves[i+1])` where
  `moves[i].plate !== moves[i+1].plate`. The first move costs **0** switches (the initial
  plate selection is unavoidable). A plan of length 0 or 1 has 0 switches.
- All other invariants are unchanged: every returned move is legal (in-bounds), so any
  returned path is **edge-free**; `solve()` returns `move[] | null`.

## Why move order is the whole game here

Couplings are linear and additive, so the *final* position depends only on the net moves,
not their order. Reordering the same multiset of moves is therefore free for the result —
the only constraint is that **every intermediate step must stay in 1..7**. Grouping moves
by plate can occasionally push a plate to an edge mid-run, so the minimum-switch ordering
is not always a trivial sort: it must be found by search that respects bounds at each step.

## Approach (decided): uniform-cost search with a lexicographic cost

Replace the FIFO BFS with a Dijkstra-style uniform-cost search.

- **State:** `(positionKey, lastPlate)`. The `lastPlate` dimension is required because the
  switch cost of a move depends on which plate moved previously. `lastPlate` is `null` at
  the start (first move = 0 switches). This multiplies the state space by ≤ n+1
  (n = plate count ≤ 7), which stays comfortably within the existing budget.
- **Path cost:** the pair `[moves, switches]`, compared **lexicographically**. Each move
  adds `1` to `moves`; a move whose plate differs from `lastPlate` (and `lastPlate !== null`)
  adds `1` to `switches`.
- **Frontier:** a binary min-heap ordered by the lexicographic `[moves, switches]` key.
  No magic "BIG" multiplier — we compare the pair directly, so there is no fragile
  "large enough" assumption.
- **Optimality:** because `moves` is the primary key, the first time the goal is popped it
  is reached via a minimum-moves path; the heap order guarantees that among
  minimum-moves paths it is the one with minimum switches. (Standard uniform-cost-search
  optimality with a strict lexicographic order; non-negative edge costs.)
- **Reuse:** `applyMove`, `legalMoves`, `isSolved` from `src/model.js` are used unchanged.
- **Backstop:** keep an expansion cap analogous to today's `maxNodes` so a pathological
  input can't run unbounded; on hitting it, return `null` (same as today).

### Sketch

```js
// min-heap ordered by [moves, switches] lexicographically.
// state key = positionKey + '|' + lastPlate   (lastPlate '' at start)
export function solve(positions, coupling, { maxNodes = 2_000_000 } = {}) {
  const start = positions.slice();
  if (isSolved(start)) return [];

  const startKey = start.join(',') + '|';        // lastPlate = none
  const best = new Map([[startKey, [0, 0]]]);     // stateKey -> [moves, switches]
  const parent = new Map();                       // stateKey -> { prev, move }
  const open = new MinHeap();                      // ordered by [moves, switches]
  open.push({ pos: start, last: null, moves: 0, switches: 0 });
  let count = 0;

  while (!open.empty()) {
    const cur = open.pop();
    const curKey = cur.pos.join(',') + '|' + (cur.last ?? '');
    const bc = best.get(curKey);
    if (lt(bc, [cur.moves, cur.switches])) continue;   // stale heap entry
    if (isSolved(cur.pos)) return reconstruct(parent, curKey, startKey);

    for (const mv of legalMoves(cur.pos, coupling)) {
      const np = applyMove(cur.pos, coupling, mv.plate, mv.dir);
      const nMoves = cur.moves + 1;
      const nSw = cur.switches + (cur.last !== null && mv.plate !== cur.last ? 1 : 0);
      const nKey = np.join(',') + '|' + mv.plate;
      const prev = best.get(nKey);
      if (!prev || lt([nMoves, nSw], prev)) {
        best.set(nKey, [nMoves, nSw]);
        parent.set(nKey, { prev: curKey, move: mv });
        open.push({ pos: np, last: mv.plate, moves: nMoves, switches: nSw });
        if (++count > maxNodes) return null;
      }
    }
  }
  return null;
}
// lt(a, b): true if pair a is lexicographically less than pair b
```

A small binary min-heap (~30 lines, no deps) lives in `src/solver.js` (or a tiny helper
module). `reconstruct` walks `parent` by state key, same idea as today.

## Relationship to the existing A\* note

`docs/notes/solver-optimality.md` proposes A\* (with `h = max_i |pos[i]-4|`) as future work
to lift the 8-plate cap. That is **orthogonal** to this change but compatible: this design
already moves to a heap-based best-first frontier, so a future PR could add the admissible
heuristic to the `moves` component to prune the search without touching the switch logic.
Out of scope here; noted so the two efforts don't collide.

## Testing

`test/solver.test.js` is extended. **The headline requirement: every solution the solver
produces must stay within plate bounds at every step.**

1. **Existing tests stay green unchanged** — they assert shortest-length and in-bounds
   replay; lengths are identical because move count is still primary.
2. **Edge-safety, exhaustive on small locks** — generate a spread of locks (varying plate
   counts, start positions, and couplings, including coupled/edge-prone cases). For each
   solvable one, replay the returned plan with `applyMove` and assert **every intermediate
   position is within `MIN..MAX`**. This is the explicit "never slides past an edge"
   guarantee, checked across many generated inputs, not just hand-picked cases.
3. **Move-count optimality preserved** — for a set of locks, assert the new plan length
   equals the old BFS plan length (compute the old length via a reference shortest-path /
   BFS in the test) so we prove switches were reduced *without* adding moves.
4. **Switches actually reduced** — at least one fixture where the naive shortest path has
   more plate switches than the optimized plan; assert the optimized plan's switch count is
   `<=` a hand-computed BFS plan's switch count, and strictly `<` on a constructed case.
5. **Switch-count metric** — small unit test of the switch-counting definition (first move
   = 0 switches; runs on the same plate add 0; alternating plates count each change).
6. **Unsolvable still returns `null`** — zero-coupling and unreachable-goal cases unchanged.

## Out of scope

- Changing the objective to ever lengthen a plan for fewer switches.
- A\* heuristic / 8-plate cap work (tracked separately in the optimality note).
- Any UI change — the walkthrough already renders whatever move sequence `solve()` returns.
