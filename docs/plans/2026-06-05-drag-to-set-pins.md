# Drag-to-set initial pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set each plate's initial pin in the Setup tab by dragging its slide (live per-column snap) or by keyboard (1–7 with a moving active-plate cursor), replacing the numeric clicker — with no interactivity change to Discovery/Solve.

**Architecture:** `board.js` gains `draggable` + `onSetPosition` props; each slide gets a `pointerdown` handler that listens for move/up on `window` (so the drag survives the app's full re-render on each snap). `app.js` removes the numeric clicker, renders the Setup board as draggable, and adds a Setup-only keydown block. Two pure helpers (`dragToPosition`, `nextActivePlate`) hold the snap/advance math and are unit-tested with `node:test`.

**Tech Stack:** Vanilla ES modules, CSS grid, Pointer Events, `node:test` + `node:assert`. Test command: `npm test` (`node --test`). Spec: `docs/specs/2026-06-05-drag-to-set-pins-design.md`.

---

## File Structure

- `src/ui/board.js` — add exported pure helper `dragToPosition(startPos, dxCols)`; add `draggable`/`onSetPosition` props and the per-slide pointer drag handler.
- `src/ui/app.js` — add exported pure helper `nextActivePlate(active, n)`; remove `positionScale`/`positionRows` and the `pos-set` action; render Setup board draggable with `onSetPosition`; set `activePlate` on Setup entry; add Setup keydown block.
- `css/styles.css` — `cursor: grab/grabbing` on draggable slides; `.tp-keybox { pointer-events: none }`.
- `test/board.test.js` — unit tests for `dragToPosition`.
- `test/app.test.js` — **Create**: unit tests for `nextActivePlate`.

---

## Task 1: Pure snap helper `dragToPosition`

**Files:**
- Modify: `src/ui/board.js`
- Test: `test/board.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/board.test.js`:

```js
import { dragToPosition } from '../src/ui/board.js';

test('dragToPosition: no drag keeps the start position', () => {
  assert.equal(dragToPosition(4, 0), 4);
});

test('dragToPosition: dragging right (positive cols) lowers the position', () => {
  assert.equal(dragToPosition(4, 1), 3);
  assert.equal(dragToPosition(4, 3), 1);
});

test('dragToPosition: dragging left (negative cols) raises the position', () => {
  assert.equal(dragToPosition(4, -1), 5);
  assert.equal(dragToPosition(4, -3), 7);
});

test('dragToPosition: clamps to the 1..7 range', () => {
  assert.equal(dragToPosition(1, 5), 1);
  assert.equal(dragToPosition(7, -5), 7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `dragToPosition` is not exported (`SyntaxError` / `undefined is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `src/ui/board.js`, directly below the `slideCols` function, add:

```js
// Snap a drag to a 1..7 position. Dragging right (positive column delta) moves the slide
// right, which lowers the position number (startCol = 8 - p), so we subtract the delta.
export function dragToPosition(startPos, dxCols) {
  return Math.max(1, Math.min(7, startPos - dxCols));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all board tests green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/board.js test/board.test.js
git commit -m "feat(ui): dragToPosition snap helper for slide dragging"
```

---

## Task 2: Drag handler in the board renderer

**Files:**
- Modify: `src/ui/board.js` (the `createBoard` row loop, around lines 32–52)

- [ ] **Step 1: Add the drag wiring**

In `src/ui/board.js`, inside `createBoard`'s row loop, after the holes are appended and
before the `if (s.selectable)` block (currently line 53), insert:

```js
    if (s.draggable) {
      const slideEls = [tray, ...field.querySelectorAll('.tp-hole2')];
      for (const el of slideEls) {
        el.style.cursor = 'grab';
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startPos = s.positions[i];
          const colW = field.getBoundingClientRect().width / FIELD_COLS;
          let lastPos = startPos;
          document.body.classList.add('tp-dragging');
          s.onSetPosition?.(i, startPos); // selecting the plate (no-move click)
          const onMove = (ev) => {
            const dxCols = Math.round((ev.clientX - startX) / colW);
            const next = dragToPosition(startPos, dxCols);
            if (next !== lastPos) { lastPos = next; s.onSetPosition?.(i, next); }
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.classList.remove('tp-dragging');
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }
    }
```

Note: `querySelectorAll` here finds only this row's holes because they were just appended
to this row's `field`. The handler listens on `window` (not the slide) so the drag keeps
working across the full re-render that `onSetPosition` triggers.

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: PASS — no behavioural change for non-draggable boards (handler only attaches when
`s.draggable`).

- [ ] **Step 3: Commit**

```bash
git add src/ui/board.js
git commit -m "feat(ui): draggable slides in the board renderer"
```

---

## Task 3: Pure cursor helper `nextActivePlate`

**Files:**
- Modify: `src/ui/app.js`
- Test: `test/app.test.js` (**create**)

- [ ] **Step 1: Write the failing test**

Create `test/app.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextActivePlate } from '../src/ui/app.js';

test('nextActivePlate: advances to the next plate', () => {
  assert.equal(nextActivePlate(0, 5), 1);
  assert.equal(nextActivePlate(3, 5), 4);
});

test('nextActivePlate: stops at the last plate (no wrap)', () => {
  assert.equal(nextActivePlate(4, 5), 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `nextActivePlate` is not exported.

Note: `app.js` runs browser code at import time (`render()` at the file end, DOM lookups).
If importing it under `node:test` throws before the assertions run, change the import to a
static re-export: create `src/ui/active-plate.js` with the helper, export it from there,
and have `app.js` import+re-export it. Decide at Step 3 based on whether `npm test` errors
on import; the test above imports from `../src/ui/app.js` and should be repointed to
`../src/ui/active-plate.js` if the split is needed.

- [ ] **Step 3: Write minimal implementation**

Preferred (no split) — add near the top of `src/ui/app.js`, after the constants block
(around line 10, by `N_MIN`/`N_MAX`):

```js
// Advance the Setup active-plate cursor P1->Pn, stopping at the last plate (no wrap).
export function nextActivePlate(active, n) {
  return Math.min(active + 1, n - 1);
}
```

If Step 2 showed `app.js` cannot be imported headless, instead create
`src/ui/active-plate.js`:

```js
// Advance the Setup active-plate cursor P1->Pn, stopping at the last plate (no wrap).
export function nextActivePlate(active, n) {
  return Math.min(active + 1, n - 1);
}
```

then in `src/ui/app.js` add `import { nextActivePlate } from './active-plate.js';`, and
update `test/app.test.js` to import from `../src/ui/active-plate.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.js test/app.test.js
git commit -m "feat(ui): nextActivePlate cursor helper"
```

---

## Task 4: Remove the numeric clicker, render Setup board draggable

**Files:**
- Modify: `src/ui/app.js` — `positionScale`/`positionRows` (lines 345–359), `setupPanel` (425–445), Setup render branch (191–198), `pos-set` action (718).

- [ ] **Step 1: Delete the numeric clicker functions**

Remove `positionScale` (lines 345–352) and `positionRows` (lines 354–359) entirely.

- [ ] **Step 2: Remove the `pos-set` click action**

In the click handler `switch`, delete the line:

```js
    case 'pos-set': state.positions[+t.dataset.plate] = +t.dataset.val; break;
```

- [ ] **Step 3: Update `setupPanel` to drop the position rows and add an instruction**

In `setupPanel`, replace the `card.innerHTML` block so the `${positionRows()}` line becomes
a short instruction. The new `card.innerHTML`:

```js
  card.innerHTML = `
    <div class="ap-h">Plates &amp; initial pins</div>
    <div class="cnt">
      <span class="muted">Plates</span>
      <button class="step" data-action="n-dec">−</button>
      <span class="num">${state.n}</span>
      <button class="step" data-action="n-inc">+</button>
      <span class="muted">(${N_MIN}–${N_MAX})</span>
    </div>
    <div class="ap-h">Current pin position of each plate <span class="muted" style="text-transform:none;letter-spacing:0">— saved as the lock's reset point</span></div>
    <div class="muted" style="margin:4px 0 2px">Drag each slide left/right, or press <b>1</b>–<b>7</b> to set the active plate (advances P1 → P${state.n}).</div>
    <div style="margin-top:12px">${primary}</div>
  `;
```

- [ ] **Step 4: Render the Setup board as draggable**

In the main render branch (currently lines 191–198), change the Setup case so the board
gets drag props. Replace:

```js
    let boardProps = { positions: state.positions };
    if (state.stage === 'setup') side.appendChild(setupPanel());
    else if (state.stage === 'solve') boardProps = solvePanel(side, boardProps);
```

with:

```js
    let boardProps = { positions: state.positions };
    if (state.stage === 'setup') {
      side.appendChild(setupPanel());
      boardProps = {
        positions: state.positions,
        draggable: true,
        highlightPlate: state.activePlate,
        onSetPosition: (i, pos) => { state.positions[i] = pos; state.activePlate = i; render(); },
      };
    } else if (state.stage === 'solve') boardProps = solvePanel(side, boardProps);
```

- [ ] **Step 5: Default the active plate when entering Setup**

Set `state.activePlate = 0` at each Setup entry point.

In the `new-setup` case (currently lines 728–733), after `state.stage = 'setup';` add
`state.activePlate = 0;`:

```js
    case 'new-setup': {
      const dup = findDuplicate();
      if (dup) { state.nameConflict = dup.name; break; } // stay on Lock step; warning shows
      state.stage = 'setup';
      state.activePlate = 0;
      break;
    }
```

In the `goto-stage` case (line 737), change the setup branch to seed the cursor:

```js
      else if (target === 'setup') { state.stage = 'setup'; state.editing = false; state.activePlate = 0; }
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (no test references `positionScale`/`positionRows`/`pos-set`).

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): drag-only Setup board, drop the numeric pin clicker"
```

---

## Task 5: Setup keyboard entry (1–7, ↑/↓)

**Files:**
- Modify: `src/ui/app.js` — keydown handler (lines 861–888).

- [ ] **Step 1: Add the Setup keydown block**

In the `window.addEventListener('keydown', ...)` handler, after the `R`-reset block
(after line 875, before the comment `// Step through the plan while solving.`), insert:

```js
  // Setup — digits 1..7 set the active plate's pin and advance the cursor; arrows move it.
  if (state.stage === 'setup') {
    if (e.key >= '1' && e.key <= '7') {
      const i = state.activePlate ?? 0;
      state.positions[i] = +e.key;
      state.activePlate = nextActivePlate(i, state.n);
      e.preventDefault();
      render();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const i = state.activePlate ?? 0;
      state.activePlate = e.key === 'ArrowUp' ? Math.min(i + 1, state.n - 1) : Math.max(i - 1, 0);
      e.preventDefault();
      render();
      return;
    }
    return; // no other setup keys
  }
```

(`↑` moves to a higher plate number, matching the top-to-bottom Pₙ…P1 row order.)

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): keyboard pin entry in Setup (1-7, arrows)"
```

---

## Task 6: CSS — drag cursor and keybox pass-through

**Files:**
- Modify: `css/styles.css` — near `.tp-tray` / `.tp-hole2` (lines 122–135) and `.tp-keybox` (line 137).

- [ ] **Step 1: Add the rules**

In `css/styles.css`, add after the `.tp-keybox { ... }` rule:

```css
/* the dashed keyway overlay must not intercept drags on the slide beneath it */
.tp-keybox { pointer-events: none; }
/* dragging cursor feedback in Setup */
body.tp-dragging, body.tp-dragging .tp-hole2, body.tp-dragging .tp-tray { cursor: grabbing !important; }
```

(If `.tp-keybox` already sets other properties inline in its block, add
`pointer-events: none;` inside that existing block instead of duplicating the selector.)

- [ ] **Step 2: Commit**

```bash
git add css/styles.css
git commit -m "style(ui): grab cursor for draggable slides, keybox pass-through"
```

---

## Task 7: Manual browser verification

**Files:** none (verification only).

- [ ] **Step 1: Serve and open the app**

Run: `python3 scripts/serve.py` (or the project's serve command), open the printed URL,
and go to the **Setup** tab.

- [ ] **Step 2: Verify drag**

Drag a slide left and right. Confirm: it snaps one hole per column; the amber/green pin
stays fixed in column 7; the dragged plate shows the active highlight; position 1 sits hard
right and 7 hard left.

- [ ] **Step 3: Verify keyboard**

With the Keyboard-shortcuts toggle on, press `1`–`7`: the active plate's pin sets and the
cursor advances P1 → Pₙ, stopping at Pₙ. Press `↑`/`↓`: the active highlight moves between
plates without changing values.

- [ ] **Step 4: Verify isolation**

Go to **Discovery** (Map the lock) and **Solve**. Confirm slides are NOT draggable there
(clicking a plate still selects it in Discovery; the Solve board is unchanged).

- [ ] **Step 5: Final test run**

Run: `npm test`
Expected: PASS — all suites green.

---

## Self-Review Notes

- **Spec coverage:** drag-snap (Tasks 1–2, 4), drag Setup-only (Task 4 props + Task 7 isolation check), remove clicker (Task 4), keyboard 1–7 + advance/stop (Tasks 3, 5), ↑/↓ cursor (Task 5), active highlight + entry reset (Task 4), CSS grab + keybox (Task 6). All covered.
- **Type consistency:** `dragToPosition(startPos, dxCols)` and `nextActivePlate(active, n)` and the `onSetPosition(i, pos)` signature are used identically across tasks.
- **Direction:** drag right → lower position (subtract delta), matching `slideCols` `startCol = 8 - p`; `↑` → higher plate number, matching `Pₙ…P1` row order.
