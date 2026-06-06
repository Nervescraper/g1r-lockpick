# Offset-Slide Board — Design

**Date:** 2026-06-05
**Status:** Approved design, ready for implementation planning
**Affects:** `src/ui/board.js`, `css/styles.css` (and a small geometry helper + its test)

## 1. Purpose

Make the 2D board look and behave like the lock does in-game. Today every plate's
7-hole strip is drawn at the same horizontal alignment with the pin dot moving *inside* a
fixed tray. In the game the **slides themselves move**: each plate is a strip that shifts
left/right, and they are staggered relative to one another around a fixed central keyway.
This redraws the board to match that mental model, which makes the coupling and the
play-along plan easier to read against what the player sees on screen.

This is a **rendering change only**. The model, solver, discovery, storage, persistence,
and the position data (`positions[i]` ∈ 1..7, goal 4) are unchanged.

## 2. The visual model

- The board is a **13-column field**, columns `1..13` (1-based, matching CSS
  `grid-column`). Column **7** is the **keyway** (the goal).
- Each plate is a **7-hole slide** that moves as a unit. Its horizontal offset encodes the
  plate's position; the **pin is the middle hole** of the slide.
- A plate at position `p` is drawn so its pin sits at column `p + 3`:
  - `pinCol(p)  = p + 3`        → p=1→4, p=4→7 (keyway), p=7→10
  - `startCol(p) = p`           → the slide occupies columns `startCol .. startCol+6`
  - p=1 → cols 1..7, p=4 → cols 4..10, p=7 → cols 7..13. The union is the full 1..13 field.
- Because every slide always covers column 7, the keyway always frames one hole of each
  slide. That hole is the **pin** only when the plate is at position 4 (solved); the pin
  goes **green** there, amber otherwise.
- **No vertical line and no faint backdrop field.** The keyway is a **single dashed
  rectangle** wrapping the column of center pegs across all rows (the same dashed-gold
  style the current per-row goal box uses, unified into one tall box).
- Slides float at their offsets with nothing behind them; the stagger itself shows how far
  each pin is from home.

### Why this is anchored to a fixed keyway (not the active plate)

An earlier option re-centered the whole board on the *selected* plate's pin. We chose the
**fixed keyway** instead: the goal stays one stable column for every plate, distance-to-goal
is readable at a glance, and the board does not jump when you select a different plate.
A useful consequence — the geometry **does not depend on which plate is active**, so the
same renderer works unchanged in every stage.

## 3. Scope: all three board stages

The offset board replaces the aligned board **everywhere `createBoard` is used**:

- **Setup** — the live position preview; slides visibly shift as the player sets each
  plate's initial position.
- **Map** — the clickable mapping surface. Rows stay selectable; the selected plate's slide
  gets the gold "selected" tray treatment; the per-row **Moves with / Moves opposite**
  controls (`rowsRight`) remain to the right of the field.
- **Solve** — the play-along board. The **next move's** plate gets a gold "next" tray
  outline so it ties to the callout.

## 4. Components and changes

### 4.1 Geometry helper (pure, testable)

Add a tiny pure function so the column math is unit-tested without the DOM. Co-locate it
with the renderer (exported from `board.js`) or in `model.js` if that reads cleaner:

```
KEYWAY_COL = 7            // center of the 13-wide field (1-based, matches grid-column)
FIELD_COLS = 13
slideCols(p) -> { pinCol: p + 3, startCol: p }       // p in 1..7
```

A unit test asserts the three boundary cases (p=1,4,7) and that every slide covers
`KEYWAY_COL`.

### 4.2 `board.js` renderer

Replace the flex strip of 7 holes with a **fixed-metric field**:

- Each row is `[label] [field] [rowsRight?]`. The **field** is `position: relative` with a
  fixed width of 13 columns so every row aligns and the keyway box can be placed at a known
  x. Column step comes from CSS custom properties (hole size + gap) shared with the CSS.
- For plate `i`: compute `slideCols(positions[i])`, draw the **tray** spanning the 7 holes,
  then the 7 **holes** positioned by column; the middle hole is the **pin** (`.pin`, plus
  `.ok` when `positions[i] === 4`).
- **Tray highlight:** a single prop drives the gold tray. Reuse the existing
  `highlightPlate` for the Map selection; on Solve, app.js passes the next move's plate
  index (a thin addition — see 4.4). The placeholder/active semantics in Map are unchanged.
- **Keyway box:** after the rows are built, the renderer adds one absolutely-positioned
  dashed rectangle over the board, centered on `KEYWAY_COL`, spanning from the first to the
  last row. The board root becomes the positioning context.
- Labels (`P{i+1} · pos`, green when mapped/done) and the `selectable` / `rowsRight` /
  `labels` props keep their current meaning.

### 4.3 `css/styles.css`

- Introduce CSS custom properties for hole size and gap (e.g. `--hole`, `--colgap`) so the
  JS column step and the CSS agree on one source of truth.
- New/updated classes: the field, the sliding tray (default + `selected` + `next` states),
  the holes/pin/ok (reuse existing `.pin` / `.pin.ok` colors), and the unified keyway
  dashed box. Remove the per-hole `.goal` dashed-box rule (the single keyway box replaces
  it).
- Keep the board comfortably narrow enough for phone width: holes ≈16–18px. 13 columns must
  fit the board column without horizontal scroll on a phone; size the holes/gaps to keep the
  field within the existing `.tp-2d` max width, shrinking slightly versus today's 7-wide if
  needed.

### 4.4 `app.js` (minimal)

- On **Solve**, pass the next move's plate index to `createBoard` so its tray gets the
  `next` highlight. This is the only behavioral addition; everything else is prop-compatible
  with today's calls.

## 5. Out of scope (unchanged)

- The puzzle model, solver, discovery/mapping logic, storage, persistence, keyboard
  shortcuts, stage rail, and panels.
- Position semantics (1..7, goal 4) and the move/plan wording (shift left/right, ◀/▶).
- No active-plate re-centering, no 3D/isometric view, no animation requirement (a CSS
  transition on slide offset is a possible nicety but not required).

## 6. Verification

- **Unit:** `slideCols` boundary + keyway-coverage test under `node --test`.
- **Visual:** run `python3 scripts/serve.py` and confirm, across Setup / Map / Solve:
  slides stagger by position, the dashed keyway box frames the center pegs, pins turn green
  at home, the selected (Map) and next-move (Solve) trays highlight, and the field fits a
  phone-width viewport.
