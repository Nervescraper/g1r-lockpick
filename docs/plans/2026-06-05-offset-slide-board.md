# Offset-Slide Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the 2D board so each plate is a 7-hole slide that shifts left/right as a unit on a 13-column field, with a fixed dashed keyway box over the center column — matching how the lock looks in-game.

**Architecture:** Pure column geometry (`slideCols`) lives in `board.js` and is unit-tested without the DOM. The renderer places each slide's tray + 7 holes by `grid-column` on a 13-track CSS grid; a single absolutely-positioned dashed box marks the keyway across all rows. Fixed-keyway means geometry is independent of which plate is active, so the same renderer serves Setup, Map, and Solve. Tray highlight distinguishes the selected plate (Map) from the next-move plate (Solve).

**Tech Stack:** Vanilla ES-module JS, CSS grid, `node --test`. No build, no dependencies.

**Spec:** `docs/specs/2026-06-05-offset-slide-board-design.md`

---

### Task 1: Slide-column geometry helper (pure, TDD)

**Files:**
- Modify: `src/ui/board.js` (add exports `KEYWAY_COL`, `FIELD_COLS`, `slideCols`)
- Test: `test/board.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/board.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { slideCols, KEYWAY_COL, FIELD_COLS } from '../src/ui/board.js';

test('slideCols: position 4 puts the pin in the keyway', () => {
  assert.equal(slideCols(4).pinCol, KEYWAY_COL);
});

test('slideCols: a slide is 7 holes wide and the pin is the middle hole', () => {
  for (let p = 1; p <= 7; p++) {
    const { startCol, pinCol } = slideCols(p);
    assert.equal(pinCol, startCol + 3, `pin is middle hole for p=${p}`);
    assert.ok(startCol >= 1 && startCol + 6 <= FIELD_COLS, `slide stays in field for p=${p}`);
  }
});

test('slideCols: every slide covers the keyway column', () => {
  for (let p = 1; p <= 7; p++) {
    const { startCol } = slideCols(p);
    assert.ok(startCol <= KEYWAY_COL && KEYWAY_COL <= startCol + 6, `covers keyway for p=${p}`);
  }
});

test('slideCols: boundary positions span the full 13-col field', () => {
  assert.deepEqual(slideCols(1), { startCol: 1, pinCol: 4 });
  assert.deepEqual(slideCols(7), { startCol: 7, pinCol: 10 });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test test/board.test.js`
Expected: FAIL — `slideCols` / `KEYWAY_COL` / `FIELD_COLS` are not exported yet (import resolves to `undefined`, `slideCols is not a function`).

- [ ] **Step 3: Add the helper to `board.js`**

At the top of `src/ui/board.js`, above `export function createBoard`, add:

```js
export const FIELD_COLS = 13;
export const KEYWAY_COL = 7; // 1-based centre column of the field (the goal)

// Column geometry for a plate at position p (1..7) on the 13-wide field. The slide is 7
// holes wide and its pin is the middle hole, so pinCol(4) === KEYWAY_COL (position 4 = home).
export function slideCols(p) {
  return { startCol: p, pinCol: p + 3 };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test test/board.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/board.js test/board.test.js
git commit -m "feat(ui): slideCols geometry helper for the 13-wide board"
```

---

### Task 2: Board CSS — offset slides on a grid + keyway box

**Files:**
- Modify: `css/styles.css`

Replace the obsolete flat-board rules with grid-based ones. Remove every existing rule for
`.tp-2dholes`, `.tp-2dhole`, and `.tp-2drow.active2d ...` (they appear both in the
`board: 2D` section near the `.tp-hole` block and again lower down near the `.tp-2d`
max-width block), plus the old `.tp-2d` / `.tp-2drow` / `.tp-2dlabel` definitions, and
replace them with the single consolidated block below. The 3D-view rules (`.tp-plate`,
`.tp-hole`, `.tp-flatlabel`) are unrelated — leave them untouched.

- [ ] **Step 1: Add the consolidated 2D-board block**

Put this where the old `board: 2D` section was:

```css
/* ---- board: 2D — offset slides on a 13-col field ---- */
.tp-2d {
  --hole: 15px; --colgap: 4px; --label-w: 56px; --row-gap: 10px;
  position: relative; max-width: 640px; margin: 0 auto;
}
.tp-2drow { display: flex; align-items: center; gap: var(--row-gap); margin: 6px 0; justify-content: flex-start; }
.tp-2drow.selectable { cursor: pointer; }
.tp-2dlabel { width: var(--label-w); text-align: right; font-size: 12px; color: #cfcfcf; }
.tp-2dlabel b { color: var(--gold); }
.tp-2dlabel b.done { color: var(--goal); }

/* the 13-column field a slide rides in */
.tp-field {
  position: relative; display: grid; column-gap: var(--colgap);
  grid-template-columns: repeat(13, var(--hole)); align-items: center;
  height: calc(var(--hole) + 12px);
}
/* the sliding plate body behind its 7 holes (placed via grid-column in JS) */
.tp-tray {
  grid-row: 1; align-self: stretch; margin: 1px -5px; border-radius: 5px;
  background: linear-gradient(180deg, #46494e, #2a2c30); border: 1px solid #000;
  box-shadow: inset 0 1px 0 #62666c;
}
.tp-tray.sel  { background: linear-gradient(180deg, #5a4f2e, #352d18); box-shadow: inset 0 1px 0 #8a7a45, 0 0 0 2px var(--gold); }
.tp-tray.next { box-shadow: inset 0 1px 0 #62666c, 0 0 0 2px var(--gold); }
/* holes carried by the slide (placed via grid-column in JS) */
.tp-hole2 {
  grid-row: 1; z-index: 2; width: var(--hole); height: var(--hole); border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #1f2125, #08090b); box-shadow: inset 0 2px 3px #000;
}
.tp-hole2.pin { background: radial-gradient(circle at 40% 35%, #f4d878, #b8862f); box-shadow: 0 0 7px 2px rgba(232,194,90,.6); }
.tp-hole2.pin.ok { background: radial-gradient(circle at 40% 35%, #9ee6a6, #3e8a4a); }
/* single dashed keyway box over column 7, spanning all rows */
.tp-keybox {
  position: absolute; top: 2px; bottom: 2px; z-index: 4; pointer-events: none;
  left: calc(var(--label-w) + var(--row-gap) + 6 * (var(--hole) + var(--colgap)) - 4px);
  width: calc(var(--hole) + 8px); border: 1.5px dashed var(--gold); border-radius: 6px;
}
.tp-2dright { margin-left: auto; flex: 0 0 auto; }
```

(The keyway `left` math: field starts at `label-w + row-gap`; column 7's centre is
`6 * (hole + colgap) + hole/2` into the grid; the box is `hole + 8` wide, so its left is
`hole/2 + 4` short of centre — the `hole/2` cancels, leaving `… + 6 * (hole + colgap) - 4`.)

- [ ] **Step 2: Sanity-check the cascade**

Run: `grep -n "tp-2dholes\|tp-2dhole\b\|active2d" css/styles.css`
Expected: no matches (all obsolete rules removed). `grep -n "tp-hole2\|tp-tray\|tp-keybox\|tp-field" css/styles.css` should show the new rules.

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "feat(ui): grid-based offset-slide board styles + keyway box"
```

---

### Task 3: Rewrite the board renderer

**Files:**
- Modify: `src/ui/board.js` (replace the body of `createBoard`)

- [ ] **Step 1: Replace `createBoard`**

Keep the Task 1 exports at the top. Replace the existing `createBoard` function with:

```js
export function createBoard(host, s) {
  host.classList.add('tp');
  host.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'tp-2d';

  const n = s.positions.length;
  for (let i = n - 1; i >= 0; i--) {
    const row = document.createElement('div');
    row.className = 'tp-2drow';
    if (s.selectable) row.classList.add('selectable');

    const lbl = document.createElement('div');
    lbl.className = 'tp-2dlabel';
    lbl.innerHTML = (s.labels && s.labels[i]) || `<b>P${i + 1}</b> · ${s.positions[i]}`;

    const field = document.createElement('div');
    field.className = 'tp-field';

    const { startCol, pinCol } = slideCols(s.positions[i]);

    const tray = document.createElement('div');
    tray.className = 'tp-tray';
    if (s.highlightPlate === i) tray.classList.add(s.highlightKind === 'next' ? 'next' : 'sel');
    tray.style.gridColumn = `${startCol} / span 7`;
    field.appendChild(tray);

    for (let c = startCol; c < startCol + 7; c++) {
      const hole = document.createElement('div');
      hole.className = 'tp-hole2';
      if (c === pinCol) {
        hole.classList.add('pin');
        if (s.positions[i] === 4) hole.classList.add('ok');
      }
      hole.style.gridColumn = String(c);
      field.appendChild(hole);
    }

    if (s.selectable) {
      for (const el of [lbl, field]) {
        el.dataset.action = 'select-plate';
        el.dataset.plate = String(i);
      }
    }

    row.appendChild(lbl);
    row.appendChild(field);

    if (s.rowsRight && s.rowsRight[i]) {
      const right = document.createElement('div');
      right.className = 'tp-2dright';
      right.innerHTML = s.rowsRight[i];
      row.appendChild(right);
    }
    board.appendChild(row);
  }

  // one dashed keyway box over column 7, spanning all rows (positioned by CSS)
  const keybox = document.createElement('div');
  keybox.className = 'tp-keybox';
  board.appendChild(keybox);

  host.appendChild(board);
}
```

- [ ] **Step 2: Verify the geometry tests still pass**

Run: `node --test test/board.test.js`
Expected: PASS (importing the module still works; `slideCols` unchanged).

- [ ] **Step 3: Visual check in the dev server**

Run: `python3 scripts/serve.py` and open `http://localhost:8000`. Set up a 4-plate lock with
varied initial positions. Confirm in **Setup**: each slide is offset by its position (pin =
middle hole), slides stagger, and the dashed keyway box frames the center pegs. A plate set
to 4 shows a green pin inside the box.

- [ ] **Step 4: Commit**

```bash
git add src/ui/board.js
git commit -m "feat(ui): render plates as offset slides on the 13-wide board"
```

---

### Task 4: Next-move highlight on Solve

**Files:**
- Modify: `src/ui/app.js` (the Solve panel's next-move path, around the `const next = state.plan[state.planIndex];` block, ~line 516)

- [ ] **Step 1: Set the highlight on the board props**

In `solvePanel`, right after `const next = state.plan[state.planIndex];` and
`const remaining = …`, add:

```js
  boardProps.highlightPlate = next.plate;
  boardProps.highlightKind = 'next';
```

(The Map call at `createBoard(boardHost, { …, highlightPlate: active, … })` already passes
`highlightPlate`; with no `highlightKind` it defaults to the `sel` tray style — no change
needed there.)

- [ ] **Step 2: Visual check Map + Solve**

Run (if not already): `python3 scripts/serve.py`, open `http://localhost:8000`.
- **Map:** select a plate → its slide tray gets the gold *filled* highlight; other rows keep their *Moves with / Moves opposite* controls to the right.
- **Solve:** the next-move plate's tray gets the gold *outline*; as you press **Did it ›** the highlight follows the plan; a plate reaching 4 turns its pin green inside the keyway box.

- [ ] **Step 3: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): highlight the next-move plate on the solve board"
```

---

### Task 5: Full verification + phone-width pass

**Files:** none (verification only; small CSS tweak only if needed)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: PASS — all existing model/solver/discovery/storage/integration tests plus the new
`board.test.js`. No regressions (board changes are render-only; pure modules untouched).

- [ ] **Step 2: Phone-width check**

In the browser devtools, set a narrow viewport (~390px). Confirm the 13-wide field + label
fits without horizontal scroll on **Solve** and **Setup**. If it overflows, reduce
`--hole` (e.g. 14px) and/or `--colgap` (e.g. 3px) and/or `--label-w` (e.g. 50px) in the
`.tp-2d` rule — the keyway `left` calc and JS are all derived from these vars, so no other
change is needed. Re-check.

- [ ] **Step 3: Final commit (only if the tweak was made)**

```bash
git add css/styles.css
git commit -m "fix(ui): tighten board metrics to fit phone width"
```

---

## Notes for the implementer

- **Why no DOM unit tests:** the project has zero dependencies and `node --test` has no DOM.
  Rendering correctness is verified visually via `scripts/serve.py`; the *geometry* (the
  part that's easy to get wrong) is covered by `board.test.js`.
- **Single source of truth for metrics:** `--hole` and `--colgap` define the column step in
  CSS; the JS only uses `grid-column` indices (unitless), so it never needs the pixel sizes.
  The keyway box position is pure CSS `calc` from the same vars. Change sizes in one place.
- **Stage coverage:** Setup passes `{ positions }`; Map passes `{ positions, selectable,
  highlightPlate, labels, rowsRight }`; Solve passes `{ positions, highlightPlate,
  highlightKind: 'next' }`. All three flow through the one `createBoard`.
