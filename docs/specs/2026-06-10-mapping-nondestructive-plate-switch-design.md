# Non-destructive plate switching in mapping mode

**Date:** 2026-06-10
**Status:** Design approved, ready for planning
**Area:** `src/ui/app.js` (mapping-stage recording lifecycle)

## Problem

In mapping mode the player records one plate at a time: drag the active plate to set
its press direction, drag (or button-tag) other plates to mark them `with`/`opposite`.
This tentative work lives in `state.rec` and is not committed until **Save**.

Switching which plate is active — `seedRecording(plate)` at `src/ui/app.js:286` — rebuilds
`state.rec` from scratch and resets `state.recTouched`, **discarding any in-progress tags
and direction on the previously active plate.**

The player reported a recurring real-world failure: while reaching to *drag* a slider they
sometimes register an accidental *tap* first (tap = switch active plate). The stray tap
switches the active plate, which (a) throws away the recording they had in progress and
(b) changes what their following drag means (a drag on another plate tags it relative to
the now-wrong active plate).

### Approaches considered and rejected

- **A — Deferred click (time buffer).** Hold a tap for ~Nms; cancel it if a new press
  arrives. Rejected: the player measured their fumble gap (stray-tap-release → real-press)
  at **750ms–1s** using an interactive timing mockup. A buffer wide enough to cover that
  makes every deliberate tap-to-switch feel sluggish.
- **B — Instant switch + revert-on-drag.** Act on the tap immediately but snapshot prior
  state and undo it if a drag follows within the window. Rejected: at a ~1s window the
  fumble sequence is indistinguishable from *intentional* "tap to select, then drag"
  workflows (`dragActive` to set the selected plate's direction; `dragOther` to tag another
  plate against the just-selected one), so B would silently revert gestures the player
  meant. Also adds a visible state flip and a fragile snapshot/restore surface.

The measured ~1s cadence is the core finding: **time-based disambiguation is the wrong
tool.** Instead of preventing the stray tap, make it *harmless*.

## Solution — Approach E: preserve per-plate recordings

Switching plates stops being destructive. Each plate's touched-but-unsaved recording is
cached when you switch away and restored when you switch back, so a stray tap (or any
plate-hop) costs nothing — tap onto the wrong plate, tap back, and the draft is exactly as
left.

### Recording shape (unchanged)

`state.rec = { baseline, active, deltaI, tags }` (see `createRecording`,
`src/ui/mapping-record.js:19`). `baseline` is a snapshot of `state.positions` taken when
the recording was created. This snapshot is the validity key for the cache.

### Changes

1. **New state field `state.recDrafts`** — a plain object keyed by plate index, holding
   *touched* recordings that have not yet been saved. Initialised to `{}` alongside the
   other mapping state.

2. **Stash on switch-away.** At the top of `seedRecording(plate)`, before `state.rec` is
   replaced: if `state.recTouched` is true and `state.activePlate` is a valid plate index,
   store the current recording: `state.recDrafts[state.activePlate] = state.rec`.

3. **Guarded restore on switch-back.** When `seedRecording(plate)` builds the recording for
   `plate`:
   - If `state.recDrafts[plate]` exists **and** its `baseline` is element-wise equal to the
     current `state.positions`, restore it: `state.rec = state.recDrafts[plate]` and set
     `state.recTouched = true`. Skip the suggestion-direction override (the restored draft
     already holds the player's chosen direction).
   - Otherwise build a fresh recording exactly as today (`createRecording` +
     suggestion-direction seeding), with `state.recTouched = false`.

   The baseline-equality guard is the correctness mechanism: any event that mutates
   `state.positions` (Save commits `positionsOf(rec)` at `src/ui/app.js:317`; apply-move;
   a jam) leaves every cached draft with a stale baseline, so it fails the guard and a clean
   fresh recording is built. No stale tags can ever apply to a changed board.

4. **Drop a draft on save.** In `saveActivePlate` (`src/ui/app.js:311`), after a successful
   commit, `delete state.recDrafts[rec.active]` — the row is now observed truth.

No call sites need to change: every plate switch in mapping mode (the stray tap, the
ledger, keyboard/suggestion re-seeds) already routes through `seedRecording`, so all of
them become non-destructive automatically.

### Helper

A small `samePositions(a, b)` element-wise array comparison (both are equal-length numeric
arrays) used by the guard. Place it near the other mapping helpers in `app.js`.

## Behaviour after the change

- **Stray tap on the same plate then drag it:** benign, as before — plate stays active,
  drag sets its direction.
- **Stray tap on a different plate then drag the intended one:** the wrong plate becomes
  active and the drag tags against it, *but* the intended plate's draft is preserved.
  Recovery is one lossless tap back to the intended plate. (This sub-case is not fixed in a
  single motion — see Non-goals.)
- **General plate-hopping while building tags:** now non-destructive across the board, a
  robustness win beyond the original complaint.

## Non-goals / out of scope

- **No time buffer.** Explicitly not implementing Approach A or B. A future ~120ms buffer to
  swallow truly-instant double-fires could layer on later, but is omitted now (YAGNI) — the
  measured ~1s cadence means it would buy little and E removes the pain.
- **The stray-tap-on-C-then-drag-B sub-case is not prevented in one motion.** It is reduced
  from destructive to a lossless one-tap recovery, which the player accepted.
- No change to how recordings are committed, to coupling math, or to the suggestion engine.

## Testing

Unit-level (the recording logic is pure and already unit-tested in this area):

1. **Stash + restore round-trip.** Seed plate A, tag a plate (touch it), switch to plate B,
   switch back to A → A's recording (tags + deltaI) is restored intact and `recTouched` is
   true.
2. **Guard invalidates stale drafts.** Seed A, touch it, switch to B, change `state.positions`
   (simulate a save/apply-move so baselines diverge), switch back to A → a *fresh* recording
   is built (no restored tags), `recTouched` is false.
3. **Untouched recordings are not cached.** Seed A (no edits), switch to B, switch back to A →
   fresh recording; `state.recDrafts` has no entry for A.
4. **Save clears the draft.** Touch A, save A → `state.recDrafts[A]` is absent; a later visit
   to A builds fresh.
5. **Suggestion direction is not clobbered on restore.** With suggestions on, drag A's
   direction opposite the suggestion (touch), switch away and back → restored direction is the
   player's, not the suggestion's.

## Risk

Low and contained. One new state field, a stash + guarded-restore inside a single function,
one delete in save, one pure helper. The baseline guard means the worst-case failure mode
(a stale draft) degrades to today's behaviour (fresh recording), never to a corrupted board.
