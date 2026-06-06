# Solver Performance: A\* Heuristic + Integer Feasibility Precheck — Design

**Date:** 2026-06-06
**Status:** Approved (pre-implementation)

## Goal

The solver is correct and switch-optimal (see
`docs/specs/2026-06-06-solver-minimize-plate-switches-design.md`) but has two pathological
slow cases, both measured:

- **Unsolvable / incomplete mappings** exhaust the whole reachable space before returning
  `null` — measured **~63 s / 5.6M states** for an 8-plate case. Incomplete mappings are the
  #1 real-world "no solution" trigger.
- **Deep + weakly-coupled locks** (plates near-independent, pins far from centre) sweep a
  large fraction of the `7ⁿ` space — measured **~25 s / 3.3M states / 1.2 GB** for an
  uncoupled 7-plate lock.

Separately, adding the `lastPlate` state dimension gave the current solver a **~4–5×
memory increase over the original BFS on normal locks** (still small in absolute terms:
hundreds of KB to ~5 MB, but a regression).

This change makes the solver fast and memory-light on **all** locks while preserving exact
move-optimality and switch-minimization. Measured/expected outcomes:

| Case | Current | After |
| --- | --- | --- |
| Normal coupled lock (n=5) | ~12.7k states / ~5 MB | **~0.8k states / ~0.3 MB** (below original BFS) |
| Unsolvable / incomplete | ~63 s exhaustion | **instant** (`null` from precheck) |
| Deep uncoupled (n=7) | ~25 s / 3.3M states | **milliseconds** (heuristic is exact here) |

## Approach (decided): A\* with the `‖x‖₁` heuristic + integer-feasibility precheck

Two cooperating pieces, both grounded in the same linear-algebra fact.

### The core fact

A move on plate `i` adds `±coupling[i]` to the position vector. So the net effect of a whole
plan is linear: with `x_i` = net signed moves on plate `i`,

```
xᵀ · C = goal − start          (C = coupling matrix, row i = coupling[i])
```

When `C` is invertible, `x = C⁻ᵀ(goal − start)` is **unique**. Moreover, **each single move
changes exactly one component of `x` by ±1** (a move on plate `j` shifts the position by
`±coupling[j] = ±Cᵀeⱼ`, so `Δx = ±C⁻ᵀCᵀeⱼ = ±eⱼ`). Two consequences:

1. **Integer feasibility.** A solution drives `x` from its start value to `0` in unit steps,
   so a solvable lock has an **integer** `x`. If any `x_i` is non-integer, the lock is
   **unsolvable** — return `null` with no search. (This rules solutions *out* only; an
   integer `x` can still be bounds-blocked, which the search resolves normally.)
2. **A near-perfect heuristic.** Reaching the goal needs at least `‖x(pos)‖₁` more moves, and
   since each move changes `‖x‖₁` by at most 1, `h(pos) = ‖C⁻ᵀ(goal − pos)‖₁` is an
   **admissible and consistent** heuristic. It is *exact* precisely for the uncoupled/deep
   locks that are slow today.

### Piece 1 — Integer-feasibility precheck

At the top of `solve()`, if `C` is invertible, compute the net-move numerator and reject
non-integer `x` immediately as `null`. If `C` is singular, skip the precheck.

### Piece 2 — A\* search

Keep everything about the current uniform-cost solver — state `(position, lastPlate)`,
`MinHeap` frontier, lexicographic cost — but change the **primary** ordering key from `moves`
to `moves + h(pos)`. Concretely the heap orders by `[g + h, switches]` lexicographically,
where `g` is moves so far. Relaxation and the stale-entry skip continue to compare the true
cost `[moves, switches]` (the goal/`best` bookkeeping is on real cost, not `f`).

**Optimality preserved.** A\* with a consistent heuristic is equivalent to Dijkstra on
reduced edge costs `w'(u,v) = 1 − h(u) + h(v) ≥ 0`; the reduced path cost differs from the
true move count only by the constant `h(start)`, so move-ordering is unchanged, and the
secondary `switches` key is untouched by the transformation. Stopping when the goal is
**popped** therefore yields min-moves, then min-switches — identical answers to today's
solver, with far fewer states expanded.

### Piece 3 — Singular-matrix fallback

If `C` is not invertible (`det = 0`), set `h ≡ 0` and skip the precheck. The search degrades
to exactly today's correct Dijkstra — safe, just without the speedup. Singular couplings are
rare (e.g. two plates that always move identically) and already handled correctly today.

### Piece 4 — Node-cap backstop

The existing `maxNodes` cap stays as a backstop for the rare hard *feasible* lock where
bounds force many detours and `h` is not exact. With the heuristic, realistic locks never
approach it. (`maxNodes` default unchanged at `8_000_000`; the cap can't exceed V8's ~16.7M
`Map`-entry limit regardless — documented in `docs/notes/solver-optimality.md`.)

## Linear algebra (exact, no floats)

Float inverses risk misclassifying the integer check, so use **exact integer arithmetic**.
For `n ≤ 8` with coupling entries in `{−1, 0, 1}`, all intermediate values stay tiny
(Hadamard bound: `|det| ≤ 8⁴ = 4096`), well within JS safe integers.

New module `src/linalg.js`, pure and independently tested:

- `det(M)` — integer determinant via fraction-free (Bareiss) elimination.
- `adjugateTimesVector(M, v)` — returns the integer vector `adj(M)·v` so that
  `M⁻¹·v = adj(M)·v / det(M)` without floating point. (Implemented via cofactors or by
  solving with Bareiss; either is fine for `n ≤ 8`.)
- `netMoves(coupling, delta)` — convenience wrapper returning
  `{ det, numer }` where `numer = adj(Cᵀ)·delta` and `x_i = numer_i / det`. Returns
  `det = 0` for singular `C`.

The solver precomputes `{ det, M = adj(Cᵀ) }` once. Then for any position:

- `numer = M · (goal − pos)` (integer vector).
- **Precheck (start only):** unsolvable if `det !== 0` and any `numer_i % det !== 0`.
- **Heuristic:** `h(pos) = Σ_i |numer_i / det|` using exact integer division (each `numer_i`
  is divisible by `det` on reachable states). Guard with `det === 0 → h = 0`.

## Module / file structure

- **Create** `src/linalg.js` — exact integer matrix helpers (`det`, `adjugateTimesVector`,
  `netMoves`). No DOM, no solver knowledge.
- **Create** `test/linalg.test.js` — unit tests for the linear algebra.
- **Modify** `src/solver.js` — add the precheck + A\* heuristic; singular fallback; reuse
  `MinHeap`. Public signature and `move[] | null` contract unchanged.
- **Modify** `test/solver.test.js` — add differential tests vs. the current solver behaviour
  and performance-regression guards.
- **Modify** `docs/notes/solver-optimality.md` — note that A\* is now implemented (with the
  stronger `‖x‖₁` heuristic, not the weaker `max|pos−4|` originally sketched) and the
  integer precheck, superseding the "future work" recommendation there.

## Testing

The headline safety property — **plans never leave bounds** — and switch-optimality are
already covered by the existing sweep and DP-oracle tests; those must stay green unchanged
(the new solver returns identical plans). New tests:

1. **`src/linalg.js` units** — determinant of known matrices (identity, triangular, singular
   → 0); `adj(M)·v / det` matches the true inverse-times-vector on invertible cases;
   integer vs non-integer net-move detection on hand-built locks.
2. **Differential equivalence vs. the current solver (strongest guarantee).** Over the
   existing generated sweep (n=2 exhaustive + seeded n=3..5), assert the new solver returns
   the **same solvability**, the **same plan length**, and the **same switch count** as a
   reference copy of the current Dijkstra solver. (The reference is small; inline it in the
   test or compare against `bfsShortest` length + the DP oracle's switch count already
   present.) This proves the speedup changed nothing observable.
3. **Precheck correctness** — a hand-built unsolvable invertible lock (non-integer `x`)
   returns `null`; a solvable one does not. A singular unsolvable lock still returns `null`
   (via fallback search), and a singular solvable lock still solves.
4. **Performance-regression guards (deterministic).** The uncoupled 7-plate all-1 lock —
   which returns a *false* `null` under the heuristic-less search at the 8M cap — now
   returns a **valid 21-move plan** (7 plates × +3 each; proving the heuristic made it
   tractable within the cap).
   The 8-plate unsolvable case returns `null` (fast via precheck). These assert *outcome*,
   not wall-clock, so they're stable in CI.
5. **All existing solver/heap tests stay green.**

## Out of scope

- The time-budget / "gave up vs. no solution" UI signal — not needed once the slow cases are
  eliminated at the root; can be revisited if a hard feasible lock ever surfaces.
- Lifting the 8-plate `maxNodes`/`Map` ceiling further (still bounded by V8's 16.7M limit).
- Any UI change — `solve()`'s contract is unchanged.
