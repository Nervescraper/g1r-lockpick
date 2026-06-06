# Cycle indicators in the solve plan

## Problem

The solver returns the shortest move sequence, but shortest is not the same as
short. Many solutions contain long stretches of the same back-and-forth shuffle —
e.g. `P1◀ P2▶ P1◀ P2▶ …` — because alternating two coupled plates nets real
progress each round (the moves do not cancel). Stepping through such a run one
click at a time is tedious and easy to lose count of.

When a solution contains a repeating cycle over the same 2–3 plates, show an
indicator with a count of how many times the cycle repeats.

## Detection — `src/cycles.js` (new, pure)

A single exported function:

```
findCycles(plan) -> Segment[]
```

`plan` is the move array (`{ plate, dir }[]`). The return is a left-to-right
**segmentation** that covers the whole plan with no gaps or overlaps. Each
segment is one of:

- `{ type: 'single', index }` — a lone move at `plan[index]`.
- `{ type: 'cycle', start, unit, unitLen, reps, length, plates }` — a contiguous
  run `plan[start .. start+length)` that is exactly `unit` (a block of `unitLen`
  moves) repeated `reps` times. `length === unitLen * reps`. `plates` is the
  sorted list of distinct plate indices appearing in `unit`.

### Flagging rule

A run is a cycle when **both**:

- the repeating unit appears **`reps ≥ 2`** times consecutively, and
- the unit touches **`plates.length ≤ 3`** distinct plates.

The unit length is **not** capped — a longer unit over ≤3 plates still counts
(e.g. `P1◀ P1◀ P2▶` repeated). Single-plate runs count too (`P1◀ ×2` is flagged).

### Algorithm — greedy left-to-right

Encode each move as a token (e.g. `` `${plate}${dir}` ``). Scan from `i = 0`:

1. For each candidate unit length `L` from `1` to `floor((plan.length - i) / 2)`:
   - `unit = plan[i .. i+L)`.
   - Count consecutive repetitions `k` of `unit` starting at `i`.
   - If `k ≥ 2` and the distinct plates in `unit` number `≤ 3`, it is a candidate
     with coverage `k * L`.
2. Choose the candidate with the **greatest coverage**; tie-break on the
   **smallest `L`** (so `ABABAB` reads as `AB ×3`, not `ABAB ×1`).
3. If a candidate exists, emit a `cycle` segment and advance `i` by its `length`.
   Otherwise emit `{ type: 'single', index: i }` and advance `i` by 1.

The function is pure — no DOM, no app state — so it is unit-tested directly.

*Alternative considered:* inline the logic inside `planCardEl`. Rejected — it
would be untestable and would tangle view with logic, breaking the existing
model / solver / ui separation.

## Display & stepping — `planCardEl` in `src/ui/app.js`

`planCardEl` calls `findCycles(state.plan)` and renders per segment. A single
**"Collapse repeats"** toggle in the Plan card header switches between two view
modes. The toggle is persisted in `settings` (via `saveSettings` / `loadSettings`),
default **off** (annotated / expanded).

### Stepping is unchanged

`planIndex`, `computeSolvePositions`, the "Next move" card, the keyboard handler,
and `reserveMoveDescHeight` all keep operating on the **flat move array, one move
at a time**. Advancing always moves exactly one move — never a whole cycle.
Cycles are a **view-only** overlay; collapse never alters solve logic.

### Expanded mode (default)

Every step is still listed individually and remains clickable/steppable exactly
as today. A cycle run additionally gets a **left bracket spanning its rows and a
`×k` badge**:

```
Plan · click a step to jump there            [ ] Collapse repeats
  3 · P5 ▶ Right ✓
 ┌ 4 · P1 ◀ Left ✓
 │ 5 · P2 ▶ Right  cur     ×3
 │ 6 · P1 ◀ Left
 └ 7 · P2 ▶ Right
  8 · P3 ◀ Left
```

### Collapsed mode

Each cycle run becomes **one summary row** showing the unit and the repeat count.
The run containing `planIndex` is highlighted and shows live progress at full
granularity — **`rep r/reps · move m/unitLen`** — so the row visibly updates on
every single advance. Clicking a summary row jumps `planIndex` to the run's
start. Singletons render normally.

```
Plan · click a step to jump there            [✓] Collapse repeats
  3 · P5 ▶ Right ✓
  ↻ Repeat P1◀ · P2▶  ×3
     rep 2/3 · move 1/2
  8 · P3 ◀ Left
```

## Tests — `test/cycles.test.js` (new)

Pure tests against `findCycles`:

- back-and-forth → one cycle, `unitLen 2`, `reps 3`, 2 plates;
- triangle → one cycle, `unitLen 3`, `reps 2`, 3 plates;
- longer unit / 2 plates (`P1◀ P1◀ P2▶` ×2) → flagged;
- single-plate run (`P1◀ ×2`) → flagged, 1 plate;
- 4-plate unit repeated → **not** flagged (all singles);
- two adjacent but distinct cycle runs → two cycle segments;
- a cycle butted against singletons on both sides → single, cycle, single;
- a plain no-repeat plan → all singletons;
- coverage tie-break: `ABABAB` resolves to `unitLen 2, reps 3` (not `unitLen 4`).
