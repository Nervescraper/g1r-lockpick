# Gothic 1 Remake Lockpick Solver — Design

**Date:** 2026-06-05
**Status:** Approved design, ready for implementation planning

## 1. Purpose

A web app that helps solve the Gothic 1 Remake lockpicking puzzle. The puzzle is a
coupled-sliders mechanic: a stack of plates, each with a pin that must be brought to
the center hole. Moving one plate also shifts others by hidden, fixed relationships.
Working this out by hand — and finding a move order that never breaks a lockpick — is
tedious and error-prone. The app guides the player through discovering the lock's
relationships, then computes and walks them through a safe solution.

The tool is a personal aid used live while playing, on a second monitor or phone.

## 2. The puzzle mechanic

As observed in-game (the public guides available at launch are wrong; this model comes
from direct observation):

- A lock has **N plates** (N ranges roughly **3–8**; varies per lock).
- Each plate has a **pin position** in **1–7**. The goal is **every pin at position 4**
  (the center hole). When all pins are at 4, the lock opens.
- In-game controls: **W/S** select which plate is active; **A/D** shift the active plate.
  **Left shifts the active plate's pin by +1; Right by −1.**
- **Coupling:** shifting a plate also shifts other plates. For each plate `i` there is a
  fixed **effect vector** `E_i` over all plates, with entries in `{−1, 0, +1}`, describing
  what pressing **Left** on plate `i` does to every pin. Pressing **Right** applies the
  exact inverse, `−E_i`. All shifts are by exactly 1. The coupling is fixed per lock,
  consistent, and visible when a move actually happens.
- **Edges block.** A move is legal only if it keeps **all** pins within 1–7. If any
  affected pin would go past an edge, the **entire move is blocked**: nothing moves and it
  **costs one lockpick durability**. Blocked moves must be avoided.
- **Blocked moves hide information.** When a move is blocked, the game only shakes the
  stuck plate; the other plates that move *would* have shifted are not shown. So a blocked
  probe reveals nothing about the coupling beyond "something was at an edge."

We do **not** assume `E_i[i] = +1` or any symmetry; the app records exactly what is observed.

## 3. What the app does

Three stages share one screen frame (stage rail on top, board on the left, context panel
on the right):

1. **Setup** — enter the plate count and each plate's current pin position.
2. **Map the lock (Discovery)** — a guided wizard helps the player probe each plate and
   record its coupling, ordering probes to avoid breaking a pick.
3. **Solve (play-along)** — compute a safe move sequence to bring all pins to 4 and walk
   the player through it move by move, tracking live positions.

Locks can be saved and reloaded so a previously mapped chest skips straight to Solve.

## 4. Core model and solver

### 4.1 Representation

- **Position vector** `p` of length N, each entry in `[1,7]`. Goal: all entries `= 4`.
- **Coupling matrix** `E`: N rows, each `E_i ∈ {−1,0,+1}^N`. Row `i` is the effect of
  pressing Left on plate `i`.
- A **move** is `(plate i, dir ∈ {Left, Right})`. Effect: `p' = p + (dir == Left ? E_i : −E_i)`.
- A move is **legal** iff every entry of `p'` stays in `[1,7]`.

### 4.2 Solver

- Shortest-path search over position vectors, expanding **only legal moves**, from the
  current positions to the all-4 goal. Use **A\*** (Manhattan-style admissible heuristic
  on distance-to-4) or BFS; the state space is small (≤ 7⁸ ≈ 5.7M, real searches far
  smaller), so this is effectively instant.
- Because illegal moves are never expanded, any returned solution is **edge-free** (zero
  durability cost). Projected breaks for a found plan is always 0.
- **No solution found** ⇒ the mapping is almost certainly incomplete or has a wrong cell;
  surface a clear message prompting the player to revisit Discovery.

## 5. Discovery (risk-aware mapping)

Goal: fill in `E` by probing each plate, while avoiding blocked moves (which cost
durability and reveal nothing).

### 5.1 Probing

To map plate `i`: in-game, select plate `i` and press Left (or Right) once, observe which
plates shift and in which direction, and record it. Each probe is a **real move** — the
app applies the observed shifts to its tracked positions. **No reset is needed** between
probes.

### 5.2 Recording

- The **active plate appears as a non-interactive placeholder** in the recorder (so the
  list keeps its order), not as a markable option: pressing a plate always moves that
  plate's own pin by the press direction, so its self-shift is recorded automatically
  (its coupling diagonal is +1 in the Left frame). The player only marks the **other**
  plates they saw move.
- For each other plate the player marks **◀ left** (+1) or **▶ right** (−1), or leaves it
  unmarked. There is no explicit "none" button: on a successful (**Moved**) probe every
  side-effect shifts visibly, so unmarked plates are taken as no-connection and the whole
  row is (re)written on save — which also lets the player **correct a mistake** by
  re-selecting the plate and un-marking it.
- A probe's outcome is **Moved** or **Blocked**. A **Blocked** attempt is *not* saved (it
  reveals nothing and would wrongly imply zeros), so confirmed zeros only ever come from a
  Moved probe.
- Re-selecting a plate **restores its recorded marks** so the player can review or fix it.
  Because the coupling is fixed, a saved row stays valid until deliberately changed.

### 5.3 Risk-aware sequencing

- A probe is **guaranteed not to block** when **all** other plates are at interior
  positions (2–6): any single ±1 shift then stays in bounds regardless of the unknown
  coupling. The wizard prefers these probes first and labels them **"✓ won't block."**
- **Direction choice:** pick Left vs Right so the selected plate (and any already-known
  affected plates) stay in bounds.
- **De-risking with known relationships:** once some rows are known, the wizard can first
  nudge an edge-stuck plate toward center using a known-safe move, then perform a probe
  that was previously risky.
- **Honest fallback:** when no fully safe probe exists yet, the wizard still recommends the
  least-risky option and flags it, rather than implying safety.

### 5.4 Blocked-probe handling

If a probe is **Blocked**: anything already seen is **kept**; the wizard suggests a fix
(try the opposite direction, or move the offending edge plate toward center first) and the
player retries. The blocked attempt costs 1 durability, so a tricky plate may take a couple
of passes.

### 5.5 Free selection (no explicit defer)

Mapping is **free-form**: the player clicks any plate on the board to record it, and clicks
another plate to switch at any time. There is no separate "defer" step — switching away
simply leaves a plate unfinished, and every mark already made for it is **kept** (the
coupling matrix persists). This matches the common case where you see one plate shift, mark
it, then must work other plates before the rest of its row can be observed. The safe-probe
recommendation (§5.3) is still computed and shown as a **non-blocking suggestion** ("record
this one next"), but never forces the order. Progress is shown per plate as **mapped / not
yet**, and a plate's row can be revisited and revised by clicking it again.

## 6. UI

### 6.1 Board visualization

- A 3D isometric render mirroring the in-game look: plates are slabs with **holes on the
  top face** and **pins poking up**; the stack **recedes up and to the right**, front plate
  nearest. Goal hole (4) on each plate is marked with a **dashed rectangle**; the pin is an
  amber dot, green when that plate is at the goal.
- **Plate labels are upright flat text** in a left gutter (never part of the angled view).
  Each label is positioned by **measuring its plate's rendered box** (`getBoundingClientRect`)
  and parking the label at that height; re-run on load and resize. This keeps labels aligned
  for any plate count, perspective, or window size — no hardcoded offsets.
- A **"2D view" checkbox** swaps the isometric board for a plain flat stack of rows for
  maximum legibility.

### 6.2 Stage panels (right side)

- **Setup:** plate-count stepper (3–8); a 1–7 position picker per plate (goal hole marked);
  the board previews positions live. "Start mapping."
- **Discovery:** click any plate on the board to record it (the active plate is highlighted);
  a Left/Right direction toggle with a safety badge ("✓ won't block" / "⚠ risky"); **Moved /
  Blocked** outcome; per-plate **◀ left / ▶ right** recorder; blocked-probe guidance; "Save";
  a non-blocking "Suggested" hint for the next safe plate; per-plate progress dots.
- **Solve:** big **next move** callout (e.g. `P4 → Left ✓ safe`) with what it shifts and
  edge-safety; **Back / Did it › / Edit positions** controls; the full **plan** as a step
  list with the current step highlighted; durability and projected breaks (0); a **coupling
  reference** (move cards: "Press L P1 → P1 ◀ left, P3 ▶ right", with a left=+1 / right=−1
  legend).
- If the player deviates mid-solve, **Edit positions** corrects the state and the plan
  re-computes instantly.

### 6.3 Terminology

Plate movement is always described as **shift left / shift right** (with ◀/▶), never
up/down. Left = pin position +1, Right = pin position −1.

## 7. Architecture

- **Pure client-side static app.** No backend. Plain **HTML + CSS + vanilla JS (ES
  modules)**, **no build step**. Runs by opening the file locally or hosting the static
  files (e.g. GitHub Pages). Works offline; fine on a phone or second monitor.
- Suggested module split:
  - `model.js` — positions, coupling, `applyMove`, legality checks.
  - `solver.js` — A\*/BFS shortest legal-move path to all-4.
  - `discovery.js` — probe sequencing, safety/risk evaluation, blocked/defer handling.
  - `storage.js` — save/load locks via `localStorage`.
  - `ui/` — board renderer (3D + 2D, gutter-label measurement), stage frame, the three
    stage panels.
- Keep each unit small and independently testable: the solver and model are pure functions
  over plain data and can be unit-tested without the DOM.

## 8. Persistence

- Saved **lock** record: `{ id, name, n, coupling (N×N of −1/0/+1), notes }`.
- Stored in `localStorage`; a saved-locks list lets the player reload a mapped chest and go
  straight to Solve.
- Session/working state (current positions, stage, in-progress mapping, current plan) is
  also kept so a refresh doesn't lose progress.

## 9. Out of scope (YAGNI)

- No combination/lock database or sharing, no accounts, no server.
- No automated screen-reading of the game; all input is manual.
- No game-specific durability/skill modeling beyond "avoid blocked moves and show projected
  breaks = 0."

## 10. Assumptions to verify in-game

These don't block the design (the app records observed behavior rather than assuming), but
are worth confirming as more locks are encountered:

- Plate count range is ~3–8.
- The goal is always center hole **4** with a 1–7 range on every plate.
- The selected plate's own shift under Left is consistently +1 (we record it regardless).
- Coupling is not assumed symmetric or to have any particular structure.
- A blocked move costs exactly one durability and reveals nothing (only shakes the stuck
  plate).
