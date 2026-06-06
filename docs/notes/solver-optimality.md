# Solver Optimality & the 8-Plate Cap (future-work note)

**Status:** Not actioned — captured for reference. The current solver is fine for 3–7
plates and almost always fine for 8. Revisit only if an 8-plate lock ever reports a false
"No solution," or if we want an unconditional guarantee.

## What we have today

`src/solver.js` is a **breadth-first search** over position vectors. It is **optimal
(fewest moves)** whenever it returns a plan, because:

- Every move costs exactly 1 (one Left/Right slide of one plate), so "fastest" = "fewest
  moves" — a single uniform-cost metric.
- BFS expands states in non-decreasing depth order, so the goal is first reached via a
  shortest path (`solver.js` returns the instant `isSolved` is true).
- The `visited` set records each state at its first (shortest) discovery, so it never
  discards a shorter route.

It also never returns a *sub*-optimal plan: if it can't finish, it returns `null`.

## The caveat

There is a safety guard `maxNodes = 2_000_000`. The reachable state space is `7^n`:

| Plates | States (7ⁿ) | vs. 2,000,000 cap |
|--------|-------------|-------------------|
| ≤ 7    | ≤ 823,543   | always fits → complete + optimal |
| 8      | 5,764,801   | a worst-case 8-plate lock can hit the cap and return `null` even though a solution exists |

So for **8 plates** the solver is still optimal *if it answers*, but a pathologically hard
case could give up. In practice solutions are found after exploring a tiny fraction of the
space, so this is very unlikely to be observed — but it is a real gap.

**Update (2026-06-06):** the solver now also minimizes plate switches among shortest
plans (`docs/specs/2026-06-06-solver-minimize-plate-switches-design.md`). To do that the
search state gained a `lastPlate` component, multiplying the reachable state space by up
to `n+1`. The default node cap was raised to `8_000_000` so a worst-case 7-plate lock
(`7^7 × 8 ≈ 6.6M` states) still completes. Move-count optimality is unchanged — moves are
the primary cost; switches only break ties. The A* option below remains the recommended
way to lift the cap unconditionally for 8 plates, and composes cleanly: an admissible
heuristic would attach to the `moves` component without touching the switch logic.

## Option A — bump the cap (quick)

Raise `maxNodes` to at least `7 ** N_MAX` (≈ 5.76M for 8 plates) so BFS can always exhaust
the space.

- Pros: one-line change, preserves the exact current behavior/optimality.
- Cons: a worst-case 8-plate solve could hold up to ~5.76M visited keys (string vectors)
  in memory and take noticeably longer. Heavy but tolerable for a one-off solve; could be
  sluggish in a browser tab.

## Option B — switch BFS → A\* (recommended)

Replace the FIFO queue with a priority queue keyed by `f = g + h`, where `g` is moves so
far and `h` is an **admissible** heuristic. A\* with an admissible (and ideally consistent)
heuristic is still optimal, but explores far fewer states, so even worst-case 8-plate locks
become fast and light.

**Admissible heuristic:** `h(pos) = max_i |pos[i] − 4|`.

- Justification: a single move changes any one plate's pin by at most 1 (each move shifts
  the selected plate by ±1 and other plates by at most ±1). So to bring the worst-offset
  plate to 4 you need at least `max_i |pos[i] − 4|` moves. Hence `h` never overestimates →
  admissible. It is also consistent (each move changes `h` by at most 1).
- This heuristic is weak when coupling lets several plates converge together, but it's
  safe, and even a weak admissible heuristic prunes BFS dramatically near the goal.

**Sketch:**

```js
// binary min-heap of {key, pos, g, f}; visited keyed by pos.join(',')
function solve(positions, coupling) {
  if (isSolved(positions)) return [];
  const h = (p) => Math.max(...p.map((v) => Math.abs(v - 4)));
  const start = positions.slice();
  const open = new MinHeap();                 // ordered by f
  const g = new Map([[start.join(','), 0]]);
  const parent = new Map();
  open.push({ pos: start, f: h(start), g: 0 });
  while (!open.empty()) {
    const { pos, g: gc } = open.pop();
    const key = pos.join(',');
    if (gc > g.get(key)) continue;            // stale heap entry
    if (isSolved(pos)) return reconstruct(parent, key, start.join(','));
    for (const mv of legalMoves(pos, coupling)) {
      const np = applyMove(pos, coupling, mv.plate, mv.dir);
      const nk = np.join(',');
      const ng = gc + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        parent.set(nk, { prev: key, move: mv });
        open.push({ pos: np, g: ng, f: ng + h(np) });
      }
    }
  }
  return null;
}
```

- Pros: keeps the optimality guarantee, removes the practical 8-plate ceiling, lower memory
  in typical cases.
- Cons: needs a small binary-heap implementation (~30 lines, no deps); slightly more code
  than the BFS.

**Recommendation:** Option B (A\*) if/when we want the guarantee to be unconditional. Keep a
`maxNodes`/expansion cap as a backstop regardless. Existing solver tests (shortest-length
assertions, null-on-unsolvable, replay-in-bounds) should all still pass unchanged, since
A\* returns the same optimal lengths.

## Update (2026-06-06): A\* + integer precheck implemented

The recommendation above is now implemented (`docs/specs/2026-06-06-solver-performance-astar-design.md`),
with a **stronger heuristic** than the `max|pos−4|` originally sketched here. Using the
linearity of the lock (`xᵀC = goal − start`), the solver computes the exact net-move vector
`x = C⁻ᵀ(goal − pos)` via integer adjugate/determinant (`src/linalg.js`) and uses
`h(pos) = ‖x‖₁` — admissible, consistent, and *exact* for uncoupled/deep locks, which were
the slow cases. It also adds an **integer-feasibility precheck**: when `C` is invertible, a
non-integer `x(start)` proves the lock unsolvable, so incomplete/contradictory mappings
return `null` instantly instead of exhausting the space. Singular `C` falls back to `h≡0`
(plain Dijkstra). Measured: unsolvable 8-plate ~63 s → instant (precheck); a realistic
coupled 8-plate lock ~5 ms; normal coupled locks drop below the original BFS's memory. The
deep *uncoupled* 7-plate pathology improves from ~25 s to ~0.7 s (≈140k states) — not
instant, because the exact heuristic flattens the many equal-length interleavings to the
same `f`, so A\* still traverses that plateau (over the `(pos, lastPlate)` dimension) to find
the min-switch ordering; it stays far under the cap. The `maxNodes`/`Map` ceiling notes
above still apply as a backstop for rare hard feasible locks.
