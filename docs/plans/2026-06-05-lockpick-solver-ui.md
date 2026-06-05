# Lockpick Solver — Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the browser UI on top of the core engine: the isometric/2D board, the Setup → Discovery → Solve stage flow, the blocked-probe retry UX, and `localStorage` persistence.

**Architecture:** A single static page loads ES modules over HTTP. `src/ui/board.js` renders the plate board (3D isometric or flat 2D) and self-aligns upright gutter labels by measuring each plate. `src/ui/app.js` is a small controller holding `{stage, n, positions, mapping, plan, planIndex, lock}`, rendering the right-hand panel per stage and wiring events to the engine modules.

**Tech Stack:** Vanilla JS ES modules, plain CSS. No build. Served over HTTP (`python3 -m http.server`) — `file://` won't load modules.

**Reference:** spec `docs/specs/2026-06-05-g1r-lockpick-solver-design.md`; engine plan `docs/plans/2026-06-05-lockpick-solver-core-engine.md` (must be implemented first). Board/panel CSS prototyped during brainstorming.

**Verification note:** UI is verified manually in a browser (no headless DOM in this toolchain). Each task lists explicit things to click/observe. Module files are syntax-checked with `node --check`.

---

## File Structure

- `index.html` — page shell; mounts `#app`; loads `src/ui/app.js` as a module.
- `css/styles.css` — theme, board (3D + 2D), panels, controls.
- `src/ui/board.js` — `createBoard(host)` → `{ setState, align }`. Pure rendering; no engine logic.
- `src/ui/app.js` — controller: stage flow, panel rendering, event wiring, persistence.

---

## Task 1: Page shell and theme

**Files:** Create `index.html`, `css/styles.css`

- [ ] **Step 1:** Create `index.html` with a header, an `#app` mount, and `<script type="module" src="./src/ui/app.js">`.
- [ ] **Step 2:** Create `css/styles.css` with the dark theme variables and base layout (`.ap-main` flex: board left, side panel right).
- [ ] **Step 3 (verify):** `python3 -m http.server 8000`, open `http://localhost:8000`, confirm the page renders the header without console errors.
- [ ] **Step 4:** Commit `index.html css/styles.css`.

Full CSS and HTML are produced in the implementation (board/panel styles carried over from the approved mockups).

## Task 2: Board renderer (`src/ui/board.js`)

`createBoard(host)` returns `{ setState(s), align() }` where `s = { positions, coupling?, basic, highlightPlate?, dimOthers?, labelExtra? }`.

- [ ] **Step 1:** Build the `.tp-stage`, plates (`.tp-plate` with 7 `.tp-hole`s, goal hole gets `.goal`, pin hole gets `.pin`), and a `.tp-flatlabel` per plate in a left gutter.
- [ ] **Step 2:** Implement `align()` measuring each plate's `.tp-hole.goal` rect and parking its label at that vertical center; call on `setState`, `load`, and `resize`.
- [ ] **Step 3:** Support `basic` (2D flat rows) by toggling a class on `host`.
- [ ] **Step 4 (verify):** `node --check src/ui/board.js`; in the browser, a temporary mount shows 5 plates with aligned labels; ticking 2D swaps the view.
- [ ] **Step 5:** Commit.

## Task 3: App controller — Setup stage

- [ ] **Step 1:** `src/ui/app.js` mounts the stage rail, a board, and a side panel; holds state; restores session via `storage.loadSession`.
- [ ] **Step 2:** Setup panel: plate-count stepper (3–8) and a 1–7 position picker per plate; board previews positions live.
- [ ] **Step 3:** "Start mapping" creates `createMapping(n)` and switches to Discovery.
- [ ] **Step 4 (verify):** change count and positions; board updates; Start mapping advances.
- [ ] **Step 5:** Commit.

## Task 4: App controller — Discovery stage

- [ ] **Step 1:** Make every board plate clickable (`select-plate`); the active plate is highlighted. `recommendNext(...)` is shown as a **non-blocking** "Suggested" hint (or a prep "Do it" tip), never forcing the order.
- [ ] **Step 2:** A Left/Right direction toggle (`set-dir`) with a `probeSafe` badge. Moved/Blocked outcome. On Moved: a `◀ left / ▶ right` recorder per plate; "Save" calls `applyProbe(...)`, advancing positions and marking the plate mapped, then auto-suggests the next plate. No Defer button — switching plates is just clicking another one; marks persist.
- [ ] **Step 3:** On Blocked: show the retry guidance (toggle to the opposite dir / prep), note the durability cost; positions unchanged.
- [ ] **Step 4:** Progress dots (mapped / not yet). When `allMapped`, enable "Solve".
- [ ] **Step 5 (verify):** map a small lock by hand; deferring keeps marks; allMapped enables Solve.
- [ ] **Step 6:** Commit.

## Task 5: App controller — Solve stage

- [ ] **Step 1:** `solve(positions, mapping.coupling)`; if null, show "no solution — revisit mapping"; else store `plan`, `planIndex = 0`.
- [ ] **Step 2:** Next-move card (`P{n} → Left/Right`), the shift description, and the plan step list with the current step highlighted; "Did it ›" advances `planIndex` and applies the move to positions; "Back" steps back.
- [ ] **Step 3:** "Edit positions" returns to a position editor and re-`solve`s.
- [ ] **Step 4:** Coupling reference (move cards) with the left=+1/right=−1 legend.
- [ ] **Step 5 (verify):** a mapped lock produces a step list; advancing updates the board to all-4.
- [ ] **Step 6:** Commit.

## Task 6: Persistence and lock library

- [ ] **Step 1:** On completing a mapping, offer "Save lock" (name) → `storage.saveLock(localStorage, {...})`.
- [ ] **Step 2:** Setup shows saved locks (`storage.loadLocks`); selecting one loads its coupling and jumps to Solve after entering current positions.
- [ ] **Step 3:** Persist working session (`saveSession`) on each state change; restore on load.
- [ ] **Step 4 (verify):** save a lock, reload the page, the lock is listed and reloadable; mid-session refresh restores stage.
- [ ] **Step 5:** Commit.

## Task 7: Final pass

- [ ] **Step 1:** Keyboard support: A/D or ←/→ to mark/advance where natural; Esc cancels editors.
- [ ] **Step 2:** `node --check` on all UI modules; full `node --test` still green (engine untouched).
- [ ] **Step 3 (verify):** end-to-end run of a fresh lock from Setup to opened.
- [ ] **Step 4:** Commit.

---

## Self-Review

- Spec §6 UI (board, gutter labels, 2D toggle, three panels, terminology) → Tasks 1–5.
- Spec §5.4 blocked-probe retry → Task 4 Step 3.
- Spec §8 persistence → Task 6.
- No engine changes; UI imports `model`, `solver`, `discovery`, `storage` unchanged.
