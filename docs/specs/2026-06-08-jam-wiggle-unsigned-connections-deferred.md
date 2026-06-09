# DEFERRED: recording unsigned connections from jams (wiggle data)

Date: 2026-06-08
Status: **Deferred** — cut from the lock-mapping-guidance spec
(`2026-06-08-lock-mapping-guidance-design.md`). Captured here to revisit if needed.

## The idea

When a probe jams (costs durability), the coupled plates *wiggle in place* — they
don't move a full slot — so you learn the plates are connected but **not the
direction**. With several wiggling at once it's also hard to remember which. Today
that hard-won, durability-costed information is thrown away.

Proposed feature: let the player record those direction-unknown connections and work
them toward resolution.

- **Data:** a parallel `mapping.pending[i][j] ∈ {0,1}` matrix = "pressing i wiggled
  j — connected, sign unknown." Kept separate from the numeric `coupling` so the
  solver/`applyMove` stay clean. Per-cell invariant: untested (`0/0`) vs signed
  (`coupling != 0`) vs unsigned-connected (`coupling 0, pending 1`); setting a sign
  clears the matching pending cell.
- **Recording a jam:** a distinct "Plate jammed (didn't move a slot)" outcome and a
  per-plate "wiggled" toggle. Sets `pending[i][j]=1`; positions unchanged; plate
  marked `partial`. Tolerant of partial/uncertain memory; editable.
- **Surfacing:** wiggled-but-unsigned links drawn on the board with a distinct
  marker/colour; a worklist line ("Found, direction unknown: P5→P2, P5→P3 — re-probe
  P5 once edges are clear").
- **Recommender steering:** once edges are clear, prefer candidates whose row has
  pending cells so you re-probe and resolve them.
- **Auto-resolve:** a later clean read of plate i overwrites its row and clears
  `pending[i][*]`.

## Why it was deferred

The mapping-guidance design added machinery that *prevents* jams rather than
*salvaging* them (live positions, edge-clearing phase, the known-move planner,
Done/Skip board sync). Against that backdrop the wiggle feature is largely
redundant:

1. **Unsigned links feed none of the new machinery.** The edge-clearing planner
   needs *signed* couplings to compute `applyMove`; `probeSafe` is already
   conservative (any other plate at an edge → unsafe), so knowing which unsigned
   plate blocks doesn't change its verdict.
2. **A clean re-probe supersedes the data.** The only way to resolve an unsigned
   link is to cleanly re-probe that plate once edges are clear — which yields the
   entire row anyway. In the happy path the wiggle data saved nothing.
3. **Jams become rare.** They're now an exceptional early-game event (multiple edge
   plates with nothing mapped yet to clear them), not a routine mechanic.
4. **A jam needs no app action without the feature.** Nothing moved a slot, so the
   board is unchanged — the player just doesn't save, clears edges, and retries. The
   edge coaching already covers this.

So the feature spent significant UI/model surface (jam outcome, wiggled toggle,
pending matrix, board surfacing, worklist, auto-resolve, has-pending steering) on
information that is redundant the moment you re-probe.

## When to revisit

Reconsider if real play shows any of:

- Jams turn out to be **common or unavoidable** in practice (e.g. locks where edges
  can't be cleared with known moves often enough), so salvaging partial info would
  save meaningful durability.
- We add **planning-under-uncertainty** features that *can* consume unsigned links
  (e.g. inferring couplings across constraints, or risk-ranking probes using known
  partial connectivity).
- Players ask to **not lose** the observation from a forced jam for their own
  manual reasoning, independent of whether the app can act on it.

If revisited, the design above is self-contained and additive on top of the shipped
mapping-guidance machinery.
