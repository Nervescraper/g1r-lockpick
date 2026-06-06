# Cycle Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect repeating cycles (a unit of 1–3 distinct plates repeated ≥2×) in the solve plan and show a `×N` indicator, with a toggle to collapse each run into a compact summary row.

**Architecture:** A new pure module `src/cycles.js` exposes `findCycles(plan)`, which segments the flat move array into `single` and `cycle` segments. The Plan card in `src/ui/app.js` renders those segments two ways — annotated (default) or collapsed — governed by a persisted `settings.collapseCycles` flag. Stepping logic (`planIndex`, the Next-move card, keyboard handler) is untouched; cycles are a view-only overlay on the existing flat move array.

**Tech Stack:** Vanilla ES modules, no build step. Tests via `node --test` (node:test + node:assert/strict). Styles in `css/styles.css`.

**Spec:** `docs/specs/2026-06-05-cycle-indicators-design.md`

---

## File Structure

- **Create** `src/cycles.js` — pure `findCycles(plan)` detection. No DOM, no app state.
- **Create** `test/cycles.test.js` — unit tests for `findCycles`.
- **Modify** `src/ui/app.js` — `planCardEl` renders segments; new `cycleSegmentHtml` / row helpers; collapse toggle wired into the existing settings + click handler.
- **Modify** `css/styles.css` — bracket, `×N` badge, collapsed-row, and toggle styles.

---

## Task 1: Detection module `findCycles`

**Files:**
- Create: `src/cycles.js`
- Test: `test/cycles.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/cycles.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCycles } from '../src/cycles.js';

// Build a plan from a compact "P<dir>" shorthand, e.g. "1L 2R 1L".
function plan(s) {
  return s.trim().split(/\s+/).map((tok) => ({ plate: +tok[0] - 1, dir: tok[1] }));
}

test('empty plan yields no segments', () => {
  assert.deepEqual(findCycles([]), []);
});

test('plain no-repeat plan is all singles', () => {
  const segs = findCycles(plan('1L 2R 3L'));
  assert.deepEqual(segs.map((s) => s.type), ['single', 'single', 'single']);
  assert.deepEqual(segs.map((s) => s.index), [0, 1, 2]);
});

test('back-and-forth: one cycle, unitLen 2, reps 3, two plates', () => {
  const segs = findCycles(plan('1L 2R 1L 2R 1L 2R'));
  assert.equal(segs.length, 1);
  const c = segs[0];
  assert.equal(c.type, 'cycle');
  assert.equal(c.start, 0);
  assert.equal(c.unitLen, 2);
  assert.equal(c.reps, 3);
  assert.equal(c.length, 6);
  assert.deepEqual(c.plates, [0, 1]);
  assert.deepEqual(c.unit, plan('1L 2R'));
});

test('triangle: one cycle, unitLen 3, reps 2, three plates', () => {
  const segs = findCycles(plan('1L 2R 3L 1L 2R 3L'));
  assert.equal(segs.length, 1);
  const c = segs[0];
  assert.equal(c.unitLen, 3);
  assert.equal(c.reps, 2);
  assert.deepEqual(c.plates, [0, 1, 2]);
});

test('longer unit over two plates is flagged', () => {
  const segs = findCycles(plan('1L 1L 2R 1L 1L 2R'));
  assert.equal(segs.length, 1);
  assert.equal(segs[0].unitLen, 3);
  assert.equal(segs[0].reps, 2);
  assert.deepEqual(segs[0].plates, [0, 1]);
});

test('single-plate run is flagged at two repeats', () => {
  const segs = findCycles(plan('1L 1L'));
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'cycle');
  assert.equal(segs[0].unitLen, 1);
  assert.equal(segs[0].reps, 2);
  assert.deepEqual(segs[0].plates, [0]);
});

test('a four-plate repeating unit is NOT flagged (all singles)', () => {
  const segs = findCycles(plan('1L 2R 3L 4R 1L 2R 3L 4R'));
  assert.ok(segs.every((s) => s.type === 'single'));
  assert.equal(segs.length, 8);
});

test('two adjacent but distinct cycle runs become two cycle segments', () => {
  const segs = findCycles(plan('1L 2R 1L 2R 3L 4R 3L 4R'));
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.type), ['cycle', 'cycle']);
  assert.deepEqual(segs[0].plates, [0, 1]);
  assert.deepEqual(segs[1].plates, [2, 3]);
  assert.equal(segs[1].start, 4);
});

test('a cycle butted against singletons on both sides', () => {
  const segs = findCycles(plan('5R 1L 2R 1L 2R 3L'));
  assert.deepEqual(segs.map((s) => s.type), ['single', 'cycle', 'single']);
  assert.equal(segs[1].start, 1);
  assert.equal(segs[1].length, 4);
  assert.equal(segs[2].index, 5);
});

test('tie-break prefers the smallest unit: ABABAB is AB x3, not ABAB', () => {
  const segs = findCycles(plan('1L 2R 1L 2R 1L 2R'));
  assert.equal(segs[0].unitLen, 2);
  assert.equal(segs[0].reps, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cycles.test.js`
Expected: FAIL — `Cannot find module '../src/cycles.js'` (or "findCycles is not a function").

- [ ] **Step 3: Implement `src/cycles.js`**

Create `src/cycles.js`:

```js
// Detect repeating cycles in a solve plan. A "cycle" is a contiguous run that is
// an exact repetition of some unit block (reps >= 2) whose unit touches at most
// 3 distinct plates. Pure: no DOM, no app state. See
// docs/specs/2026-06-05-cycle-indicators-design.md.

const MAX_PLATES = 3;

const token = (mv) => `${mv.plate}${mv.dir}`;

// The best cycle starting exactly at index i, or null if none qualifies.
// "Best" = greatest coverage (reps * unitLen); ties break to the smallest unit.
function bestCycleAt(plan, i) {
  const n = plan.length;
  const maxLen = Math.floor((n - i) / 2); // need room for at least two reps
  let best = null;

  for (let len = 1; len <= maxLen; len++) {
    const plates = new Set();
    for (let j = i; j < i + len; j++) plates.add(plan[j].plate);
    if (plates.size > MAX_PLATES) continue;

    let reps = 1;
    for (;;) {
      const base = i + reps * len;
      if (base + len > n) break;
      let match = true;
      for (let j = 0; j < len; j++) {
        if (token(plan[i + j]) !== token(plan[base + j])) { match = false; break; }
      }
      if (!match) break;
      reps++;
    }
    if (reps < 2) continue;

    const coverage = reps * len;
    if (!best || coverage > best.length || (coverage === best.length && len < best.unitLen)) {
      best = {
        type: 'cycle',
        start: i,
        unit: plan.slice(i, i + len),
        unitLen: len,
        reps,
        length: coverage,
        plates: [...plates].sort((a, b) => a - b),
      };
    }
  }
  return best;
}

// Segment the flat move array left-to-right into 'single' and 'cycle' segments
// that cover the whole plan with no gaps or overlaps.
export function findCycles(plan) {
  const segs = [];
  let i = 0;
  while (i < plan.length) {
    const cyc = bestCycleAt(plan, i);
    if (cyc) { segs.push(cyc); i += cyc.length; }
    else { segs.push({ type: 'single', index: i }); i += 1; }
  }
  return segs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cycles.test.js`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `node --test`
Expected: PASS — every existing test still green.

- [ ] **Step 6: Commit**

```bash
git add src/cycles.js test/cycles.test.js
git commit -m "feat(cycles): detect repeating cycles in the solve plan"
```

---

## Task 2: Annotate cycle runs in the plan list (expanded mode)

This task renders the bracket + `×N` badge. The collapse toggle comes in Task 3;
here the list always renders in expanded form.

**Files:**
- Modify: `src/ui/app.js` (import at top; rewrite `planCardEl`, ~lines 457-471)
- Modify: `css/styles.css` (append after the `.ap-steplist` block, ~line 205)

- [ ] **Step 1: Import `findCycles`**

In `src/ui/app.js`, add to the imports at the top (next to the `solve` import on line 3):

```js
import { findCycles } from '../cycles.js';
```

- [ ] **Step 2: Add the CSS for brackets and the badge**

In `css/styles.css`, immediately after the line `.ap-steplist .past .step-arrow { color: #4f7a56; }` (line 205), add:

```css
/* cycle indicators in the plan list */
.ap-steplist .cyc { border-left: 2px solid var(--gold); padding-left: 7px; margin-left: 2px; }
.ap-steplist .cyc-first { margin-top: 2px; border-top-left-radius: 4px; }
.ap-steplist .cyc-last { margin-bottom: 2px; border-bottom-left-radius: 4px; }
.cyc-badge { margin-left: 6px; font-size: 11px; font-weight: 700; color: var(--gold); }
```

- [ ] **Step 3: Rewrite `planCardEl` to render segments**

Replace the whole `planCardEl` function (`src/ui/app.js` lines 457-471) with:

```js
// One move row, flat inside .ap-steplist so the scroll math and existing
// selectors keep working. `extra` adds cycle classes; `badge` appends the ×N tag.
function stepRowHtml(i, extra = '', badge = '') {
  const mv = state.plan[i];
  const cls = [i < state.planIndex ? 'past' : i === state.planIndex ? 'cur' : '', extra]
    .filter(Boolean)
    .join(' ');
  const check = i < state.planIndex ? ' ✓' : '';
  return `<div class="${cls}" data-action="goto-step" data-i="${i}">${i + 1} · ${plateLabel(
    mv.plate
  )} <span class="step-arrow">${dirArrow(mv.dir)}</span> ${DIR_WORD[mv.dir]}${check}${badge}</div>`;
}

// Expanded: list every move; a cycle run gets a left bracket + a ×N badge on its
// first row.
function expandedSegHtml(seg) {
  if (seg.type === 'single') return stepRowHtml(seg.index);
  const end = seg.start + seg.length - 1;
  let out = '';
  for (let i = seg.start; i <= end; i++) {
    const ends = (i === seg.start ? ' cyc-first' : '') + (i === end ? ' cyc-last' : '');
    const badge = i === seg.start ? `<span class="cyc-badge">×${seg.reps}</span>` : '';
    out += stepRowHtml(i, `cyc${ends}`, badge);
  }
  return out;
}

function planCardEl() {
  const segs = findCycles(state.plan);
  const steps = segs.map(expandedSegHtml).join('');
  const card = document.createElement('div');
  card.className = 'ap-card';
  card.innerHTML = `<div class="ap-h">Plan · click a step to jump there</div><div class="ap-steplist">${steps}</div>`;
  return card;
}
```

- [ ] **Step 4: Verify no test regressions**

Run: `node --test`
Expected: PASS — UI change touches no tested logic; all green.

- [ ] **Step 5: Manually verify the annotation renders**

Run: `python3 scripts/serve.py` and open http://localhost:8000.

Set up a plan that repeats:
1. Start a new lock; on Setup keep **2 plates**, and click each plate's scale so **both start at pin position 1** (not 4).
2. **Start mapping** → for each plate just click **Save plate** (leave all relations blank, no connections) until both are green → **Solve**.
3. The plan is 6 moves of pressing the two plates Left. In the **Plan** card you should see a gold **left bracket** spanning the repeating rows with a **`×3` badge** on the run's first row (it will be either `P1◀ P2◀` ×3 or two `×3` single-plate runs, depending on move order — both are correct).
4. Click a step / press advance — the bracket stays put, rows gain `✓`, and the `cur` row still highlights and scrolls into view as before.

Expected: bracket + badge visible; stepping behaves exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js css/styles.css
git commit -m "feat(ui): annotate repeating cycle runs in the solve plan"
```

---

## Task 3: Collapse toggle + collapsed summary rows

**Files:**
- Modify: `src/ui/app.js` (`planCardEl` header + collapsed branch; click handler ~line 694)
- Modify: `css/styles.css` (append after the Task 2 cycle block)

- [ ] **Step 1: Add CSS for the collapsed row and the toggle**

In `css/styles.css`, immediately after the `.cyc-badge { ... }` line added in Task 2, add:

```css
.ap-steplist .cyc-col .cyc-icon { color: var(--gold); font-weight: 700; }
.ap-steplist .cyc-col .cyc-prog { font-size: 11px; color: #9a9; margin-top: 2px; }
.ap-plan-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ap-collapse { font-size: 11px; color: #6b665c; text-transform: none; letter-spacing: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.ap-collapse input { accent-color: var(--gold); cursor: pointer; }
```

- [ ] **Step 2: Add the collapsed renderer and a header toggle to `planCardEl`**

In `src/ui/app.js`, add this helper just above `planCardEl` (next to `expandedSegHtml` from Task 2):

```js
// Collapsed: a cycle run becomes one summary row showing the unit and ×N. The run
// containing planIndex shows live "rep r/reps · move m/unitLen" progress.
function collapsedSegHtml(seg) {
  if (seg.type === 'single') return stepRowHtml(seg.index);
  const end = seg.start + seg.length;
  const active = state.planIndex >= seg.start && state.planIndex < end;
  const cls = active ? 'cur' : state.planIndex >= end ? 'past' : '';
  const unit = seg.unit
    .map((mv) => `${plateLabel(mv.plate)}<span class="step-arrow">${dirArrow(mv.dir)}</span>`)
    .join(' · ');
  let prog = '';
  if (active) {
    const off = state.planIndex - seg.start;
    const rep = Math.floor(off / seg.unitLen) + 1;
    const move = (off % seg.unitLen) + 1;
    prog = `<div class="cyc-prog">rep ${rep}/${seg.reps} · move ${move}/${seg.unitLen}</div>`;
  }
  return `<div class="cyc-col ${cls}" data-action="goto-step" data-i="${seg.start}">
    <span class="cyc-icon">↻</span> Repeat ${unit} <span class="cyc-badge">×${seg.reps}</span>${prog}</div>`;
}
```

Then replace the `planCardEl` body (from Task 2) with this version, which honours the toggle:

```js
function planCardEl() {
  const segs = findCycles(state.plan);
  const collapse = !!settings.collapseCycles;
  const steps = segs.map(collapse ? collapsedSegHtml : expandedSegHtml).join('');
  const card = document.createElement('div');
  card.className = 'ap-card';
  card.innerHTML = `<div class="ap-h ap-plan-h"><span>Plan · click a step to jump there</span>
    <label class="ap-collapse"><input type="checkbox" data-action="toggle-collapse"${
      collapse ? ' checked' : ''
    }> Collapse repeats</label></div>
    <div class="ap-steplist">${steps}</div>`;
  return card;
}
```

- [ ] **Step 3: Handle the toggle in the click handler**

In `src/ui/app.js`, in the `switch (a)` block, add a case next to `toggle-kbd` (~line 694):

```js
    case 'toggle-collapse':
      settings.collapseCycles = !settings.collapseCycles;
      saveSettings(store, settings);
      break;
```

- [ ] **Step 4: Verify no test regressions**

Run: `node --test`
Expected: PASS — all green.

- [ ] **Step 5: Manually verify collapse + progress**

Run: `python3 scripts/serve.py`, reach the same repeating plan as Task 2 step 5.

1. Tick **Collapse repeats** in the Plan header. The repeating rows collapse to one row: `↻ Repeat P1◀ · P2◀ ×3` (or `×3` for a single-plate run).
2. Press advance through the cycle. While `planIndex` is inside the run, the row shows `rep r/3 · move m/unitLen`, and the numbers update on **every single advance** (move increments within a rep; rep increments at unit boundaries).
3. Click the collapsed row — `planIndex` jumps to the run's start; the row highlights and the board/Next-move card update.
4. Untick — the list returns to the expanded bracket view. Reload the page — the toggle state persists (it's saved in settings).

Expected: collapse compacts the run, per-move progress updates live, click-to-jump works, state persists across reload.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js css/styles.css
git commit -m "feat(ui): collapse-repeats toggle for cycle runs in the plan"
```

---

## Self-Review notes

- **Spec coverage:** detection rule + algorithm → Task 1; expanded bracket/`×N` → Task 2; collapse toggle, collapsed summary, live `rep r/reps · move m/unitLen`, persisted setting, click-to-jump → Task 3; tests enumerated in the spec → Task 1 Step 1 (all nine spec cases plus the empty-plan guard).
- **Stepping untouched:** no task edits `planIndex`, `computeSolvePositions`, `did-it`/`goto-step` semantics, the keyboard handler, or `reserveMoveDescHeight`. Rows stay flat direct children of `.ap-steplist`, so `scrollCurrentStepIntoView`'s `offsetTop` math and the `.cur` lookup keep working (the active collapsed row carries the `cur` class).
- **Type consistency:** segment shape (`type`, `start`, `unit`, `unitLen`, `reps`, `length`, `plates`) is defined in Task 1 and consumed unchanged in Tasks 2–3. `settings.collapseCycles` is the single flag used by both the renderer and the handler.
