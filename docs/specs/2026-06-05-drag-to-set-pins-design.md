# Drag-to-set initial pins (Setup tab)

**Date:** 2026-06-05
**Status:** Approved

## Goal

In the **Setup** stage, let the user set each plate's initial pin position by grabbing
its slide on the board and dragging it left/right, snapping hole-by-hole. Add keyboard
entry (press 1–7) with a moving active-plate cursor. Remove the old numeric 1–7 scale
clicker. The board stays non-draggable in every other view (Lock has no board, Discovery
uses plate selection for mapping, Solve shows the plan highlight).

## Background

The board is a 13-column CSS grid (`.tp-field`, `grid-template-columns: repeat(13, var(--hole))`).
Each plate is a 7-hole slide spanning `startCol / span 7`, with the pin fixed at the
keyway (column 7). Geometry: `slideCols(p) = { startCol: 8 - p, pinCol: 7 }` — position 1
is hard right, 7 is hard left, 4 is home. Increasing position = slide moves left, which
matches the model's direction sense (`model.js`: an `L` move adds +1; `app.js`:
`delta > 0 → "left"`).

Today the Setup board is rendered read-only (`boardProps = { positions }`) and positions
are edited through a numeric clicker in the side panel (`positionScale` / `positionRows`
/ the `pos-set` click action). That clicker is being replaced by drag + keyboard.

## Requirements

1. Dragging a slide in Setup changes that plate's initial position, snapping to each
   integer column live as the pointer crosses it (always lands on a valid 1–7 position).
2. Drag is direct-manipulation: dragging the slide right moves it right (position number
   decreases); dragging left moves it left (position increases). Clamped to 1–7.
3. Drag is enabled **only while editing positions** — the Setup stage and the Solve
   stage's "Edit positions" mode. Discovery and the normal Solve (plan-stepping) board stay
   non-draggable.
4. The numeric 1–7 scale clicker is removed from the Setup side panel.
5. Keyboard (gated by the existing `kbdEnabled()` toggle, on by default), Setup stage only:
   - `1`–`7`: set the active plate's position, then advance the cursor P1 → P2 → … → Pₙ.
     At Pₙ it **stops** (no wrap).
   - `↑` / `↓`: move the active-plate cursor without setting a value (`↑` = higher plate
     number, matching the top-to-bottom Pₙ…P1 row order).
6. The active plate is visibly highlighted on the board. Clicking or dragging a slide
   makes it the active plate. Entering Setup resets the active plate to P1.

## Design

### Board (`src/ui/board.js`)

Add two optional props to `createBoard(host, s)`:

- `s.draggable` (boolean) — when true, attach drag handlers to each slide.
- `s.onSetPosition(plateIndex, newPos)` — called when a drag snaps to a new integer
  position. The app updates `state.positions[plateIndex]` and re-renders.

Per-slide `pointerdown` handler (attached to the slide's tray and holes, which carry the
plate index):

1. Record `startX = e.clientX`, `startPos = s.positions[i]`, and
   `colW = field.getBoundingClientRect().width / FIELD_COLS`. Call `s.onSetPosition(i,
   startPos)` to mark the plate active (a no-move click selects it). `e.preventDefault()`
   to suppress text selection.
2. Register `pointermove` / `pointerup` on **`window`**, not the slide. This is the key
   decision (see Alternatives): the app re-renders on every snap, destroying the slide's
   DOM node, so pointer capture on the slide would be lost mid-drag. Window listeners
   close over `startX` / `startPos` and survive re-renders.
3. On move: `newPos = clamp(startPos - Math.round((clientX - startX) / colW), 1, 7)`.
   Track the last snapped value locally; only when it changes, call `s.onSetPosition(i,
   newPos)`.
4. On up: remove the two window listeners.

Extract the pure snap math as an exported helper for unit testing:

```js
export function dragToPosition(startPos, dxCols) {
  return Math.max(1, Math.min(7, startPos - dxCols));
}
```

CSS: `.tp-keybox { pointer-events: none }` so the dashed column-7 overlay doesn't swallow
drags; `cursor: grab` on draggable slides and `grabbing` while dragging.

### Setup panel (`src/ui/app.js`)

- Delete `positionScale`, `positionRows`, and the `pos-set` case in the click handler.
- `setupPanel()` keeps the plate-count stepper and the primary button, and gains a short
  instruction line: "Drag each slide, or press 1–7 (P1 → Pₙ)."
- In the Setup render branch, render the board with
  `{ positions, draggable: true, onSetPosition, highlightPlate: state.activePlate }`.
  `onSetPosition(i, pos)` sets `state.positions[i] = pos`, `state.activePlate = i`, and
  re-renders.
- Set `state.activePlate = 0` whenever Setup is entered (`new-setup`, `goto-stage`→setup,
  and fresh setup). `activePlate` is already reused per-stage (cleared on entering
  Discovery), so no new state field is needed.

### Keyboard (`src/ui/app.js` keydown)

Add a Setup block before the existing solve-only early return. Pure cursor logic extracted
for testing:

```js
// advance after setting a digit; stops at the last plate
export function nextActivePlate(active, n) { return Math.min(active + 1, n - 1); }
```

- `1`–`7` → `state.positions[active] = digit; state.activePlate = nextActivePlate(active, n)`.
- `↑` → `state.activePlate = Math.min(active + 1, n - 1)` (higher plate number).
- `↓` → `state.activePlate = Math.max(active - 1, 0)`.
- Each handled key calls `e.preventDefault()` then `render()`.

## Alternatives considered

- **Drag mechanism — window listeners + normal re-render (chosen)** vs. having `board.js`
  mutate its own DOM during the drag and skip the app re-render. The chosen approach
  reuses the single existing render path (one source of truth) at the cost of a cheap full
  re-render per snap (3–8 rows — negligible). The alternative avoids re-renders but
  duplicates slide layout logic inside the drag handler.
- **Snapping — live per-column (chosen)** vs. free pixel drag then snap on release. Live
  snapping keeps state always valid and needs no transient sub-column offset; matches the
  grid-locked feel of the board.
- **Numeric clicker — removed (chosen)** vs. kept alongside drag. Removed per the decision
  that drag + keyboard fully covers setting positions; keyboard restores precise/one-press
  entry.

## Testing

- Unit: `dragToPosition` (clamp + direction at boundaries and home) and `nextActivePlate`
  (advance, stop at last) in `test/board.test.js`, in the existing node:test style — no
  browser needed.
- Manual: in Setup, drag each slide and confirm it snaps per column, the amber/green pin
  stays in column 7, and the active highlight tracks the dragged plate; confirm 1–7 sets
  and advances (stopping at Pₙ), ↑/↓ move the cursor; confirm Discovery and Solve boards
  remain non-draggable.

## Out of scope

- Drag/keyboard position editing in Discovery, or in the normal (plan-stepping) Solve board.
  (Solve's "Edit positions" mode *is* in scope — it shares the Setup drag + keyboard UI,
  since the rule is "draggable only while editing positions".)
- Touch-specific gestures beyond what Pointer Events already unify (mouse + touch).
- Reordering plates or changing plate count by drag.
