# Better lock-mapping guidance: live positions, drag-delta recording, edge-clearing

Date: 2026-06-08

## Problem

The guidance shown while mapping a lock is weak in several connected ways:

1. **Positions go stale during mapping.** `state.positions` is frozen at the
   setup/reset state for the entire mapping phase — clean saves only update the
   `coupling` matrix, never positions, and the board isn't draggable in mapping
   mode. So every position-based hint (which slides are on an edge, whether a probe
   is safe) is computed against the *starting* state, not where the slides actually
   are after you've pressed a few. This is the root cause of the issues below.

2. **Edges aren't framed as a phase.** A probe breaks the pick (jams) when any
   *other* plate sits at an edge (pin 1 or 7). `probeSafe` encodes this, but
   `recommendNext` only ever picks one next move and never communicates the
   strategy: *get every slide on pin 1 or 7 toward center before test-probing the
   rest.*

3. **Whack-a-mole while clearing edges.** Moving a plate off an edge often slides
   another plate (sitting on pin 2 or 6) *onto* an edge. The player has to cycle
   back and clear edges again before reaching the next unmapped edge plate. Nothing
   helps plan this, partly because (1) means the app doesn't even know the current
   positions.

## Background: current model

- `mapping.coupling[i][j]` — integer matrix. With `dirSign('L') = +1`,
  `dirSign('R') = -1`, a press of plate `i` in direction `dir` applies
  `positions[j] += coupling[i][j] * dirSign(dir)` (`model.js:moveDelta/applyMove`).
  `coupling[i][j]`: `+1` moves-with, `-1` moves-opposite, `0` no-connection-or-
  untested (indistinguishable today). Diagonal is `1`.
- The matrix is **directed** — `coupling[i][j]` and `coupling[j][i]` are independent
  (see the upper-triangular lock in `test/integration.test.js`). We do **not**
  assume symmetry.
- `mapping.status[i]` — `'unstarted' | 'partial' | 'done'`.
- `coupling` is consumed arithmetically by `applyMove` and the solver (`solver.js`
  A* over `legalMoves`). Any new connection state must not pollute those numerics.
- Recording flow today (`mappingView`, `src/ui/app.js`): select a plate → press it
  in game → click each *other* plate "Moves with"/"Moves opposite" → **Save plate**
  (`saveActivePlate` writes the coupling row, marks `done`; **does not** touch
  positions). The board is not draggable here. No flow exists for "it jammed."

## Foundation: live positions during mapping

Make `state.positions` track the real slide positions throughout mapping, so every
hint is computed against the current state.

- **Draggable mapping board.** Pass `draggable: true` + `onSetPosition` to
  `createBoard` in `mappingView`, reusing the existing setup-mode drag handler
  (`onDragPosition`) — but clamped to one slot per probe (see drag clamp below), so
  dragging records a move rather than freely repositioning.
- **Positions advance through the recording flow** (see next section) rather than
  staying frozen.
- All position-derived guidance (edge list, `probeSafe`, the planner) now reflects
  reality as the player works.

## Recording a successful probe (synchronized drag + tag)

A single recording flow with **two live-linked input affordances** backed by one
per-plate state — drag the sliders, or click the "Moves with / Moves opposite"
buttons, whichever is faster; the two stay in sync and both keep `state.positions`
live. The active plate's one-slot move encodes the press direction.

Per-plate state for active plate `i`, other plate `j` — three equivalent views:

| tag | delta | slider position |
|---|---|---|
| with | `delta_j = +delta_i` | `baseline_j + delta_i` |
| opposite | `delta_j = -delta_i` | `baseline_j - delta_i` |
| none | `delta_j = 0` | `baseline_j` |

where `delta_i ∈ {+1,-1}` is the active plate's one-slot move (the press direction)
and `baseline` = positions snapshotted at probe start.

Live linkage (both directions):
- **Drag the active plate one slot** → sets/flips `delta_i` (the press direction).
  Defaults to the suggested toward-center direction so tagging works before any drag.
- **Drag another plate one slot** → highlights the matching with/opposite button
  (or clears it at baseline).
- **Click with/opposite** → moves that slider one slot the corresponding way (live
  position); clicking the active tag again toggles to none → baseline.
- **Change the active plate's direction** → re-derives every coupled slider's
  position (with-plates follow it, opposite-plates mirror).

**Drag clamp:** in mapping, every slide is draggable only to `baseline ± 1` — a
single press moves any plate at most one slot. Enforces the physics and prevents
fat-finger errors. (Free correction of a slide that has drifted far would be a
separate edit affordance — out of scope here.)

**Save plate ›:**
- `coupling[i][j] = delta_j * delta_i` (since `delta_i = ±1`); untagged → `0`.
- Commit the shown positions as the new `state.positions`.
- Mark plate `done`.

Validation: `|delta_i| === 1` and `|delta_j| <= 1` (guaranteed by the clamp). A tag
that would push a plate past an edge is rejected — a successful move can't push a
plate off an edge; that situation is a jam (lost durability — clear the edges and
retry).

Re-saving a plate overwrites its row and positions (non-destructive / editable).

## Edge-clearing planner

When the player faces edges to clear (and especially the whack-a-mole case), give a
*sequence* of safe known moves instead of one-step prep hints.

- Generalize the existing A* in `solver.js` to accept a goal predicate and a set of
  allowed plates, then reuse it: **goal = no plate at an edge (all interior 2..6)**,
  **allowed moves = pressing any `done` plate L/R** (known, exact coupling rows),
  expanding only **legal** moves (`isLegal`, so the search never strands a plate it
  can't recover). Output is a short sequence like *"P3 → R, then P1 → L."*
- Because it searches over fully-known plates and only legal moves, the plan
  inherently avoids creating a new edge it can't undo — directly defeating
  whack-a-mole.
- Fallback: if no done-plate sequence reaches all-interior (e.g. too few plates
  mapped, or the edge plate has no known mover), return nothing and fall back to the
  existing recommender tiers (prep move, then least-risky probe). The coaching panel
  explains when a risk is unavoidable.
- Surfaced in `mappingView` as an ordered list with **Done / Skip** buttons (see
  Interaction model). **Done** applies the known move(s) to `state.positions` via
  `applyMove` (no observation needed — the rows are known); **Skip** leaves
  positions unchanged. Either resolves the suggestion so the board state is truthful
  before the next mapping action.

## Interaction model: two interleaved modes

Mapping alternates between two modes. The app re-evaluates after every action, and
the board is **always visible** — positions must be accurate for drag-recording to
work. Both modes are on screen at once; the player chooses.

- **Mode #1 — map the next plate (discovery).** The app suggests an unmapped plate;
  you press it in game and record what it did via the synchronized drag/tag flow.
  The app learns the coupling row and the new positions from your input.
- **Mode #2 — clear edges with known moves (execution).** When plates sit on an edge
  and already-mapped plates can shift them off, the app proposes a short sequence of
  known moves (the edge-clearing planner). These shift the board predictably.

At start, nothing is mapped, so only #1 exists. After ≥1 plate is mapped, #2
opportunities can appear at any time — often several in a row — before returning to
#1.

### Keeping the board in sync (Done / Skip)

Drag-recording (#1) only works if the app's positions match the real lock, so every
proposed #2 move carries two buttons:

- **Done** — you performed the move in game → the app applies it (advances
  `state.positions` via `applyMove`; a multi-step plan applies its whole sequence),
  so the board now matches reality.
- **Skip** — you chose not to → positions are left unchanged.

Either way the model stays truthful, which is the precondition for the next mapping
action. This is the concrete form of the earlier "auto-apply" question: **Done =
apply the known move; Skip = leave it.**

**Default when you begin a #1 mapping while a #2 suggestion is still pending:** treat
it as an implicit **Skip**. Starting to map a plate means you've chosen discovery
over clearing, so the safe assumption is that you did *not* perform the suggested
move — the app must never fabricate a position change. (Skipping into an unsafe probe
is allowed; it may jam — lost durability, so clear the edges and retry — with a
warning.)

Position state therefore changes only through structured, app-understood actions — a
Done'd known move, or a recorded probe (clamped ±1 per plate) — never free-form, so
the model can't silently drift. (Repairing a board that is genuinely out of sync is
the separate, out-of-scope edit affordance.)

## Recommender (`recommendNext`, `src/discovery.js`)

Keep the three tiers (guaranteed-safe probe → prep/plan → least-risky probe), with
candidate ordering updated to serve the edge-first strategy:

- Candidate sort: (1) **at an edge first**, (2) existing `candidateOrder` (unstarted
  before partial).
- `preferredDirs` already tries the toward-center direction first, so a safe probe
  of an edge plate clears it.
- Tier 2 becomes the **edge-clearing planner** above (a multi-step generalization of
  today's single `findPrepMove`).
- Reason strings call out the intent (e.g. *"On the edge — press toward center to
  clear it safely."*).

## Coaching panel (`mappingView`)

Rendered above the per-move suggestion, derived from live state each render (no new
persisted state):

- **Edges:** if any plate is at pin 1/7 —
  *"2 slides on the edge — P2 (pin 7), P5 (pin 1). Move these toward center before
  test-probing others, or a probe may break the pick."* Else *"No slides on the
  edges — safe to probe freely."* The list shrinks live as edges clear.

## Migration & persistence

- **No storage-shape change.** The mapping model gains no new fields; `coupling`,
  `status`, and positions persist exactly as today. Live tracking changes only
  *when* positions update, so existing saved locks load and map normally.

## Testing

- Drag-delta inference: given old/new positions, `coupling[i][j] = delta_j*delta_i`;
  rejects `|delta_i| != 1` and any `|delta_j| > 1`.
- Drag/tag sync: dragging a plate one slot selects the matching with/opposite tag;
  clicking with/opposite moves the slider to `baseline ± delta_i`; flipping the
  active plate's direction re-derives coupled slider positions. Drag clamps to
  `baseline ± 1`.
- Successful save advances `state.positions` to the dragged state.
- Edge-clearing planner: from a state where a done plate can pull edges interior,
  returns a legal sequence ending with no plate at an edge; returns nothing when no
  done-plate sequence exists.
- Done on a proposed move advances `state.positions` by the planned sequence; Skip
  leaves them unchanged; starting a #1 mapping with a suggestion pending behaves as
  an implicit Skip (positions unchanged).
- `recommendNext` ordering: at-edge before interior; recommends toward-center for an
  edge plate.
- Coaching: correct edge list and counts from live state.
- Back-compat: existing saved locks load and map normally (no model-shape change).

## Suggested implementation phasing

1. **Foundation** — live/draggable positions in mapping (clamped ±1).
2. **Recording** — synchronized drag + tag successful-probe flow (both affordances,
   live-linked).
3. **Guidance** — generalized planner; updated `recommendNext` ordering; two-mode UI
   with Done/Skip gating; coaching panel.

## Out of scope

- **Recording unsigned connections from jams (wiggle data)** — deferred to its own
  spec, `2026-06-08-jam-wiggle-unsigned-connections-deferred.md`. A jam needs no app
  action (nothing moved a slot); clear the edges and retry.
- A durability/pick-break counter (the app is a mapping/solving aid, not the game).
- Letting `probeSafe` exploit known non-connections of `done` plates (stays
  conservative — interior-only).
