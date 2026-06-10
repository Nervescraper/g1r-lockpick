import { createBoard } from './board.js';
import { nextActivePlate } from './active-plate.js';
import { applyMove, moveDelta, isSolved, isLegal, GOAL, MIN, MAX } from '../model.js';
import { solve, diagnoseDrift } from '../solver.js';
import {
  createRecording, tagOf, positionsOf, couplingRow,
  toggleTag, dragActive, dragOther, validRecording, setActiveDir, restorableDraft,
} from './mapping-record.js';
import { coachingMessage } from './coaching.js';
import { findCycles, expandedLayout, nextSectionStart, prevSectionStart } from '../cycles.js';
import { planColumnCount } from './plan-columns.js';
import { createMapping, recommendNext, allMapped, defer } from '../discovery.js';
import {
  loadLocks, saveLock, getLock, deleteLock, loadSession, saveSession, loadSettings, saveSettings,
  exportLocks, encodeShare, parseImport, classifyImport, sameIdentity, sanitizeContents,
} from '../storage.js';
import { groupLocks } from '../locks-view.js';
import { shouldShowBadge } from './changelog-badge.js';

const store = window.localStorage;
const N_MIN = 3;
const N_MAX = 8;
const DIR_WORD = { L: 'Left', R: 'Right' };

// Bump when a changelog update should re-show the "New" badge on the Changelog
// button. Leave unchanged for silent edits (typos, rewording) that shouldn't
// re-notify users who've already seen the latest entries.
const CHANGELOG_VERSION = '1.3.0';

// User-facing changelog, newest first. Shown in the in-app changelog modal.
const CHANGELOG = [
  {
    date: '2026-06-09',
    items: [
      'Jams now teach the app: click “It jammed”, tap any slides you saw wiggle, and it learns the links, stops suggesting moves that must fail, and names the blocker itself when only one slide sits on an edge.',
      'Your pick is tracked like the game’s: the first jam is a warning, the second breaks it — and the board resets itself to match the snapped-back slides.',
      'The mapping screen is now a compact ledger: everything sits on the slider rows under two columns — “moved?” (⇉ with / ⇄ opposite) and “move it” (◀ ▶ for mapped slides) — flipping to “wiggled?” after a jam. Words on wide screens, symbols on phones.',
      'Click a mapped slide to review its links without changing anything; Cancel an accidental edit, or quietly forget that one slide’s mapping to redo it.',
      'Solving long plans is lighter: same-direction runs step as one (“P2 ▶ Right ×6 — Did all 6”), and the Connections panel uses the same ⇉ / ⇄ icons.',
      'Sharper guidance and fixes: known moves that free an edge are suggested when nothing is safe, “Edit positions” no longer moves the reset point, and R matches the Reset button exactly.',
      'Sharing is quicker: the Lock open! screen shows the lock’s share code with a Copy button, and pasting a code on the Lock page imports it on the spot.',
      'Mis-slid in the game? “Oops…” counts the stray jam (while mapping or solving) so pick durability stays in sync — the second mistake breaks the pick and the board resets itself to match.',
      'Solution failed in the game? If the planned move jammed, “It jammed” now works mid-solve — that slide’s row is provably wrong, so it’s marked for re-recording with the full wiggle capture. If the pins drifted instead, enter the real positions via “Edit positions” and the app names the rows that could explain it, with one-tap review.',
      'Board stopped matching the lock while mapping? “Lock doesn’t match?” rewinds your recent moves one undo at a time — the first state where lock and board agree again names the mis-recorded slide, re-opens its row, and leaves everything in sync (with a fix-by-hand fallback).',
    ],
  },
  {
    date: '2026-06-09',
    items: [
      'Mapping now tracks where your slides are as you go — record each plate by dragging the slides or with the Moves with / Moves opposite buttons, and the board stays in sync.',
      'The suggested next move is shown right on the board: a faint ghost marks where each slide is now, and the solid slide shows where the press lands.',
      'New “Move slides” controls let you apply moves you’ve already mapped to reposition the slides — handy for pulling a slide off an edge before mapping it.',
      'Broke a pick? Reset the slides back to the start in one click — everything you’ve mapped is kept.',
      'Edge warnings call out when a slide is on pin 1 or 7, so you can clear it before a probe jams the pick.',
      'Prefer to map on your own? Turn off “Suggest moves” to hide the guidance and just use the board.',
    ],
  },
  {
    date: '2026-06-08',
    items: [
      'The Full Plan view now spreads across multiple columns on wide, short screens, so more of it fits without scrolling.',
      'Press Z while solving to open or close the Full Plan view.',
      'With collapsed cycles on, press N or P to skip a whole grouped section forward or back at once instead of stepping through every repeat.',
    ],
  },
  {
    date: '2026-06-07',
    items: [
      'Saved locks now group into collapsible folders by location, with your most recent locks kept at the top.',
      'Show Full Plan opens the whole plan in a full-screen view — click and keyboard shortcut actions function normally.',
      'Edit a saved lock’s name (location, type, description) alongside its contents from the ✎ editor.',
    ],
  },
  {
    date: '2026-06-06',
    items: [
      'Solver now groups moves by plate where it can, so you re-select plates less often — same shortest, edge-free solution.',
      'Record chest contents — keep a loot list alongside each saved lock.',
      'Import and export saved locks, to back them up or move them between devices.',
    ],
  },
  {
    date: '2026-06-05',
    items: [
      'First release: map a lock plate by plate, then get a safe, edge-free solution that costs zero durability.',
      'Step-by-step solve walkthrough, with keyboard shortcuts to move through the plan.',
      'Repeating cycles in the plan are bracketed with a countdown and can be collapsed.',
      'Set pin positions by dragging the slides or with the number keys.',
      'Save locks in your browser and name them by location and type.',
      'Layout tuned for phones.',
    ],
  },
];

const appEl = document.getElementById('app');

let state = restore();
let settings = loadSettings(store);
const kbdEnabled = () => settings.keyboardShortcuts !== false; // on by default
const suggestEnabled = () => settings.suggestMoves !== false; // move suggestions on by default
// Phones have no physical keyboard, so the shortcuts are useless and their toggle is
// hidden (see the <=560px CSS breakpoint); treat that narrow viewport as "shortcuts off".
const isNarrowViewport = () => window.matchMedia('(max-width: 560px)').matches;

function restore() {
  const s = loadSession(store);
  if (s && s.stage) return s;
  return freshSetup(5);
}

function freshSetup(n) {
  return {
    stage: 'lock',
    n,
    positions: Array(n).fill(GOAL),
    initial: null,
    mapping: null,
    rec: null,
    editing: false,
    location: '',
    kind: 'Chest',
    description: '',
    contents: [],
    lockId: undefined,
    lockLoaded: false,
  };
}

function persist() {
  const { n, initial, mapping, location, kind, description, contents, lockId, lockLoaded, plan, planIndex, solveStart, blockedProbes, knownLinks, pickMistakes, picksBroken, stepLog } = state;
  // The import and contents screens are transient overlays over the Lock step — never
  // persist them as a saved session stage (a reload would otherwise restore an empty one).
  const stage = state.stage === 'import' || state.stage === 'contents' ? 'lock' : state.stage;
  // While editing positions in Solve, changes stay pending until Apply — persist the
  // pre-edit snapshot so a drag/keystroke (or a reload) doesn't silently commit them.
  const positions = state.editing && state.editBackup ? state.editBackup : state.positions;
  saveSession(store, { stage, n, positions, initial, mapping, location, kind, description, contents, lockId, lockLoaded, plan, planIndex, solveStart, blockedProbes, knownLinks, pickMistakes, picksBroken, stepLog });
  syncLock();
}

// Leave the Solve "Edit positions" mode without committing — restore the pre-edit
// positions. Apply is the only path that keeps the edited values.
function discardPendingEdit() {
  if (state.editing && state.editBackup) state.positions = state.editBackup.slice();
  state.editing = false;
  state.editBackup = undefined;
}

// Compose a display name from a holder's location/type/description. Defaults to the session
// lock (state); the saved-lock editor passes its own buffer (state.contentsEdit).
function composeName(src = state) {
  return [(src.location || '').trim(), src.kind, (src.description || '').trim()].filter(Boolean).join(' · ') || 'Unnamed lock';
}

// Another saved lock (not this one) with the same location + type + description. Defaults to
// the session lock; the editor passes its own buffer + the id of the lock being edited.
function findDuplicate(src = state, id = state.lockId) {
  const me = { location: src.location, kind: src.kind, description: src.description };
  return loadLocks(store).find((l) => l.id !== id && sameIdentity(l, me)) || null;
}

function nameWarningHtml() {
  const conflict = state.stage === 'contents'
    ? state.contentsEdit && state.contentsEdit.nameConflict
    : state.nameConflict;
  return conflict
    ? `<div class="note" style="border-left-color:var(--danger);margin-top:8px">A lock “${escapeHtml(
        conflict
      )}” already has the same location, type, and description. Load it from the left, or change the details to save a new one.</div>`
    : '';
}

// In-app saves always bump updatedAt to now, so re-saving moves a lock to the top of
// Recent. Imports use preserve() instead — see below.
const stamp = (lock) => ({ ...lock, updatedAt: Date.now() });
// Imports keep the lock's own updatedAt (its real prior save time), stamping now only
// when it's missing — so an imported lock lands in Recent by when it was actually saved.
const preserve = (lock) => ({ ...lock, updatedAt: lock.updatedAt ?? Date.now() });

// Everything about a lock record except its timestamp, for change detection.
const lockFingerprint = (l) =>
  JSON.stringify([l.name, l.location, l.kind, l.description, l.n, l.initial, l.coupling, l.status, l.contents, l.notes]);

// Once the lock is identifiable (a location or description), keep its saved record current —
// unless it would duplicate an existing lock, in which case refuse and flag a conflict.
function syncLock() {
  if (!(state.location || '').trim() && !(state.description || '').trim()) { state.nameConflict = null; return; }
  const dup = findDuplicate();
  if (dup) { state.nameConflict = dup.name; return; }
  state.nameConflict = null;
  if (!state.lockId) state.lockId = `lock-${Date.now()}`;
  const record = {
    id: state.lockId,
    name: composeName(),
    location: (state.location || '').trim(),
    kind: state.kind,
    description: (state.description || '').trim(),
    n: state.n,
    initial: (state.initial || state.positions).slice(),
    coupling: state.mapping ? state.mapping.coupling : null,
    status: state.mapping ? state.mapping.status : null,
    // Stored clean (blank rows dropped, qty coerced) so the saved record and its exports
    // never carry an in-progress blank row — while state.contents keeps what's on screen.
    contents: sanitizeContents(state.contents),
    notes: '',
  };
  // This runs on every render, so write (and bump updatedAt) only when the
  // record genuinely changed — just viewing or solving a lock must not move
  // it to the top of Recent.
  const prev = getLock(store, state.lockId);
  if (prev && lockFingerprint(prev) === lockFingerprint(record)) return;
  saveLock(store, stamp(record));
}

// ---------- helpers ----------

const plateLabel = (i) => `P${i + 1}`;
const shiftWord = (delta) => (delta > 0 ? 'left' : 'right');
const dirArrow = (dir) => (dir === 'L' ? '◀' : '▶');

// "moves P3 right (2→1) · P5 right (7→6)" — the pressed plate first, coupled
// plates after it with no repeated lead-in.
function describeMove(coupling, positions, plate, dir) {
  const d = moveDelta(coupling, plate, dir);
  const part = (j) => `${plateLabel(j)} ${shiftWord(d[j])} (${positions[j]}→${positions[j] + d[j]})`;
  const parts = [`moves ${part(plate)}`];
  for (let j = 0; j < d.length; j++) {
    if (j !== plate && d[j] !== 0) parts.push(part(j));
  }
  return parts.join(' · ');
}

// Rebuild the with/opposite selections for a plate from stored coupling (relative to the
// plate's own +1 move): +1 => moves with, -1 => moves opposite.
function relFromMapping(plate) {
  const row = state.mapping.coupling[plate];
  const rel = {};
  for (let j = 0; j < row.length; j++) {
    if (j === plate) continue;
    if (row[j] === 1) rel[j] = 'with';
    else if (row[j] === -1) rel[j] = 'opposite';
  }
  return rel;
}

// Presses the player reported as jams are remembered against the exact slide
// positions they failed at (state.blockedProbes, "pos|plate|dir"). This returns
// the ones that apply right now, in the "plate|dir" form recommendNext takes —
// the same press at different positions is a different (untried) press.
function blockedNow() {
  const here = `${state.positions.join(',')}|`;
  const set = new Set();
  for (const k of state.blockedProbes || []) {
    if (k.startsWith(here)) set.add(k.slice(here.length));
  }
  return set;
}

// Soft links — "i|j" pairs the player saw wiggle on one of plate i's jams:
// linked for sure, sign unknown (positions don't matter; a link is a link).
function softLinksSet() {
  return new Set(state.knownLinks || []);
}

// The other slides sitting on an edge at the positions a jam happened at. The
// blocker is always among these; with exactly one, it IS the blocker.
function jamEdgeOthers(jn) {
  const out = [];
  for (let j = 0; j < state.n; j++) {
    if (j !== jn.plate && (jn.positions[j] <= MIN || jn.positions[j] >= MAX)) out.push(j);
  }
  return out;
}

// The exact coupling cell implied by plate j being pushed PAST its edge by the
// jammed press (only valid when j is known to be the blocker).
function blockerCell(jn, j) {
  return (jn.positions[j] >= MAX ? 1 : -1) * (jn.dir === 'L' ? 1 : -1);
}

// Start (or restart) a recording for `plate` against the current positions. The
// press direction defaults toward center, but when the app's suggestion is this
// very plate, its direction wins — after a reported jam the recommender may pick
// the away-from-center press, and the hint/preview must show THAT, not re-show
// the press that just jammed.
function seedRecording(plate) {
  state.recDrafts ??= {};
  // Switching away is non-destructive: stash the current recording if the player has
  // touched it, so a stray tap (or any plate-hop) can be recovered by switching back.
  if (state.recTouched && Number.isInteger(state.activePlate)) {
    state.recDrafts[state.activePlate] = state.rec;
  }
  state.activePlate = plate;
  if (plate == null) {
    state.rec = null;
    state.recTouched = false;
    return;
  }
  // Restore a previously stashed draft for this plate, but only if it's still valid for the
  // current board (restorableDraft enforces the baseline === positions guard).
  const draft = restorableDraft(state.recDrafts, plate, state.positions);
  if (draft) {
    state.rec = draft;
    state.recTouched = true; // a restored draft is, by definition, work in progress
    return;
  }
  // Fresh recording (unchanged from the original behaviour).
  state.rec = createRecording(state.positions, plate, relFromMapping(plate));
  state.recTouched = false;
  if (suggestEnabled()) {
    const rec = recommendNext(state.positions, state.mapping, blockedNow(), softLinksSet());
    if (rec && rec.type === 'probe' && rec.plate === plate) {
      state.rec = setActiveDir(state.rec, rec.dir === 'L' ? 1 : -1);
    }
  }
}

// Default plate to record: the safe-ordered suggestion if any, else first unmapped, else null.
function suggestDefault() {
  const m = state.mapping;
  let next = null;
  for (let i = 0; i < m.n; i++) if (m.status[i] !== 'done') { next = i; break; }
  // With suggestions on, jump to the recommended plate; off, just take the first unmapped.
  if (suggestEnabled()) {
    const rec = recommendNext(state.positions, m, blockedNow(), softLinksSet());
    if (rec && rec.type === 'probe') next = rec.plate;
  }
  seedRecording(next);
}

function saveActivePlate() {
  const rec = state.rec;
  if (!rec) return;
  if (!validRecording(rec)) return; // a successful press can't push a slide off an edge (that's a jam)
  logStep(rec.active, rec.deltaI === 1 ? 'L' : 'R'); // rewindable, like any board-moving step
  state.mapping.coupling[rec.active] = couplingRow(rec);
  state.positions = positionsOf(rec); // commit the live, recorded positions
  state.mapping.status[rec.active] = 'done';
  // The full row is now observed truth — soft links for this plate are superseded.
  state.knownLinks = (state.knownLinks || []).filter((k) => !k.startsWith(`${rec.active}|`));
  // This row is committed truth now — discard its tentative draft, and mark the recording
  // clean so the upcoming re-seed doesn't re-stash the just-saved work.
  state.recTouched = false;
  if (state.recDrafts) delete state.recDrafts[rec.active];
  suggestDefault(); // re-seed the next recording against the new positions
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- changelog modal ----------
// A self-contained overlay on document.body, independent of the app's render cycle
// and state. Dismissable by Esc, a backdrop click, or the close button — every path
// routes through closeChangelog so the keydown listener is always cleaned up.
function changelogHtml() {
  const entries = CHANGELOG.map((e) =>
    `<section class="cl-entry"><h3>${escapeHtml(e.date)}</h3><ul>${
      e.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')
    }</ul></section>`).join('');
  return `<div class="cl-modal" role="dialog" aria-modal="true" aria-labelledby="cl-title">
    <button class="cl-close" data-cl="close" aria-label="Close changelog">✕</button>
    <h2 id="cl-title">Changelog</h2>${entries}</div>`;
}

function onChangelogKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeChangelog(); }
}

function closeChangelog() {
  const ov = document.getElementById('cl-overlay');
  if (ov) ov.remove();
  document.removeEventListener('keydown', onChangelogKey, true);
}

function openChangelog() {
  if (document.getElementById('cl-overlay')) return; // already open
  // Mark the latest changelog as seen and clear the "New" badge immediately.
  if (settings.lastSeenChangelogVersion !== CHANGELOG_VERSION) {
    settings.lastSeenChangelogVersion = CHANGELOG_VERSION;
    saveSettings(store, settings);
    const badge = document.querySelector('.ap-changelog .ap-badge-new');
    if (badge) badge.remove();
  }
  const ov = document.createElement('div');
  ov.id = 'cl-overlay';
  ov.className = 'cl-overlay';
  ov.innerHTML = changelogHtml();
  ov.addEventListener('click', (e) => {
    // Backdrop (the overlay itself) or the close button dismiss; clicks inside don't.
    if (e.target === ov || e.target.closest('[data-cl="close"]')) closeChangelog();
  });
  document.body.appendChild(ov);
  // Capture phase so Esc closes the modal before the app's global key handlers see it.
  document.addEventListener('keydown', onChangelogKey, true);
  const close = ov.querySelector('.cl-close');
  if (close) close.focus();
}

// ---------- render ----------

function render() {
  syncLock(); // keep the saved-locks list current before it is read below
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap';
  const bar = document.createElement('div');
  bar.className = 'ap-bar';
  bar.appendChild(railEl());
  const over = document.createElement('button');
  over.className = 'ap-reset';
  over.dataset.action = 'start-over';
  over.textContent = '⟳ Start over';
  bar.appendChild(over);
  const clog = document.createElement('button');
  clog.className = 'ap-changelog';
  clog.dataset.action = 'open-changelog';
  clog.textContent = 'Changelog';
  if (shouldShowBadge(CHANGELOG_VERSION, settings.lastSeenChangelogVersion)) {
    const badge = document.createElement('span');
    badge.className = 'ap-badge-new';
    badge.textContent = 'New';
    clog.appendChild(badge);
  }
  bar.appendChild(clog);
  wrap.appendChild(bar);

  if ((state.location || '').trim() || (state.description || '').trim()) {
    const title = document.createElement('div');
    title.className = 'ap-locktitle';
    title.textContent = composeName();
    wrap.appendChild(title);
  }

  if (state.stage === 'lock') {
    wrap.appendChild(lockStep());
  } else if (state.stage === 'import') {
    wrap.appendChild(importView());
  } else if (state.stage === 'contents') {
    wrap.appendChild(contentsView());
  } else if (state.stage === 'discovery') {
    wrap.appendChild(mappingView());
  } else {
    const main = document.createElement('div');
    main.className = 'ap-main';
    const boardCol = document.createElement('div');
    boardCol.className = 'ap-board';
    const boardHost = document.createElement('div');
    boardCol.appendChild(boardHost);
    const side = document.createElement('div');
    side.className = 'ap-side';

    let boardProps = { positions: state.positions };
    if (state.stage === 'setup') {
      side.appendChild(setupPanel());
      boardProps = {
        positions: state.positions,
        draggable: true,
        highlightPlate: state.activePlate,
        onSetPosition: onDragPosition,
      };
    } else if (state.stage === 'solve') boardProps = solvePanel(side, boardProps);

    main.appendChild(boardCol);
    main.appendChild(side);
    wrap.appendChild(main);
    createBoard(boardHost, boardProps);
  }

  const footer = document.createElement('div');
  footer.className = 'ap-footer';
  footer.innerHTML = `<label class="ap-kbd">
      <input type="checkbox" data-action="toggle-kbd"${kbdEnabled() ? ' checked' : ''}>
      <span class="ap-kbd-tip" data-tip="Advance:  Enter · Space · ↓ · →&#10;Back:  ↑ · ← · Backspace&#10;Next / prev section:  N · P (collapsed view)&#10;Reset pins:  R&#10;Full plan:  Z">Keyboard shortcuts</span></label>`;
  wrap.appendChild(footer);

  appEl.appendChild(wrap);
  reserveMoveDescHeight();
  alignCycleBraces();
  positionCycleCounts();
  fitPlanList();
  scrollCurrentStepIntoView();
  // One-shot: focus the item textbox of a freshly added contents row.
  if (state.focusContentItem != null) {
    const el = appEl.querySelector(`[data-action="content-item"][data-i="${state.focusContentItem}"]`);
    state.focusContentItem = undefined;
    if (el) el.focus();
  }
  persist();
}

// The "Next move" description varies in length step to step, which would change the
// card height and shift the "Did it" button. Reserve the height of the tallest
// description in the whole plan so the button stays put for the entire solve.
function reserveMoveDescHeight() {
  const sub = appEl.querySelector('.ap-nm-sub');
  if (!sub || !state.plan) return;
  const coupling = state.mapping.coupling;
  const original = sub.textContent;
  let pos = state.solveStart.slice();
  let max = 0;
  for (let i = 0; i < state.plan.length; i++) {
    const mv = state.plan[i];
    sub.textContent = moveSubText(coupling, pos, i);
    if (sub.offsetHeight > max) max = sub.offsetHeight;
    pos = applyMove(pos, coupling, mv.plate, mv.dir);
  }
  sub.textContent = original;
  sub.style.minHeight = `${max}px`;
}

// Align every cycle's closing bracket to one column — the longest step line in
// the whole plan — by widening each rows column to that max content width.
function alignCycleBraces(root = appEl) {
  const list = root.querySelector('.ap-steplist');
  if (!list) return;
  const groups = list.querySelectorAll('.cyc-rows');
  if (!groups.length) return;
  let max = 0;
  for (const tx of list.querySelectorAll('.step-tx')) {
    max = Math.max(max, tx.getBoundingClientRect().width);
  }
  const ROW_PAD = 4; // .cyc-rows > div left+right padding
  groups.forEach((g) => { g.style.width = `${Math.ceil(max) + ROW_PAD}px`; });
}

// Keep each cycle's ×N count on the same line as its highlighted step, so it stays
// visible when the list auto-scrolls within a tall group (a centered count can land
// off-screen). Inactive groups fall back to the CSS-default vertical centering.
//
// In the multi-column full-plan view a cycle can be taller than one column and
// fragment across several (see layoutPlanColumns). Its bounding box then spans the
// whole width, so the count — a flex child anchored to the group — lands beside the
// wrong column. Detect that (group wider than one column pitch) and instead pin the
// count absolutely, just right of the current step's own row, wherever it fragmented to.
function positionCycleCounts(root = appEl) {
  const list = root.querySelector('.ap-steplist');
  if (!list) return;
  const cols = parseInt(list.style.columnCount || '0', 10) || 0;
  const colGap = parseFloat(getComputedStyle(list).columnGap) || 0;
  const colPitch = cols > 1 ? (list.clientWidth + colGap) / cols : Infinity;
  const listRect = list.getBoundingClientRect();
  for (const group of list.querySelectorAll('.cyc-group')) {
    const count = group.querySelector('.cyc-count');
    const cur = group.querySelector('.cur');
    const groupRect = group.getBoundingClientRect();
    const fragmented = cols > 1 && groupRect.width > colPitch + 1;
    if (cur && fragmented) {
      // Take the badge out of the broken-up flex flow and place it next to the live
      // step, in the space the column already reserves for it to the right of the rows.
      // Anchor to the .cyc-rows right edge, not the step's text: rows are flex-start
      // aligned so a shorter current step ends left of the box, but the bracket sits
      // after the box's fixed width — anchoring to the text would collide with it.
      // Then clear the closing bracket (rows → gap → brace → gap → badge): two group
      // gaps plus the brace width, read from layout so it tracks the CSS.
      const curRect = cur.getBoundingClientRect();
      const rows = cur.closest('.cyc-rows');
      const rowsRight = curRect.left + (rows ? parseFloat(rows.style.width) || curRect.width : curRect.width);
      const gcs = getComputedStyle(group);
      const brace = group.querySelector('.cyc-brace.right');
      const clearance = 2 * (parseFloat(gcs.columnGap) || 0) +
        (brace ? parseFloat(getComputedStyle(brace).width) || 0 : 0);
      count.style.position = 'absolute';
      count.style.alignSelf = '';
      count.style.marginTop = '';
      count.style.left = `${rowsRight - listRect.left + list.scrollLeft + clearance}px`;
      count.style.top = `${curRect.top - listRect.top + list.scrollTop}px`;
    } else if (cur) {
      count.style.position = '';
      count.style.left = '';
      count.style.top = '';
      count.style.alignSelf = 'flex-start';
      count.style.marginTop = `${cur.getBoundingClientRect().top - groupRect.top}px`;
    } else {
      count.style.position = '';
      count.style.left = '';
      count.style.top = '';
      count.style.alignSelf = '';
      count.style.marginTop = '';
    }
  }
}

// Lay the full-plan list into multiple columns when it's too tall to fit the modal
// in one column but the viewport is wide enough to hold more. We measure the plan's
// natural one-column height against the height the modal grants the list, pick the
// fewest columns that bring each back within that height (see planColumnCount), then
// size the list and let the modal shrink-wrap to the columns actually used. Always
// resets to one column first so each call re-measures from the natural layout.
function layoutPlanColumns(root) {
  const modal = root.querySelector('.pm-modal');
  const list = root.querySelector('.pm-steplist');
  if (!modal || !list) return;
  list.style.columnCount = '';
  list.style.columnGap = '';
  list.style.width = '';
  list.style.height = '';
  modal.style.width = '';
  modal.style.maxWidth = '';

  const availHeight = list.clientHeight; // height the modal grants the list (capped at 84vh)
  const naturalHeight = list.scrollHeight; // full one-column content height
  // Widest line, measured intrinsically. Step rows wrap by default, so max-content
  // alone would report the widest word — pin white-space to nowrap while measuring so
  // we get the full single-line row width that each column must actually hold.
  list.style.whiteSpace = 'nowrap';
  list.style.width = 'max-content';
  const colWidth = Math.ceil(list.getBoundingClientRect().width);
  list.style.width = '';
  list.style.whiteSpace = '';

  const GAP = 32;
  const cols = planColumnCount({
    naturalHeight,
    availHeight,
    colWidth,
    availWidth: root.clientWidth * 0.92, // leave a little breathing room at the edges
    gap: GAP,
  });
  if (cols <= 1) return;
  list.style.columnCount = String(cols);
  list.style.columnGap = `${GAP}px`;
  list.style.width = `${cols * colWidth + (cols - 1) * GAP}px`;
  // column-fill: auto only breaks columns at a *definite* height; the list's
  // flex-derived height doesn't qualify, so pin it explicitly to the height the
  // modal granted. Each column then fills to availHeight before the next begins.
  list.style.height = `${availHeight}px`;
  modal.style.width = 'max-content'; // shrink-wrap the modal to the columns in use
  modal.style.maxWidth = '92vw';
}

// Grow the plan list to fill the leftover viewport height so the page itself
// doesn't scroll unless the layout genuinely can't fit. Collapse the list, measure
// how much vertical slack remains, then hand that slack back to the list (with a
// floor so very short windows stay usable — there the page scrolls, as it must).
function fitPlanList() {
  const main = appEl.querySelector('.ap-main');
  const side = appEl.querySelector('.ap-side');
  const footer = appEl.querySelector('.ap-footer');
  const list = appEl.querySelector('.ap-steplist');
  if (!main || !side || !footer || !list) return;

  list.style.maxHeight = '0px'; // collapse, then measure everything around it
  // The tallest column sets the page height; the side column should grow (via the
  // list) until the page bottom meets the viewport. Body has min-height:100vh, so
  // measure real element rects rather than scrollHeight.
  const vp = window.innerHeight;
  const mainTop = main.getBoundingClientRect().top;
  const footerSpan = footer.getBoundingClientRect().bottom - main.getBoundingClientRect().bottom; // footer + its margin
  const sideBase = side.getBoundingClientRect().height; // side height with the list collapsed
  const maxMain = vp - mainTop - footerSpan - 1; // tallest the columns can be and still fit
  // Grow the list so the side column reaches maxMain. Clamp to a small floor; when
  // the window is too short to fit even that, a page scrollbar is unavoidable.
  let h = Math.max(64, maxMain - sideBase);
  list.style.maxHeight = `${h}px`;

  // Self-correct any residual overflow the rect math missed (sub-pixel rounding,
  // a fractionally taller board column): if the page still overflows, trim the
  // list by exactly that much. min-height:100vh keeps scrollHeight == innerHeight
  // when content fits, so this only fires on genuine overflow.
  const overflow = document.documentElement.scrollHeight - window.innerHeight;
  if (overflow > 0 && h - overflow >= 64) {
    list.style.maxHeight = `${h - overflow}px`;
  }
}

// Keep the current plan step one line down from the top of the steplist, so the
// previous step stays visible for context (the whole app re-renders each action,
// which would otherwise snap the list back to the top).
function scrollCurrentStepIntoView(root = appEl) {
  const list = root.querySelector('.ap-steplist');
  if (!list) return;
  const cur = list.querySelector('.cur');
  if (cur) {
    // Measure cur's position relative to the list via bounding rects so this is
    // correct regardless of intervening positioned wrappers (e.g. .cyc-group).
    const top = cur.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTop = top - cur.offsetHeight; // keep one line of context above; clamps at 0
  } else {
    list.scrollTop = list.scrollHeight; // plan complete — show the tail
  }
}

function railEl() {
  const rail = document.createElement('div');
  rail.className = 'ap-rail';
  const stages = [['lock', 'Lock'], ['setup', 'Setup'], ['discovery', 'Map the lock'], ['solve', 'Solve']];
  const order = { lock: 0, setup: 1, discovery: 2, solve: 3 };
  const navigable = { lock: false, setup: true, discovery: !!state.mapping, solve: !!state.mapping };
  for (const [key, label] of stages) {
    const span = document.createElement('span');
    span.textContent = (order[state.stage] > order[key] ? '✓ ' : '') + label;
    if (state.stage === key) span.className = 'active';
    else if (order[state.stage] > order[key]) span.className = 'done';
    if (key !== state.stage && navigable[key]) {
      span.classList.add('nav');
      span.dataset.action = 'goto-stage';
      span.dataset.stage = key;
    }
    rail.appendChild(span);
  }
  return rail;
}

// ---------- Setup ----------

// Mapping-stage board interaction. board.js distinguishes a tap (no drag) from a drag:
//  - tap any plate          -> onMapClick selects it to record (the big, obvious target).
//  - drag the active plate  -> sets its one-slot press direction.
//  - drag another plate     -> tags it with/opposite, live-linked to the rel buttons.
// Every press moves at most one slot (the recording helpers clamp), and positions stay
// tentative in state.rec until Save commits them — the board can't silently drift.
function onMapClick(i) {
  if (state.activePlate === i) return; // already recording this plate; keep its tags
  seedRecording(i);
  render();
}
function onMapDrag(i, pos) {
  const rec = state.rec;
  if (!rec) return;
  state.rec = i === rec.active ? dragActive(rec, pos) : dragOther(rec, i, pos);
  state.recTouched = true; // a real drag/tag => start previewing even with suggestions off
  render();
}

// Positions are set by dragging slides on the board (or 1–7 keys) — see onDragPosition and
// the keydown handler. Active in the Setup stage and the Solve stage's "Edit positions"
// mode; the board is non-draggable everywhere else.
function onDragPosition(i, pos) {
  state.positions[i] = pos;
  state.activePlate = i;
  render();
}

// True while the board is in a position-editing context (Setup, or the Edit
// mode of Solve and Map the lock).
function isPositionEditing() {
  return state.stage === 'setup' || ((state.stage === 'solve' || state.stage === 'discovery') && state.editing);
}

// Keyboard pin entry shared by both editing contexts: 1–7 sets the active plate's pin and
// advances the cursor P1→Pn; ↑/↓ move the cursor (↑ = higher plate number). Returns true
// if the key was handled.
function handlePositionKey(key) {
  const i = state.activePlate ?? 0;
  if (key >= '1' && key <= '7') {
    state.positions[i] = +key;
    state.activePlate = nextActivePlate(i, state.n);
    return true;
  }
  if (key === 'ArrowUp') { state.activePlate = Math.min(i + 1, state.n - 1); return true; }
  if (key === 'ArrowDown') { state.activePlate = Math.max(i - 1, 0); return true; }
  return false;
}

// The location/type/description fields, reused on the Lock step and the saved-lock editor.
// Reads from activeName() so the same widget drives whichever holder the current screen edits.
function namingWidgetHtml() {
  const nm = activeName();
  return `
    <div class="muted" style="margin-bottom:4px">General location</div>
    <div class="fill-row">
      ${['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp']
        .map((loc) => `<button class="ap-btn loc-fill${nm.location === loc ? ' primary' : ''}" data-action="loc-fill" data-loc="${loc}">${loc}</button>`)
        .join('')}
    </div>
    <input class="lock-name-input" type="text" data-action="loc-input" placeholder="General location…" value="${escapeHtml(nm.location || '')}" />
    <div class="muted" style="margin:10px 0 4px">Type</div>
    <div class="kind-row">
      ${['Chest', 'Door', 'Other']
        .map((k) => `<label class="kind-opt" data-action="kind-set" data-kind="${k}"><input type="radio" name="kind" ${nm.kind === k ? 'checked' : ''}/> ${k}</label>`)
        .join('')}
    </div>
    <div class="muted" style="margin:10px 0 4px">Description (optional)</div>
    <input class="lock-name-input" type="text" data-action="desc-input" placeholder="e.g. behind the throne" value="${escapeHtml(nm.description || '')}" />
    <div id="name-warning">${nameWarningHtml()}</div>`;
}

// The contents (loot) list is edited in two places — the Solve "Lock open!" screen
// (state.contents) and a saved lock's dedicated editor (state.contentsEdit.items). This
// returns whichever array the current screen is editing so the row handlers stay shared.
function activeContents() {
  return state.stage === 'contents' ? state.contentsEdit.items : state.contents;
}

// The name fields (location/kind/description) live on the session lock (state) when creating,
// and on the editor's buffer (state.contentsEdit) when editing a saved lock. Both holders carry
// the same three keys so the naming widget and its handlers stay shared across screens.
function activeName() {
  return state.stage === 'contents' ? state.contentsEdit : state;
}

// Write the edited name back to its saved lock record, recomputing the display name and refusing
// a change that would duplicate another lock's identity — mirroring syncLock for the session lock.
function persistName() {
  if (state.stage !== 'contents') { persist(); return; } // session lock: syncLock handles it
  const ed = state.contentsEdit;
  const base = getLock(store, ed.id);
  if (!base) return;
  // An empty identity (no location and no description) can't name a lock — keep the prior record,
  // same as the creation flow, rather than saving an "Unnamed lock".
  if (!(ed.location || '').trim() && !(ed.description || '').trim()) { ed.nameConflict = null; return; }
  const dup = findDuplicate(ed, ed.id);
  ed.nameConflict = dup ? dup.name : null;
  if (dup) return;
  saveLock(store, stamp({
    ...base,
    location: (ed.location || '').trim(),
    kind: ed.kind,
    description: (ed.description || '').trim(),
    name: composeName(ed),
  }));
  // If the edited lock is also the one loaded in the session, keep state in sync so going back
  // doesn't show stale name fields in the working column.
  if (state.lockId === ed.id) {
    state.location = ed.location;
    state.kind = ed.kind;
    state.description = ed.description;
  }
}

// Write the edited contents back to its lock record, cleaned. The on-screen buffer keeps
// any blank/in-progress row (the UI renders from it), but the stored record never does.
function persistContents() {
  if (state.stage === 'contents') {
    const base = getLock(store, state.contentsEdit.id);
    if (base) saveLock(store, stamp({ ...base, contents: sanitizeContents(state.contentsEdit.items) }));
  } else {
    persist(); // syncLock writes sanitizeContents(state.contents) to the session lock
  }
}

// The item/quantity row editor, shared by the success screen and the saved-lock editor.
function contentsEditorHtml(items) {
  const rows = (items || [])
    .map((c, i) => {
      const qty = Number.isFinite(c.qty) && c.qty >= 1 ? Math.floor(c.qty) : 1;
      return `<div class="ct-row">
        <input class="ct-item" type="text" data-action="content-item" data-i="${i}" placeholder="Item…" value="${escapeHtml(c.item || '')}" />
        <input class="ct-qty" type="number" min="1" step="1" inputmode="numeric" data-action="content-qty" data-i="${i}" value="${qty}" />
        <button class="ct-del" data-action="content-del" data-i="${i}" title="Remove item" aria-label="Remove item">✕</button>
      </div>`;
    })
    .join('');
  return `<div class="contents-editor">${rows}<button class="ap-btn ct-add" data-action="content-add">＋ Add item</button></div>`;
}

// A compact "2× Gold · 1× Sword" line for a saved lock; '' when it has no recorded loot.
function contentsSummary(l) {
  const items = (Array.isArray(l.contents) ? l.contents : []).filter((c) => c && String(c.item || '').trim());
  if (!items.length) return '';
  return items.map((c) => `${c.qty}× ${escapeHtml(String(c.item).trim())}`).join(' · ');
}

// The dedicated editor for a saved lock, reached by the ✎ icon in its row. Edits both the
// name (location/type/description) and the contents (loot) of the saved record.
function contentsView() {
  const ed = state.contentsEdit;
  const col = document.createElement('div');
  col.className = 'lock-col import-col';
  const card = document.createElement('div');
  card.className = 'ap-card';
  card.innerHTML = `<div class="ap-h">Edit lock</div>
    ${namingWidgetHtml()}
    <div class="muted" style="margin:16px 0 4px">Contents</div>
    ${contentsEditorHtml(ed.items)}
    <div style="margin-top:14px"><span class="ap-btn primary" data-action="contents-done">‹ Back to locks</span></div>`;
  col.appendChild(card);
  return col;
}

// First step: EITHER load a saved lock (left) OR start a new one (right).
function lockStep() {
  const holder = document.createElement('div');
  const intro = document.createElement('div');
  intro.className = 'lock-intro';
  intro.textContent = 'Either load a saved lock, or start a new one.';
  holder.appendChild(intro);

  const main = document.createElement('div');
  main.className = 'ap-main';

  const allLocks = loadLocks(store);
  const locks = allLocks.filter((l) => l.id !== state.lockId);
  const left = document.createElement('div');
  left.className = 'lock-col';
  left.innerHTML = `<div class="ap-card">
    <div class="ap-h">Load a saved lock</div>
    ${locks.length
      ? lockSectionsHtml(locks)
      : '<div class="muted">No saved locks yet — start a new one on the right →</div>'}
    <div class="lock-io">
      ${allLocks.length ? '<span class="ap-btn" data-action="export-all">⬆ Export all</span>' : ''}
      <span class="ap-btn" data-action="import-open">⬇ Import</span>
    </div>
  </div>`;

  const right = document.createElement('div');
  right.className = 'lock-col';
  right.innerHTML = `<div class="ap-card">
    <div class="ap-h">Or start a new lock</div>
    ${namingWidgetHtml()}
    <div class="muted" style="margin-top:6px">Naming is optional — you can fill this in later. It auto-saves.</div>
    <div style="margin-top:12px"><span class="ap-btn primary" data-action="new-setup">Continue to setup ›</span></div>
  </div>`;

  main.appendChild(left);
  main.appendChild(right);
  holder.appendChild(main);
  return holder;
}

const RECENT_KEY = '__recent__';

// Is a section open? Recent defaults open, every folder defaults closed; only explicit
// user overrides are stored in settings.lockFolders.
function sectionOpen(key) {
  const overrides = settings.lockFolders || {};
  if (key in overrides) return overrides[key];
  return key === RECENT_KEY;
}

// One collapsible section: clickable header (caret + label + count) and, when open, the
// stack of lock rows. Reuses lockRowHtml unchanged.
function lockSectionHtml(key, label, locks) {
  const open = sectionOpen(key);
  const caret = open ? '▼' : '▸';
  const body = open ? `<div class="lock-list">${locks.map(lockRowHtml).join('')}</div>` : '';
  return `<div class="lock-folder">
    <div class="lock-folder-h" data-action="toggle-folder" data-folder="${escapeHtml(key)}">
      <span class="lf-caret">${caret}</span>
      <span class="lf-label">${escapeHtml(label)}</span>
      <span class="lf-count">${locks.length}</span>
    </div>
    ${body}
  </div>`;
}

// The full sectioned list: Recent (when non-empty) followed by one section per folder.
function lockSectionsHtml(locks) {
  const { recent, folders } = groupLocks(locks);
  const parts = [];
  if (recent.length) parts.push(lockSectionHtml(RECENT_KEY, 'Recent', recent));
  for (const f of folders) parts.push(lockSectionHtml(f.key, f.label, f.locks));
  return parts.join('');
}

// One saved-lock row: load (name) · share · delete, with an inline share-code panel
// when this lock's Share action is open (state.shareId).
function lockRowHtml(l) {
  const panel =
    state.shareId === l.id
      ? `<div class="share-panel">
          <div class="muted" style="margin-bottom:4px">Copy this code and send it — paste it into Import on another device.</div>
          <textarea class="share-code" readonly rows="3">${escapeHtml(encodeShare(l, isoNow()))}</textarea>
          <div style="margin-top:6px"><span class="ap-btn" data-action="copy-share">Copy</span>
            <span class="ap-btn" data-action="close-share">Close</span>
            <span class="share-copied muted"></span></div>
        </div>`
      : '';
  const summary = contentsSummary(l);
  return `<div class="lock-row">
    <div class="lock-item">
      <span data-action="load-lock" data-id="${l.id}" style="cursor:pointer">${escapeHtml(l.name)} <span class="muted">(${l.n} plates)</span></span>
      <span class="lock-acts">
        <span class="io" data-action="edit-contents" data-id="${l.id}" title="Edit contents">✎</span>
        <span class="io" data-action="share-lock" data-id="${l.id}" title="Share this lock">⇪</span>
        <span class="x" data-action="del-lock" data-id="${l.id}">✕</span>
      </span>
    </div>
    ${summary ? `<div class="lock-contents muted">${summary}</div>` : ''}
    ${panel}
  </div>`;
}

// ---------- Import ----------

const isoNow = () => new Date().toISOString();

// The current lock as a shareable code (saved or not — unnamed locks share
// fine, they just arrive as "Unnamed lock"). Same envelope as Export/Share.
function buildShareCode() {
  return encodeShare(
    {
      id: state.lockId || `lock-${Date.now()}`,
      name: composeName(),
      location: (state.location || '').trim(),
      kind: state.kind,
      description: (state.description || '').trim(),
      n: state.n,
      initial: (state.initial || state.positions).slice(),
      coupling: state.mapping ? state.mapping.coupling : null,
      status: state.mapping ? state.mapping.status : null,
      contents: sanitizeContents(state.contents),
      notes: '',
    },
    isoNow()
  );
}

// The success screen's share code must track name/contents typing, which
// deliberately doesn't re-render (it would steal focus).
function refreshLiveShare() {
  const ta = appEl.querySelector('.share-code[data-live-share]');
  if (ta) ta.value = buildShareCode();
}

// Short status word for a lock record, for the conflict review's side-by-side view.
function lockStatusWord(l) {
  if (!l.coupling) return 'not mapped';
  const st = l.status || [];
  return st.length && st.every((s) => s === 'done') ? 'mapped' : 'in progress';
}

function lockSummaryHtml(l) {
  const loc = (l.location || '').trim();
  const desc = (l.description || '').trim();
  const sub = [loc, l.kind || 'Chest', desc].filter(Boolean).join(' · ');
  const summary = contentsSummary(l);
  return `<div class="cf-name">${escapeHtml(l.name || 'Unnamed lock')}</div>
    <div class="muted">${escapeHtml(sub)}</div>
    <div class="muted">${l.n} plates · ${lockStatusWord(l)}</div>
    ${summary ? `<div class="muted">Contents: ${summary}</div>` : ''}`;
}

// The import screen: a paste/file input, then a results summary with a per-conflict
// review list. All transient state lives on state.import.
function importView() {
  const imp = state.import || (state.import = { phase: 'input' });
  const col = document.createElement('div');
  col.className = 'lock-col import-col';

  if (imp.phase === 'input') {
    const card = document.createElement('div');
    card.className = 'ap-card';
    card.innerHTML = `<div class="ap-h">Import locks</div>
      <div class="muted" style="margin-bottom:8px">Load a backup file (all locks) or paste a share code (one lock).</div>
      <div style="margin:6px 0"><input type="file" accept=".json,application/json" data-action="import-file" /></div>
      ${imp.fileName ? `<div class="muted">Selected: ${escapeHtml(imp.fileName)}</div>` : ''}
      <div class="muted" style="margin:10px 0 4px">…or paste a share code / exported JSON:</div>
      <textarea class="share-code" data-action="import-text" rows="4" placeholder="Paste here…">${escapeHtml(imp.text || '')}</textarea>
      ${imp.error ? `<div class="note" style="border-left-color:var(--danger);margin-top:8px">${escapeHtml(imp.error)}</div>` : ''}
      <div style="margin-top:12px">
        <span class="ap-btn primary" data-action="import-parse">Review ›</span>
        <span class="ap-btn" data-action="import-cancel">Cancel</span>
      </div>`;
    col.appendChild(card);
    return col;
  }

  // results phase
  const { newCount, identicalCount, invalidCount, conflicts, choices, done } = imp;
  const parts = [];
  if (newCount) parts.push(`${newCount} new imported`);
  if (identicalCount) parts.push(`${identicalCount} already present`);
  if (invalidCount) parts.push(`${invalidCount} invalid skipped`);
  if (conflicts.length) parts.push(done ? `${conflicts.length} reviewed` : `${conflicts.length} to review`);

  const card = document.createElement('div');
  card.className = 'ap-card';
  let body = `<div class="ap-h">Import ${done ? 'complete' : 'results'}</div>
    <div class="muted" style="margin-bottom:8px">${parts.join(' · ') || 'Nothing to import.'}</div>`;

  if (conflicts.length && !done) {
    body += `<div class="muted" style="margin-bottom:8px">These match a lock you already have. Choose what to do with each, then Apply.</div>`;
    body += conflicts
      .map((c, i) => {
        const ch = choices[i];
        return `<div class="cf-row">
          <div class="cf-side"><div class="cf-tag">You have</div>${lockSummaryHtml(c.existing)}</div>
          <div class="cf-side"><div class="cf-tag">Incoming</div>${lockSummaryHtml(c.incoming)}</div>
          <div class="cf-choice">
            <span class="seg-opt ${ch === 'copy' ? 'on' : ''}" data-action="cf-choice" data-i="${i}" data-choice="copy">Add as copy</span>
            <span class="seg-opt ${ch === 'skip' ? 'on' : ''}" data-action="cf-choice" data-i="${i}" data-choice="skip">Skip</span>
          </div>
        </div>`;
      })
      .join('');
    body += `<div style="margin-top:12px">
      <span class="ap-btn primary" data-action="import-apply">Apply ›</span>
      <span class="ap-btn" data-action="import-cancel">Cancel</span>
    </div>`;
  } else {
    body += `<div style="margin-top:12px"><span class="ap-btn primary" data-action="import-done">‹ Back to locks</span></div>`;
  }

  card.innerHTML = body;
  col.appendChild(card);
  return col;
}

// Read pasted text / loaded file, validate, auto-import the fresh locks, and set up the
// conflict review. Stays on the input phase with an error if the input is unreadable.
function runImportParse() {
  const imp = state.import;
  const text = (imp.fileText || imp.text || '').trim();
  if (!text) { imp.error = 'Paste a share code or choose a file first.'; return; }
  const parsed = parseImport(text);
  if (!parsed) { imp.error = "That doesn't look like a g1r lock export."; return; }
  const existing = loadLocks(store);
  const { fresh, identical, conflicts } = classifyImport(parsed.locks, existing);
  let newCount = 0;
  for (const l of fresh) { saveLock(store, preserve(l)); newCount++; }
  state.import = {
    phase: 'results',
    newCount,
    identicalCount: identical.length,
    invalidCount: parsed.invalidCount,
    conflicts,
    choices: conflicts.map(() => 'skip'),
    done: conflicts.length === 0,
  };
}

// Commit the reviewer's choices: each "copy" conflict is saved under a fresh id so
// nothing existing is overwritten.
function runImportApply() {
  const imp = state.import;
  let added = 0;
  imp.conflicts.forEach((c, i) => {
    if (imp.choices[i] === 'copy') {
      saveLock(store, preserve({ ...c.incoming, id: `lock-${Date.now()}-${i}` }));
      added++;
    }
  });
  imp.newCount += added;
  imp.done = true;
}

// Copy the open share panel's code to the clipboard, with a textarea-select fallback
// for browsers without the async clipboard API. Shows a brief "Copied" note.
function copyShareCode(btn) {
  const panel = btn.closest('.share-panel');
  const ta = panel && panel.querySelector('.share-code');
  if (!ta) return;
  const note = panel.querySelector('.share-copied');
  const flash = (msg) => { if (note) note.textContent = msg; };
  const text = ta.value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flash('Copied ✓'), () => flash('Press ⌘/Ctrl+C'));
  } else {
    ta.select();
    try { document.execCommand('copy'); flash('Copied ✓'); } catch { flash('Press ⌘/Ctrl+C'); }
  }
}

// Trigger a download of all saved locks as a JSON backup file.
function exportAllLocks() {
  const locks = loadLocks(store);
  if (!locks.length) return;
  const blob = new Blob([exportLocks(locks, isoNow())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `g1r-locks-${isoNow().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setupPanel() {
  const card = document.createElement('div');
  card.className = 'ap-card';
  const primary = state.lockLoaded
    ? `<span class="ap-btn primary" data-action="goto-solve">Solve ›</span>`
    : `<span class="ap-btn primary" data-action="start-mapping">Start mapping ›</span>`;
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
  return card;
}

// ---------- Mapping (unified into the board) ----------

// The post-jam note: what the jam cost, plus optional wiggle capture. On a jam
// the game wiggles every linked plate (not just the blockers), so a tap on ANY
// slide records a link to the jammed plate — exact only when the tapped slide
// is provably the blocker (sole edge slide), otherwise sign-unknown. Reports
// are trusted but never assumed complete — untapped plates teach nothing. One
// thing IS certain: at least one wiggler sits on an edge (the blocker), which
// powers the auto-inference and the "you missed one" nudge below.
function jamNoticeHtml(jn) {
  const lead = jn.broke
    ? `Second mistake — the pick broke and the slides snapped back to the start. Board reset to match; mapping kept.`
    : `Noted: <b>${plateLabel(jn.plate)}</b> <span class="dir">${dirArrow(jn.dir)} ${DIR_WORD[jn.dir]}</span> jams here —
       it won't be suggested again. One more jam breaks the pick.`;
  const links = state.knownLinks || [];
  const edgeOthers = jamEdgeOthers(jn);
  let edgeTapped = false;
  let anyTapped = false;
  for (let j = 0; j < state.n; j++) {
    if (j === jn.plate) continue;
    const onEdge = jn.positions[j] <= MIN || jn.positions[j] >= MAX;
    const on = state.mapping.coupling[jn.plate][j] !== 0 || links.includes(`${jn.plate}|${j}`);
    if (on) anyTapped = true;
    if (on && onEdge) edgeTapped = true;
  }
  const auto = jn.autoLearned != null
    ? ` <b>${plateLabel(jn.autoLearned)}</b> is the only slide on an edge, so it must be the blocker — link recorded ✓.`
    : '';
  // The blocker always wiggles and always sits on an edge: taps that include no
  // edge slide are provably missing one.
  const missed = anyTapped && !edgeTapped && edgeOthers.length > 1
    ? `<div class="muted" style="margin-top:4px">⚠ The blocking slide always sits on an edge — you missed one of
        ${edgeOthers.map(plateLabel).join(', ')}.</div>`
    : '';
  return `<div class="note" style="margin-top:6px">${lead}${auto}${missed}</div>`;
}

// The drift diagnosis, shown after an Edit positions that contradicted what the
// executed moves predicted — in Solve (plan moves) and in mapping (journaled
// repositioning moves) alike. Names the drifted slides and the rows that could
// explain them, with one-tap review.
function driftNoteEl() {
  const rep = state.driftReport;
  const where = rep.drifted.map(plateLabel).join(', ');
  const top = rep.suspects.slice(0, 2);
  const note = document.createElement('div');
  note.innerHTML = `<div class="note" style="margin:0 0 10px">The lock isn't where the mapping predicted — off on <b>${where}</b>.${
    top.length
      ? ` Most likely mis-recorded: ${top.map((sp) => `<b>${plateLabel(sp.plate)}</b>`).join(', then ')}.`
      : ' None of the executed moves can explain it alone — re-check the rows you trust least, and that no move was missed or doubled.'
  }<div style="margin-top:6px">${
    top.length
      ? top.map((sp) => `<span class="ap-btn" data-action="drift-review" data-plate="${sp.plate}">Review ${plateLabel(sp.plate)} ›</span>`).join(' ')
      : ''
  }</div></div>`;
  return note.firstElementChild;
}

function mappingView() {
  const m = state.mapping;
  if (state.activePlate === undefined) suggestDefault();

  // ---- "Lock doesn't match?" rewind mode: walk the player backwards through
  // their own logged moves until lock and board agree again. Each shown step
  // asks for ONE physical undo and one visual comparison. ----
  if (state.walkback) {
    const col = document.createElement('div');
    col.className = 'map-wrap';
    const log = state.stepLog || [];
    const u = state.walkback.undone;
    const card = document.createElement('div');
    card.className = 'ap-card';
    if (u >= log.length) {
      card.innerHTML = `<div class="ap-h">Find the bad step · nothing left to rewind</div>
        <div style="font-size:14px;color:#fff;margin-top:6px">Every logged move is undone and the lock still doesn't match —
          the divergence is older than these steps.</div>
        <div class="muted" style="margin-top:4px">Set the board to match the lock by hand, then re-check the rows you trust least.</div>
        <div style="margin-top:12px"><span class="ap-btn primary" data-action="walkback-hand">Fix by hand ›</span></div>`;
      col.appendChild(card);
      const host = document.createElement('div');
      col.appendChild(host);
      createBoard(host, { positions: log.length ? log[0].before : state.positions });
      return col;
    }
    const step = log[log.length - 1 - u];
    const undoDir = step.dir === 'L' ? 'R' : 'L';
    card.innerHTML = `<div class="ap-h">Find the bad step · rewinding ${u + 1} of ${log.length}</div>
      <div style="font-size:14px;color:#fff;margin-top:6px">Undo your ${plateLabel(step.plate)} ${DIR_WORD[step.dir]}:
        slide <b style="color:var(--gold)">${plateLabel(step.plate)}</b>
        <span class="dir">${dirArrow(undoDir)} ${DIR_WORD[undoDir]}</span> in the lock.</div>
      <div class="muted" style="margin-top:4px">The board below shows where everything should be after that undo. Does the lock match it now?</div>
      <div style="margin-top:12px">
        <span class="ap-btn primary" data-action="walkback-match">It matches now ✓</span>
        <span class="ap-btn" data-action="walkback-more">Still different — rewind more</span>
        <span class="linklike" data-action="walkback-hand" style="margin-left:8px">fix by hand instead…</span>
      </div>`;
    col.appendChild(card);
    const host = document.createElement('div');
    col.appendChild(host);
    createBoard(host, { positions: step.before, highlightPlate: step.plate });
    return col;
  }

  // ---- Hand-fix fallback: a plain position editor (same gestures as Setup). ----
  if (state.editing) {
    const col = document.createElement('div');
    col.className = 'map-wrap';
    const card = document.createElement('div');
    card.className = 'ap-card';
    card.innerHTML = `<div class="ap-h">Fix the board by hand</div>
      <div style="font-size:14px;color:#fff;margin-top:6px">Drag each slide to where the lock <i>really</i> is
        (or press <b>1</b>–<b>7</b>), then Apply.</div>
      <div style="margin-top:12px">
        <span class="ap-btn primary" data-action="apply-edit">Apply ›</span>
        <span class="ap-btn" data-action="cancel-edit">Cancel</span>
      </div>`;
    col.appendChild(card);
    const host = document.createElement('div');
    col.appendChild(host);
    createBoard(host, {
      positions: state.positions,
      draggable: true,
      highlightPlate: state.activePlate,
      onSetPosition: onDragPosition,
    });
    return col;
  }

  const active = state.activePlate;
  const mapped = m.status.filter((s) => s === 'done').length;
  const suggestion = allMapped(m) ? null : recommendNext(state.positions, m, blockedNow(), softLinksSet());

  const col = document.createElement('div');
  col.className = 'map-wrap';

  const isActive = active != null;
  const done = allMapped(m);
  // Jam mode: right after "It jammed", the rows' tag column becomes the
  // wiggled? column until the player taps Done (or does anything else).
  const jamMode = !!state.jamNotice && !done;
  // Reviewing: the selected plate is already mapped — the player is most
  // likely just checking its links, not re-recording (yet).
  const reviewing = isActive && m.status[active] === 'done';
  // Plan mode: the recommender wants known moves done first (to free edges or
  // change the layout). Like jam mode it owns the instruction line — one ask at
  // a time. A Skip is remembered against the current positions, so it stays
  // dismissed until the board changes.
  const planPending =
    !jamMode && suggestEnabled() && suggestion && suggestion.type === 'plan' &&
    state.skipPlanKey !== state.positions.join(',');

  // Board data derived from the in-progress recording: the solid slide sits at the
  // tentative landing (positionsOf), a faint ghost marks each moved plate's start, and
  // moved plates get a "start → landing" label — so a previewed move never looks
  // committed. With "Suggest moves" off we don't preview the suggested move on entry:
  // the board shows the real positions until you actually record a move (recTouched).
  // In jam mode nothing moved — show the committed positions, no preview.
  // Reviewing a mapped plate also starts with NO preview: its pre-filled tags
  // would otherwise simulate a move from the current positions, which can be
  // out of bounds here (slides drawn past the edges). The preview begins only
  // once the player actually edits (drags or re-tags). While a plan is pending
  // there's no preview either — repositioning comes before the next recording.
  const previewing = !jamMode && !planPending && !!state.rec &&
    (reviewing ? state.recTouched : suggestEnabled() || state.recTouched);
  const boardPositions = previewing ? positionsOf(state.rec) : state.positions;
  const ghosts = previewing
    ? boardPositions.map((p, i) => (p !== state.rec.baseline[i] ? state.rec.baseline[i] : null))
    : null;
  const hasGhost = !!ghosts && ghosts.some((g) => g != null);
  const activeDir = isActive && state.rec ? (state.rec.deltaI === 1 ? 'L' : 'R') : null;

  const head = document.createElement('div');
  head.className = 'ap-card';
  const suggestHtml =
    !jamMode && suggestEnabled() && suggestion && suggestion.type === 'probe' && suggestion.plate !== active
      ? `<div class="muted" style="margin-top:6px">Suggested: <b style="color:var(--gold)">${plateLabel(
          suggestion.plate
        )}</b> ${suggestion.safe ? '✓ safe' : '⚠ may jam'}
        <span class="ap-btn" data-action="select-plate" data-plate="${suggestion.plate}" style="margin-left:6px">Select ›</span></div>`
      : '';
  // One status line: edge situation, plus pick damage when there is any to
  // report (a fresh pick with no breaks says nothing).
  const pickBits = [];
  if (state.pickMistakes) pickBits.push('<span style="color:var(--danger)">pick: ⚠ 1 mistake — the next jam breaks it</span>');
  if (state.picksBroken) pickBits.push(`picks broken: ${state.picksBroken}`);
  const statusHtml = done
    ? ''
    : `<div class="coach muted" style="margin-top:6px">${coachingMessage(state.positions)}${
        pickBits.length ? ' · ' + pickBits.join(' · ') : ''
      }</div>`;
  // Acknowledgement after "It jammed": confirms the press is remembered, reports
  // what it cost the pick, and offers the optional wiggle capture. Cleared on
  // the next click that isn't part of the jam flow.
  const jamHtml = state.jamNotice ? jamNoticeHtml(state.jamNotice) : '';
  // One-shot result of a "Lock doesn't match?" rewind: the culprit, synced.
  const walkbackHtml = state.walkbackNote
    ? `<div class="note" style="margin-top:6px">Found it — the divergence began with a <b>${plateLabel(state.walkbackNote.plate)}</b>
        move, so its recording is wrong. Board and lock are back in sync; re-record
        <b>${plateLabel(state.walkbackNote.plate)}</b> below.</div>`
    : '';
  // One-shot acknowledgement of a stray (off-plan) jam reported via Oops.
  const oopsHtml = state.oopsNotice
    ? `<div class="note" style="margin-top:6px">${
        state.oopsNotice.broke
          ? 'That stray jam was the pick’s second mistake — it broke and the slides snapped back to the start. Board reset to match.'
          : 'Counted — a stray jam costs a mistake. One more breaks the pick.'
      }</div>`
    : '';
  // Tier 4: the player has reported every viable move as jammed at these positions.
  const stuckHtml =
    !jamMode && suggestEnabled() && suggestion && suggestion.type === 'stuck'
      ? `<div class="note" style="margin-top:6px">${suggestion.reason}</div>`
      : '';
  // One instruction line carries the whole loop: which slider, which move (when
  // suggestions are on; direction follows the recording's live deltaI), and how
  // to record the result. The board previews the move as a ghost → solid slide.
  const instructionHtml = jamMode
    ? `<div class="map-instruction" style="margin-top:6px;font-size:14px;color:#fff">Tap <b style="color:var(--gold)">∿</b> on every
        slide you saw wiggle, then <b>Done</b>. Optional — missing some is fine.</div>`
    : planPending
    ? `<div class="map-instruction plan-suggest" style="margin-top:6px;font-size:14px;color:#fff" title="${escapeHtml(suggestion.reason)}">Make it safer first:
        ${suggestion.moves
          .map((mv) => `<b style="color:var(--gold)">${plateLabel(mv.plate)}</b> <span class="dir">${dirArrow(mv.dir)} ${DIR_WORD[mv.dir]}</span>`)
          .join(' → ')} — do each in the lock, then tap its lit arrow below.
        <span class="linklike" data-action="plan-skip" style="margin-left:6px">skip</span></div>`
    : !isActive
    ? `<div class="muted">All plates mapped (green). Click any plate to review or fix it, or continue to Solve.</div>`
    : reviewing
    ? `<div class="map-instruction" style="margin-top:6px;font-size:14px;color:#fff">Reviewing <b style="color:var(--gold)">${plateLabel(active)}</b>
        — its links fill the <b>moved?</b> column. To re-record it, slide it in the lock, adjust the tags, then Save.</div>`
    : suggestEnabled() && state.rec
    ? `<div class="map-instruction" style="margin-top:6px;font-size:14px;color:#fff">Slide <b style="color:var(--gold)">${plateLabel(active)}</b>
        <span class="dir">${dirArrow(activeDir)} ${DIR_WORD[activeDir]}</span> in the lock, then fill the <b>moved?</b> column —
        <span style="color:var(--goal)">⇉ with</span> = same way, <span style="color:var(--danger)">⇄ opposite</span> = the other.</div>`
    : `<div class="map-instruction" style="margin-top:6px;font-size:14px;color:#fff">Recording <b style="color:var(--gold)">${plateLabel(active)}</b> —
        slide it one slot in the lock, then fill the <b>moved?</b> column
        (<span style="color:var(--goal)">⇉ with</span> / <span style="color:var(--danger)">⇄ opposite</span>).</div>`;
  // Legend explaining the ghost, shown only while a previewed move is on the board.
  const ghostLegendHtml = hasGhost
    ? `<div class="muted" style="margin-top:4px;font-size:12px"><b style="color:var(--gold);font-weight:600">Dashed</b> = where the slide is now · solid = where the move lands.</div>`
    : '';
  const title = done ? `Map the lock · all ${m.n} mapped ✓` : `Map the lock · ${mapped} of ${m.n} mapped`;
  // Per-user toggle: off hides the app's move guidance (preview, suggested-press text,
  // recommended-plate jump, Done/Skip plan) but keeps the edge/jam warning.
  const suggestToggleHtml = `<label class="ap-kbd" style="margin-top:4px"><input type="checkbox" data-action="toggle-suggest"${suggestEnabled() ? ' checked' : ''}> Suggest moves</label>`;
  head.innerHTML = `<div class="ap-h">${title}</div>${suggestToggleHtml}${instructionHtml}${statusHtml}${walkbackHtml}${jamHtml}${oopsHtml}${stuckHtml}${ghostLegendHtml}${suggestHtml}`;
  col.appendChild(head);

  // Ledger column headers: words live HERE, so the row buttons can stay compact
  // symbols. The tag column flips meaning while acknowledging a jam. Shown
  // whenever the rows carry controls — including re-recording a mapped plate.
  if (!done || isActive || jamMode) {
    const lh = document.createElement('div');
    lh.className = 'ledger-head';
    lh.innerHTML = `<span class="lh-tag">${jamMode ? 'wiggled?' : 'moved?'}</span><span class="lh-move">move it</span>`;
    col.appendChild(lh);
  }

  const boardHost = document.createElement('div');
  col.appendChild(boardHost);

  // Per-row ledger controls. "move it": ◀ ▶ apply this plate's own known move to
  // reposition (do it in the lock too) — live on mapped rows when legal. The tag
  // column records how the ACTIVE slider's move affected this plate, or (in jam
  // mode) whether it wiggled. Both can be needed on the same row: a mapped
  // plate's arrows reposition it, while its cell in the active row is its own
  // unknown to tag.
  const jn = state.jamNotice;
  // The repositioning plan's next physical action, lit up on its own row.
  const planFirst = planPending ? suggestion.moves[0] : null;
  const rowsRight = state.positions.map((_, i) => {
    // Rows carry controls while there's a recording (including re-recording a
    // mapped plate after the lock is fully mapped) or a jam acknowledgement.
    if (active == null && !jamMode) return '';
    const moveBtns = ['L', 'R']
      .map((d) => {
        // Repositioning is a mapping-phase tool; during a review of a fully
        // mapped lock the arrows stay dormant (Solve has Edit positions).
        const ok = !done && m.status[i] === 'done' && isLegal(state.positions, m.coupling, i, d);
        if (!ok) return `<span class="led-btn dis">${dirArrow(d)}</span>`;
        const lit = planFirst && planFirst.plate === i && planFirst.dir === d;
        return `<span class="led-btn${lit ? ' plan-next' : ''}" data-action="apply-move" data-plate="${i}" data-dir="${d}" title="${
          lit
            ? `Next safety move: slide ${plateLabel(i)} ${DIR_WORD[d]} in the lock, then tap here.`
            : `Slide ${plateLabel(i)} ${DIR_WORD[d]} (a mapped move — do it in the lock too)`
        }">${dirArrow(d)}</span>`;
      })
      .join('');
    const moveGroup = `<span class="led-group move">${moveBtns}</span>`;

    if (jamMode) {
      if (i === jn.plate) return `<span class="led-row"><span class="led-group"><span class="self-note">jammed</span></span>${moveGroup}</span>`;
      const on = m.coupling[jn.plate][i] !== 0 || (state.knownLinks || []).includes(`${jn.plate}|${i}`);
      return `<span class="led-row"><span class="led-group">
          <span class="led-btn${on ? ' on-wig' : ''}" data-action="jam-wiggle" data-plate="${i}"
            title="${plateLabel(i)} wiggled when ${plateLabel(jn.plate)} jammed — they're linked">∿<span class="led-word"> wiggled?</span></span>
        </span>${moveGroup}</span>`;
    }

    // While a plan is pending, the queued recording isn't the ask — don't
    // label its row "sliding" yet.
    if (i === active) {
      return `<span class="led-row"><span class="led-group">${
        planPending ? '' : '<span class="self-note">sliding</span>'
      }</span>${moveGroup}</span>`;
    }
    if (active == null) return '';
    const r = state.rec ? tagOf(state.rec, i) : 'none';
    // ∿ marks a soft link (wiggled on one of the active plate's jams, direction
    // unknown): expect this slide to move — the move will show which way.
    const linked = r === 'none' && (state.knownLinks || []).includes(`${active}|${i}`)
      ? `<span class="muted" style="font-size:10px" title="Wiggled when ${plateLabel(active)} jammed — linked; the move will show which way.">∿</span>`
      : '';
    return `<span class="led-row"><span class="led-group">
        <span class="led-btn${r === 'with' ? ' on-with' : ''}" data-action="set-rel" data-plate="${i}" data-rel="with"
          title="Moved the same way as ${plateLabel(active)}">⇉<span class="led-word"> With</span></span>
        <span class="led-btn${r === 'opposite' ? ' on-opp' : ''}" data-action="set-rel" data-plate="${i}" data-rel="opposite"
          title="Moved the other way">⇄<span class="led-word"> Opposite</span></span>${linked}
      </span>${moveGroup}</span>`;
  });

  const foot = document.createElement('div');
  foot.className = 'ap-card';
  const recInvalid = isActive && !!state.rec && !validRecording(state.rec);
  // The Reset lives with the actions now that the Move slides panel is gone.
  const canReset = !done && !!state.initial && state.positions.join(',') !== state.initial.join(',');
  const resetBtn = canReset
    ? `<span class="ap-btn" data-action="reset-pins" title="Pick broke? Snap the board back to the start to match the lock (mapping kept).">Reset</span>`
    : '';
  const saveBlock = jamMode
    ? `<span class="ap-btn primary" data-action="jam-done">Done ›</span> ${resetBtn}`
    : planPending
    ? `<span class="ap-btn" data-action="probe-jammed" title="The lit safety move jammed — then ${plateLabel(suggestion.moves[0].plate)}'s recorded row must be wrong. Marks it for re-recording and captures what wiggled.">It jammed ⚠</span>
       <span class="ap-btn" data-action="oops" title="A different, stray move jammed — counts a mistake on the pick.">Oops…</span> ${resetBtn}`
    : reviewing && !state.recTouched
    ? `<div class="muted">Viewing a mapped slide — nothing is being changed. Drag it or tap a tag to start re-recording.
         <span class="linklike" data-action="delete-plate" style="float:right">forget ${plateLabel(active)}’s mapping…</span></div>`
    : isActive
    ? `${recInvalid ? `<div class="note" style="margin-top:0;color:var(--danger)">⚠ This tag would push a slide past an edge — a real move can't do that (it would jam). Re-tag, or clear the edge first.</div>` : ''}<span class="ap-btn primary${recInvalid ? ' disabled' : ''}" data-action="save-next">Save plate ›</span>
       <span class="ap-btn" data-action="probe-jammed" title="The move was blocked at an edge — nothing moved. Tells the app so it stops suggesting it here.">It jammed ⚠</span>
       <span class="ap-btn" data-action="oops" title="A stray move jammed (wrong slide or direction) — not the one being recorded. Counts a mistake on the pick; the second breaks it.">Oops…</span>${
         reviewing ? ` <span class="ap-btn" data-action="cancel-rerecord" title="Discard these edits — keep the plate's saved links and positions.">Cancel</span>` : ''
       } ${resetBtn}
       <div class="muted" style="margin-top:8px">Move blocked instead? Click <b>It jammed</b> — a jam shows no links, and the app will steer around it. A stray jam (mis-slide)? <b>Oops…</b> keeps the pick honest.</div>`
    : '';
  const solveBlock = done
    ? `<div style="${isActive ? 'margin-top:12px' : ''}"><span class="ap-btn primary" data-action="goto-solve">Solve ›</span></div>`
    : '';
  // Always reachable: the rewind for when the board stops matching the lock.
  const syncBtn = `<div style="margin-top:10px"><span class="ap-btn" data-action="walkback-start"
      title="The board stopped matching the real lock? Rewind your recent moves one undo at a time to find the step that lied.">Lock doesn't match?</span></div>`;
  foot.innerHTML = saveBlock + solveBlock + syncBtn;
  col.appendChild(foot);

  // Labels go green once a plate is saved, and show the move as "start → landing" for
  // any plate the in-progress recording shifts (matching the board's ghost → solid).
  const labels = boardPositions.map((p, i) => {
    const moved = previewing && p !== state.rec.baseline[i];
    const val = moved ? `${state.rec.baseline[i]}→${p}` : `${p}`;
    return `<b${m.status[i] === 'done' ? ' class="done"' : ''}>P${i + 1}</b> · ${val}`;
  });
  createBoard(boardHost, {
    positions: boardPositions,
    ghosts,
    selectable: true,
    // While acknowledging a jam, the board belongs to that jam: highlight the
    // slide that jammed (not the next one the recommender already queued up),
    // and pause dragging until the player taps Done. While a plan is pending,
    // the spotlight follows the plan's next move instead.
    draggable: !jamMode && !planPending && active != null,
    onSetPosition: onMapDrag,
    onClick: onMapClick,
    highlightPlate: jamMode ? jn.plate : planPending ? planFirst.plate : active,
    labels,
    rowsRight,
  });
  return col;
}

// ---------- Solve ----------

function initSolve() {
  state.solveStart = state.positions.slice();
  state.plan = solve(state.positions, state.mapping.coupling);
  state.planIndex = 0;
}

// Length of the run of identical moves (same plate, same direction) starting at
// plan index i. In the game these are pressed in one sitting, so the solve view
// presents them as a single "press it ×N" instruction.
function runLengthAt(i) {
  const mv = state.plan[i];
  let run = 1;
  while (i + run < state.plan.length) {
    const nx = state.plan[i + run];
    if (nx.plate !== mv.plate || nx.dir !== mv.dir) break;
    run++;
  }
  return run;
}

// The "Next move" card's description for plan index i from positions `pos` —
// shared with reserveMoveDescHeight so the reserved height accounts for the
// run note exactly as rendered.
function moveSubText(coupling, pos, i) {
  const mv = state.plan[i];
  const run = runLengthAt(i);
  // The ✓ safe badge already says no plate hits an edge — don't repeat it here.
  const runNote = run > 1 ? ` Slide it ${run}× in a row — every move is safe.` : '';
  return `${describeMove(coupling, pos, mv.plate, mv.dir)}.${runNote}`;
}

// Positions are derived from the fixed plan: start + the first `planIndex` moves.
function computeSolvePositions() {
  let p = state.solveStart.slice();
  for (let k = 0; k < state.planIndex; k++) {
    const mv = state.plan[k];
    p = applyMove(p, state.mapping.coupling, mv.plate, mv.dir);
  }
  return p;
}

// One move row. `num` is the displayed step number, `cls` its state
// ('' | 'cur' | 'past'), `dataI` the plan index it jumps to. The text is wrapped
// in .step-tx so its content width can be measured (rows may be stretched wide).
function moveRowHtml(num, cls, dataI, mv) {
  const check = cls === 'past' ? ' ✓' : '';
  return `<div class="${cls}" data-action="goto-step" data-i="${dataI}"><span class="step-tx">${num} · ${plateLabel(
    mv.plate
  )} <span class="step-arrow">${dirArrow(mv.dir)}</span> ${DIR_WORD[mv.dir]}${check}</span></div>`;
}

function stepRowHtml(i) {
  const cls = i < state.planIndex ? 'past' : i === state.planIndex ? 'cur' : '';
  return moveRowHtml(i + 1, cls, i, state.plan[i]);
}

// The ×N label for a cycle. While you're stepping through the run it counts down
// the repetitions still to do ("×N remaining"); otherwise it shows the total.
function cycleBadge(seg) {
  const end = seg.start + seg.length;
  if (state.planIndex >= seg.start && state.planIndex < end) {
    const done = Math.floor((state.planIndex - seg.start) / seg.unitLen);
    return `×${seg.reps - done} remaining`;
  }
  return `×${seg.reps}`;
}

// Wrap a cycle's rows in the bracket group: a bracket encloses the run on both
// sides, with the ×N count sitting outside the closing bracket.
function cycleGroupHtml(rows, seg) {
  return `<div class="cyc-group"><div class="cyc-brace left"></div><div class="cyc-rows">${rows}</div><div class="cyc-brace right"></div><span class="cyc-count">${cycleBadge(
    seg
  )}</span></div>`;
}

// Expanded: every move is its own row. Single-move runs render as plain rows (a ×N
// bracket would read as N×N since each repetition is already shown); only multi-move
// repeating units are bracketed. See expandedLayout in cycles.js.
function expandedHtml(segs) {
  return expandedLayout(segs)
    .map((item) =>
      item.kind === 'row'
        ? stepRowHtml(item.index)
        : cycleGroupHtml(item.indices.map(stepRowHtml).join(''), item.seg)
    )
    .join('');
}

// Collapsed: same bracket group, but the unit's steps show only once. The step
// numbers track the current repetition (so they advance as you complete cycles)
// while the move text stays put; the highlight marks where you are in the unit.
function collapsedSegHtml(seg) {
  if (seg.type === 'single') return stepRowHtml(seg.index);
  const off = state.planIndex - seg.start;
  let rep, atMove;
  if (off < 0) { rep = 0; atMove = -1; } // before the run: all future, no highlight
  else if (off >= seg.length) { rep = seg.reps - 1; atMove = seg.unitLen; } // done: all past
  else { rep = Math.floor(off / seg.unitLen); atMove = off % seg.unitLen; }

  let rows = '';
  for (let j = 0; j < seg.unitLen; j++) {
    const idx = seg.start + rep * seg.unitLen + j;
    const cls = j < atMove ? 'past' : j === atMove ? 'cur' : '';
    rows += moveRowHtml(idx + 1, cls, idx, seg.unit[j]);
  }
  return cycleGroupHtml(rows, seg);
}

// The plan's step rows, honouring the collapse setting. Shared by the side-panel
// plan card and the full-screen plan modal so both stay in lockstep.
function planStepsHtml() {
  const segs = findCycles(state.plan);
  return settings.collapseCycles ? segs.map(collapsedSegHtml).join('') : expandedHtml(segs);
}

// The collapse/expand checkbox, reused in the plan card and the modal. `action`
// selects which click path handles the toggle (in-app re-render vs. modal rebuild).
function collapseToggleHtml(action) {
  return `<label class="ap-collapse"><input type="checkbox" data-action="${action}"${
    settings.collapseCycles ? ' checked' : ''
  }> Collapse repeats</label>`;
}

function planCardEl() {
  const card = document.createElement('div');
  card.className = 'ap-card';
  card.innerHTML = `<div class="ap-h ap-plan-h"><span>Plan · click a step to jump there</span>
    <span class="ap-plan-h-r">
      <button class="ap-fullplan" data-action="open-fullplan">Show Full Plan</button>
      ${collapseToggleHtml('toggle-collapse')}
    </span></div>
    <div class="ap-steplist">${planStepsHtml()}</div>`;
  return card;
}

// ---------- full-plan modal ----------
// A self-contained overlay (like the changelog) that shows the whole plan at screen
// size. It mirrors the live plan state and the collapse setting; toggling collapse
// here rebuilds the modal in place, clicking a step jumps there and closes. Every
// dismissal routes through closePlanModal so the key listener is always cleaned up.
function planModalHtml() {
  return `<div class="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-title" tabindex="-1">
    <button class="cl-close" data-pm="close" aria-label="Close full plan">✕</button>
    <div class="pm-head">
      <h2 id="pm-title">Full Plan</h2>
      ${collapseToggleHtml('toggle-collapse')}
    </div>
    <div class="ap-steplist pm-steplist">${planStepsHtml()}</div>`;
}

function onPlanModalKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePlanModal(); }
}

function closePlanModal() {
  const ov = document.getElementById('pm-overlay');
  if (ov) ov.remove();
  document.removeEventListener('keydown', onPlanModalKey, true);
  render(); // sync the side panel with any collapse toggle made in the modal
}

// Rebuild the modal's contents in place (after a collapse toggle) without tearing
// down the overlay, then realign the brackets for the new layout.
function refreshPlanModal() {
  const ov = document.getElementById('pm-overlay');
  if (!ov) return;
  ov.innerHTML = planModalHtml();
  alignCycleBraces(ov);
  layoutPlanColumns(ov);
  positionCycleCounts(ov);
  scrollCurrentStepIntoView(ov);
}

function openPlanModal() {
  if (!Array.isArray(state.plan) || !state.plan.length) return;
  if (document.getElementById('pm-overlay')) return; // already open
  const ov = document.createElement('div');
  ov.id = 'pm-overlay';
  ov.className = 'cl-overlay'; // reuse the changelog backdrop styling
  ov.innerHTML = planModalHtml();
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-pm="close"]')) { closePlanModal(); return; }
    const toggle = e.target.closest('[data-action="toggle-collapse"]');
    if (toggle) {
      settings.collapseCycles = !settings.collapseCycles;
      saveSettings(store, settings);
      refreshPlanModal();
      return;
    }
    const step = e.target.closest('[data-action="goto-step"]');
    if (step) {
      // Jump to the step but keep the modal open — only an explicit dismissal
      // (backdrop, Close, or Esc) closes it. The underlying view syncs on close.
      state.planIndex = Math.max(0, Math.min(state.plan.length, +step.dataset.i));
      state.positions = computeSolvePositions();
      refreshPlanModal();
    }
  });
  // Keep wheel scrolling over the modal inside it: let the plan list scroll natively
  // while it has room, but swallow the event at its edges (and over the header/padding)
  // so it never chains to the page underneath. Wheel over the backdrop falls through,
  // so the cursor-outside-the-modal case still scrolls the page. Needs passive:false
  // for preventDefault to take effect.
  ov.addEventListener('wheel', (e) => {
    if (!e.target.closest('.pm-modal')) return; // backdrop — let the page scroll
    const list = e.target.closest('.pm-steplist');
    if (list && list.scrollHeight > list.clientHeight) {
      const atTop = list.scrollTop <= 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      if (!((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom))) return; // native scrolls the list
    }
    e.preventDefault(); // at an edge, or over a non-scrolling area: stay in the modal
  }, { passive: false });
  document.body.appendChild(ov);
  // Capture phase so Esc closes the modal before the app's global key handlers see it.
  document.addEventListener('keydown', onPlanModalKey, true);
  alignCycleBraces(ov);
  layoutPlanColumns(ov);
  positionCycleCounts(ov);
  // Move focus into the dialog (so Esc/Tab and screen readers work) without lighting
  // up the ✕ button's focus ring when opened via the Z shortcut: focus the dialog
  // container itself, which carries no visible outline.
  const dialog = ov.querySelector('.pm-modal');
  if (dialog) dialog.focus();
}

function solvePanel(side, boardProps) {
  const coupling = state.mapping.coupling;

  if (state.editing) {
    const card = document.createElement('div');
    card.className = 'ap-card';
    card.innerHTML = `<div class="ap-h">Set the plates' current positions</div>
      <div class="muted" style="margin:4px 0 2px">Drag each slide left/right, or press <b>1</b>–<b>7</b> to set the active plate (advances P1 → P${state.n}).</div>
      <div style="margin-top:12px">
        <span class="ap-btn primary" data-action="apply-edit">Apply ›</span>
        <span class="ap-btn" data-action="cancel-edit">Cancel</span>
      </div>`;
    side.appendChild(card);
    return { ...boardProps, draggable: true, highlightPlate: state.activePlate, onSetPosition: onDragPosition };
  }

  if (state.plan === undefined) initSolve();

  if (state.driftReport) side.appendChild(driftNoteEl());

  if (state.plan === null) {
    const card = document.createElement('div');
    card.className = 'ap-card';
    card.innerHTML = `<div class="ap-h">No solution found</div>
      <div class="muted">Can't reach all-4 within bounds from these positions — re-check the current positions
        or the mapping.</div>
      <div style="margin-top:12px">
        <span class="ap-btn" data-action="edit-positions">Edit positions</span>
        <span class="ap-btn" data-action="back-to-map">Back to mapping</span>
      </div>`;
    side.appendChild(card);
    return boardProps;
  }

  if (state.planIndex >= state.plan.length) {
    const card = document.createElement('div');
    card.className = 'ap-card';
    card.innerHTML = `<div class="success">✓ Lock open!</div>
      <div class="muted" style="margin-top:6px">Every pin is at the center (4).</div>
      <div class="ap-h" style="margin-top:14px">Save this lock <span class="muted" style="text-transform:none;letter-spacing:0">— name it and it's kept automatically</span></div>
      ${namingWidgetHtml()}
      <div class="ap-h" style="margin-top:16px">Contents <span class="muted" style="text-transform:none;letter-spacing:0">— note what's inside (optional)</span></div>
      ${contentsEditorHtml(state.contents)}
      <div class="ap-h" style="margin-top:16px">Share this lock <span class="muted" style="text-transform:none;letter-spacing:0">— paste into Import on another device</span></div>
      <div class="share-panel">
        <textarea class="share-code" data-live-share readonly rows="2">${escapeHtml(buildShareCode())}</textarea>
        <div style="margin-top:6px"><span class="ap-btn" data-action="copy-share">Copy</span>
          <span class="share-copied muted"></span></div>
      </div>`;
    side.appendChild(card);
    if (state.plan.length) side.appendChild(planCardEl());
    return boardProps;
  }

  const next = state.plan[state.planIndex];
  const remaining = state.plan.length - state.planIndex;
  boardProps.highlightPlate = next.plate;
  boardProps.highlightKind = 'next';

  // Identical consecutive moves render as one instruction: in the game you keep
  // the plate selected and press the same direction N times, so the primary
  // button advances the whole run (single-step stays available).
  const run = runLengthAt(state.planIndex);
  const doneBtns = run > 1
    ? `<span class="ap-btn primary" data-action="did-run" data-count="${run}">Did all ${run} ›</span>
       <span class="ap-btn" data-action="did-it">Did 1 ›</span>`
    : `<span class="ap-btn primary" data-action="did-it">Did it ›</span>`;
  // Pick damage stays visible while executing too — a stray jam here costs the
  // same durability as one during mapping.
  const pickNote = state.pickMistakes
    ? ' · <span style="color:var(--danger)">pick: ⚠ 1 mistake</span>'
    : '';
  const oopsNote = state.oopsNotice
    ? `<div class="note" style="margin:8px 0 0">${
        state.oopsNotice.broke
          ? 'That stray jam broke the pick — the slides snapped back to the start, and the plan restarts from there.'
          : 'Counted — a stray jam costs a mistake. One more breaks the pick.'
      }</div>`
    : '';
  const nextCard = document.createElement('div');
  nextCard.className = 'ap-card';
  nextCard.innerHTML = `
    <div class="ap-nm-label">Next move · ${remaining} left${pickNote}</div>
    <div class="ap-nm">${plateLabel(next.plate)} <span class="dir">${dirArrow(next.dir)} ${DIR_WORD[next.dir]}</span>${
      run > 1 ? ` <span class="dir">×${run}</span>` : ''
    } <span class="badge safe">✓ safe</span></div>
    <div class="ap-nm-sub">${moveSubText(coupling, state.positions, state.planIndex)}</div>
    ${oopsNote}
    <div style="margin-top:12px">
      ${doneBtns}
      <span class="ap-btn" data-action="solve-jammed" title="THIS move jammed — then ${plateLabel(next.plate)}'s recorded row must be wrong. Marks it for re-recording and captures what wiggled.">It jammed ⚠</span>
      <span class="ap-btn" data-action="oops" title="A different, stray move jammed the lock — counts a mistake on the pick; the second breaks it and the slides snap back.">Oops…</span>
      <span class="ap-btn" data-action="reset-pins">Reset pins${isNarrowViewport() ? '' : ' (R)'}</span>
      <span class="ap-btn" data-action="edit-positions">Edit positions</span>
    </div>`;
  side.appendChild(nextCard);

  side.appendChild(planCardEl());
  side.appendChild(couplingCard(coupling));
  return boardProps;
}

function couplingCard(coupling) {
  const card = document.createElement('div');
  card.className = 'ap-card';
  // Same icons as the mapping ledger: ⇉ moves with, ⇄ moves opposite. The words
  // overflowed this narrow panel, so they live in the tooltips instead.
  const rows = coupling
    .map((row, i) => {
      const chips = row
        .map((v, j) =>
          j === i
            ? ''
            : v === 1
            ? `<span class="chip with" title="${plateLabel(j)} moves with ${plateLabel(i)} — same direction">⇉ ${plateLabel(j)}</span>`
            : v === -1
            ? `<span class="chip opp" title="${plateLabel(j)} moves opposite ${plateLabel(i)}">⇄ ${plateLabel(j)}</span>`
            : ''
        )
        .filter(Boolean)
        .join('');
      return `<div class="cpl-card"><span class="mv">Slide <b>${plateLabel(i)}</b></span><span>${chips || '<span class="muted">— no links</span>'}</span></div>`;
    })
    .join('');
  card.innerHTML = `<div class="ap-h">Connections · reference <span class="muted" style="text-transform:none;letter-spacing:0">— ⇉ with · ⇄ opposite</span></div>${rows}`;
  return card;
}

// ---------- events ----------

// Snap every slide back to the lock's reset point (a pick break, or the player
// re-syncing with the game). Shared by the Reset buttons and the R shortcut so
// both behave identically: in Solve the plan is recomputed from the reset point;
// in mapping the learned rows are kept, any skipped edge-clear plan is re-offered,
// and the in-progress recording is re-based on the reset positions (otherwise the
// board would keep previewing from a stale baseline).
function resetPinsToInitial() {
  if (!state.initial) return;
  state.positions = state.initial.slice();
  state.pickMistakes = 0; // slides only snap back when a pick breaks — assume a fresh pick
  state.driftReport = undefined; // a reset starts from a known state
  state.stepLog = []; // ...so there is nothing left to rewind through
  state.walkback = undefined;
  if (state.stage === 'solve') state.plan = undefined; // re-plan from the reset point
  if (state.stage === 'discovery') {
    state.skipPlanKey = undefined;
    if (state.activePlate != null) seedRecording(state.activePlate);
  }
}

// Every board-moving step during mapping is logged with the positions it
// started from, so "Lock doesn't match?" can walk the player BACKWARDS through
// their own moves: each step is physically undoable in the lock (slide it the
// other way — the inverse of a move that worked is always legal), and the first
// rewind where lock and board agree again pinpoints the mis-recorded slide.
function logStep(plate, dir) {
  const log = (state.stepLog ??= []);
  log.push({ plate, dir, before: state.positions.slice() });
  if (log.length > 60) log.shift(); // plenty to rewind through; don't grow forever
}

// A reported jam of a KNOWN press (plate + direction): remember it against the
// current positions, auto-learn the blocker when only one other slide sits on
// an edge, count the pick damage (the break auto-resets the board), and raise
// the jam notice with its wiggle capture. Shared by the mapping probe flow and
// a planned solve move that jams.
function reportJam(plate, dir) {
  (state.blockedProbes ??= []).push(`${state.positions.join(',')}|${plate}|${dir}`);
  const jn = { plate, dir, positions: state.positions.slice() };
  const edgeOthers = jamEdgeOthers(jn);
  if (edgeOthers.length === 1) {
    const j = edgeOthers[0];
    state.mapping.coupling[plate][j] = blockerCell(jn, j);
    jn.autoLearned = j;
  }
  jn.broke = recordPickMistake();
  state.jamNotice = jn;
}

// One point of pick damage (a jam — reported or stray). The second mistake
// breaks the pick; a break snaps every slide back to the start, so the board
// auto-resets to match. Returns whether the pick broke.
function recordPickMistake() {
  const broke = (state.pickMistakes || 0) + 1 >= 2;
  if (broke) {
    state.picksBroken = (state.picksBroken || 0) + 1;
    resetPinsToInitial(); // also zeroes pickMistakes (fresh pick)
  } else {
    state.pickMistakes = 1;
  }
  return broke;
}

const clampN = (n) => Math.max(N_MIN, Math.min(N_MAX, n));

function resizeN(n) {
  state.n = n;
  state.positions = Array.from({ length: n }, (_, i) => state.positions[i] ?? GOAL);
}

appEl.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  // The jam acknowledgement stays up through the jam flow (so wiggles can be
  // tapped) and clears on any other action; the oops note is one-shot too.
  if (a !== 'probe-jammed' && a !== 'jam-wiggle') state.jamNotice = undefined;
  if (a !== 'oops') state.oopsNotice = undefined;
  if (a !== 'walkback-match') state.walkbackNote = undefined;

  switch (a) {
    case 'n-dec': resizeN(clampN(state.n - 1)); break;
    case 'n-inc': resizeN(clampN(state.n + 1)); break;
    case 'start-mapping':
      if (!state.mapping || state.mapping.n !== state.n) state.mapping = createMapping(state.n);
      state.initial = state.positions.slice(); // the setup positions are the lock's reset point
      state.stepLog = []; // a fresh sync point — nothing to rewind past it
      state.activePlate = undefined;
      state.rec = null;
      state.stage = 'discovery';
      suggestDefault();
      break;
    case 'goto-solve': discardPendingEdit(); state.stage = 'solve'; state.plan = undefined; break;
    case 'new-setup': {
      const dup = findDuplicate();
      if (dup) { state.nameConflict = dup.name; break; } // stay on Lock step; warning shows
      state.stage = 'setup';
      state.activePlate = 0;
      break;
    }
    case 'goto-stage': {
      const target = t.dataset.stage;
      discardPendingEdit();
      if (target === 'lock') state.stage = 'lock';
      else if (target === 'setup') { state.stage = 'setup'; state.activePlate = 0; }
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; state.rec = null; state.driftReport = undefined; suggestDefault(); }
      else if (target === 'solve' && state.mapping) { state.stage = 'solve'; state.plan = undefined; }
      break;
    }
    case 'loc-fill': {
      const nm = activeName();
      nm.location = nm.location === t.dataset.loc ? '' : t.dataset.loc;
      if (state.stage === 'contents') persistName(); // editor autosaves on select; create flow saves on input
      break;
    }
    case 'kind-set':
      activeName().kind = t.dataset.kind;
      if (state.stage === 'contents') persistName();
      break;
    case 'start-over': {
      // Only confirm when there's unrecoverable work: a mapping that isn't saved (an unnamed
      // lock lives only in the session, so Start over would lose it). Named locks are kept.
      const unsaved = state.mapping && !(state.location || '').trim() && !(state.description || '').trim();
      if (!unsaved || window.confirm("Start over? This unnamed lock isn't saved — its mapping will be lost. (Named locks are kept.)")) {
        state = freshSetup(state.n);
      }
      break;
    }
    case 'reset-pins':
      resetPinsToInitial();
      break;

    case 'select-plate': {
      seedRecording(+t.dataset.plate);
      break;
    }
    case 'set-rel':
      if (state.rec) { state.rec = toggleTag(state.rec, +t.dataset.plate, t.dataset.rel); state.recTouched = true; }
      break;
    case 'save-next': saveActivePlate(); break;

    case 'probe-jammed': {
      // While a "make it safer" plan is pending, the move the player actually
      // performed is the plan's LIT move — not the queued recording. And that
      // lit move comes from a mapped row that claimed it legal, so a jam there
      // proves the row wrong (same logic as a jammed solve move): re-open it.
      const sug = suggestEnabled() && state.mapping && !allMapped(state.mapping)
        ? recommendNext(state.positions, state.mapping, blockedNow(), softLinksSet())
        : null;
      if (sug && sug.type === 'plan' && state.skipPlanKey !== state.positions.join(',')) {
        const mv = sug.moves[0];
        state.mapping.status[mv.plate] = 'partial'; // proven wrong — needs re-recording
        state.lockLoaded = false;
        reportJam(mv.plate, mv.dir);
        suggestDefault();
        break;
      }
      // Otherwise the jam is the recorded probe's: nothing moved. Remember it
      // against the current positions so it is never suggested here again, and
      // deprioritize the plate. Each jam also damages the pick: the SECOND
      // mistake breaks it, which snaps every slide back — the board follows.
      const rec = state.rec;
      if (rec) {
        defer(state.mapping, rec.active);
        reportJam(rec.active, rec.deltaI === 1 ? 'L' : 'R');
        suggestDefault();
      }
      break;
    }

    case 'solve-jammed': {
      // The PLANNED move jammed: the mapping called it safe, reality disagrees —
      // that plate's recorded row is provably wrong somewhere (a jam moves
      // nothing, so there are no positions to edit; the jam itself is the
      // evidence). Mark the row for re-recording and drop into the mapping jam
      // flow, wiggle capture and all, anchored on it.
      if (!Array.isArray(state.plan) || state.planIndex >= state.plan.length) break;
      const mv = state.plan[state.planIndex];
      state.mapping.status[mv.plate] = 'partial'; // proven wrong — needs re-recording
      state.lockLoaded = false;
      reportJam(mv.plate, mv.dir);
      state.plan = undefined;
      state.driftReport = undefined;
      state.stage = 'discovery';
      suggestDefault();
      break;
    }

    case 'oops': {
      // A stray jam in the game (wrong slide or direction) that wasn't the
      // recorded move: it teaches nothing about the lock, but it cost the pick
      // a mistake — keep the durability tracking in sync. The second one
      // breaks the pick and the board auto-resets to the snapped-back slides.
      state.oopsNotice = { broke: recordPickMistake() };
      break;
    }

    case 'plan-skip':
      state.skipPlanKey = state.positions.join(','); // dismiss until positions change
      break;
    case 'jam-done':
      break; // jamNotice already cleared above — rows return to the moved? column
    case 'cancel-rerecord':
      // An accidental drag/re-tag while reviewing a mapped plate: discard the
      // edits and return to the passive review (saved links, committed board).
      if (state.activePlate != null) seedRecording(state.activePlate);
      break;
    case 'walkback-start':
      // Rewind through the logged moves; with nothing logged, go straight to
      // the hand-fix editor.
      if ((state.stepLog || []).length) state.walkback = { undone: 0 };
      else { state.editBackup = state.positions.slice(); state.editing = true; state.activePlate = 0; }
      break;
    case 'walkback-more':
      if (state.walkback) state.walkback.undone++;
      break;
    case 'walkback-match': {
      // Lock and board agree at this rewound state, and they disagreed one step
      // later — so the step just undone is where the recording lied. Sync the
      // board here (true by construction), re-open that slide's row, and land
      // in its review.
      const log = state.stepLog || [];
      const idx = log.length - 1 - (state.walkback ? state.walkback.undone : 0);
      if (idx < 0) break;
      const step = log[idx];
      state.positions = step.before.slice();
      state.stepLog = log.slice(0, idx);
      state.walkback = undefined;
      state.skipPlanKey = undefined;
      state.walkbackNote = { plate: step.plate };
      if (state.mapping.status[step.plate] === 'done') {
        state.mapping.status[step.plate] = 'partial';
        state.lockLoaded = false;
      }
      seedRecording(step.plate);
      break;
    }
    case 'walkback-hand': {
      // Bail out of the rewind: edit positions by hand, starting from whatever
      // the rewind currently shows (the player has undone that many moves).
      const log = state.stepLog || [];
      const u = state.walkback ? state.walkback.undone : 0;
      const shown = state.walkback
        ? (u >= log.length ? (log[0]?.before ?? state.positions) : log[log.length - 1 - u].before)
        : state.positions;
      state.editBackup = state.positions.slice();
      state.positions = shown.slice();
      state.editing = true;
      state.walkback = undefined;
      state.activePlate = 0;
      break;
    }
    case 'drift-review':
      // Jump from the drift diagnosis straight into reviewing the suspect row.
      state.driftReport = undefined;
      state.stage = 'discovery';
      state.skipPlanKey = undefined;
      seedRecording(+t.dataset.plate);
      break;
    case 'delete-plate': {
      // Forget ONE slide's mapping: its recorded row, its jam notes, and its
      // wiggle links — so it can be mapped fresh. Everything physical (slide
      // positions, reset point, pick damage) and every other row is kept.
      const i = state.activePlate;
      if (i == null || !state.mapping) break;
      if (!window.confirm(`Forget ${plateLabel(i)}’s mapping? Its recorded links and jam notes are cleared so it can be mapped fresh. Slide positions and the other rows are kept.`)) break;
      const row = Array(state.n).fill(0);
      row[i] = 1;
      state.mapping.coupling[i] = row;
      state.mapping.status[i] = 'unstarted';
      state.knownLinks = (state.knownLinks || []).filter((k) => !k.startsWith(`${i}|`));
      state.blockedProbes = (state.blockedProbes || []).filter((k) => +k.split('|')[1] !== i);
      state.lockLoaded = false;
      state.plan = undefined;
      state.skipPlanKey = undefined;
      suggestDefault();
      break;
    }
    case 'jam-wiggle': {
      // The player saw this plate wiggle on the jam they just reported: linked
      // to the jammed plate for sure. The SIGN is only known when this slide is
      // provably the blocker (the sole edge slide at jam time) — a wiggling
      // edge slide may have been moving inward legally. Everything else records
      // as a soft link (linked, sign unknown). Tap again to undo. Absence of a
      // tap means nothing — the player may simply not have seen it.
      const jn = state.jamNotice;
      if (!jn || !state.mapping) break;
      const j = +t.dataset.plate;
      if (j === jn.plate) break;
      const row = state.mapping.coupling[jn.plate];
      const key = `${jn.plate}|${j}`;
      const links = (state.knownLinks ??= []);
      if (row[j] !== 0) {
        row[j] = 0; // undo an exact cell (auto-learned or previously recorded)
        if (jn.autoLearned === j) jn.autoLearned = undefined;
      } else if (links.includes(key)) {
        state.knownLinks = links.filter((k) => k !== key); // undo a soft link
      } else if (jamEdgeOthers(jn).length === 1 && jamEdgeOthers(jn)[0] === j) {
        row[j] = blockerCell(jn, j); // sole edge slide ⇒ the blocker ⇒ exact
        jn.autoLearned = j;
      } else {
        links.push(key);
      }
      defer(state.mapping, jn.plate); // the row carries partial knowledge now
      suggestDefault(); // learned links can rule out (or reopen) suggestions
      break;
    }
    case 'apply-move': {
      // Manually apply a known move (press of a mapped plate) to reposition the slides.
      const plate = +t.dataset.plate;
      const dir = t.dataset.dir;
      if (state.mapping.status[plate] === 'done' && isLegal(state.positions, state.mapping.coupling, plate, dir)) {
        logStep(plate, dir);
        state.positions = applyMove(state.positions, state.mapping.coupling, plate, dir);
        state.skipPlanKey = undefined; // positions changed → re-offer any edge plan
        // re-base the in-progress recording against the new positions
        if (state.activePlate != null) seedRecording(state.activePlate);
      }
      break;
    }

    case 'did-it':
      if (state.plan && state.planIndex < state.plan.length) {
        state.planIndex++;
        state.positions = computeSolvePositions();
        state.driftReport = undefined; // moving on with the new plan
      }
      break;
    case 'did-run':
      // Advance through the whole same-plate run at once (the player pressed it
      // N times in the game).
      if (state.plan && state.planIndex < state.plan.length) {
        state.planIndex = Math.min(state.plan.length, state.planIndex + (+t.dataset.count || 1));
        state.positions = computeSolvePositions();
        state.driftReport = undefined; // moving on with the new plan
      }
      break;
    case 'goto-step': {
      const i = Math.max(0, Math.min(state.plan.length, +t.dataset.i));
      state.planIndex = i;
      state.positions = computeSolvePositions();
      break;
    }
    case 'edit-positions':
      state.editing = true;
      state.editBackup = state.positions.slice(); // snapshot to restore on Cancel
      state.activePlate = 0;
      break;
    case 'apply-edit':
      // Corrects the CURRENT positions only. The reset point (state.initial) is
      // untouched: the physical lock always snaps back to its original positions
      // on a pick break, so overwriting it would desync every later Reset. To
      // change the reset point itself, adjust the pins in Setup and re-enter
      // mapping (start-mapping re-snapshots it).
      if (state.stage === 'discovery') {
        // Hand-fix during mapping: the board now matches the lock by assertion;
        // the old step log no longer describes how we got here.
        state.editing = false;
        state.editBackup = undefined;
        state.stepLog = [];
        state.skipPlanKey = undefined;
        suggestDefault();
        break;
      }
      // In Solve: if the entered positions differ from what the executed plan
      // predicted, the mapping lied somewhere — diagnose which rows could explain it.
      state.driftReport =
        state.editBackup && Array.isArray(state.plan) && state.planIndex > 0
          ? diagnoseDrift(state.positions, state.editBackup, state.plan.slice(0, state.planIndex), state.mapping.coupling)
          : undefined;
      state.editing = false;
      state.editBackup = undefined;
      state.plan = undefined;
      break;
    case 'cancel-edit':
      discardPendingEdit();
      if (state.stage === 'discovery') suggestDefault(); // re-seed against the restored positions
      break;
    case 'back-to-map': state.stage = 'discovery'; state.driftReport = undefined; break;
    case 'load-lock': {
      const lock = getLock(store, t.dataset.id);
      if (lock) {
        state.n = lock.n;
        state.initial = (lock.initial || Array(lock.n).fill(GOAL)).slice();
        state.positions = state.initial.slice();
        if (lock.coupling) {
          state.mapping = { n: lock.n, coupling: lock.coupling, status: lock.status || Array(lock.n).fill('done') };
          state.lockLoaded = (lock.status || Array(lock.n).fill('done')).every((s) => s === 'done');
        } else {
          state.mapping = createMapping(lock.n);
          state.lockLoaded = false;
        }
        state.lockId = lock.id;
        state.location = lock.location ?? lock.name ?? '';
        state.kind = lock.kind ?? 'Chest';
        state.description = lock.description ?? '';
        state.contents = (Array.isArray(lock.contents) ? lock.contents : []).map((c) => ({ ...c }));
        // jump straight to whatever step is next: Solve if fully mapped, else resume mapping
        state.stage = state.lockLoaded ? 'solve' : 'discovery';
        state.editing = false;
        state.editBackup = undefined;
        state.plan = undefined;
        state.activePlate = undefined;
        state.rec = null;
        state.blockedProbes = []; // jam memory and pick damage belong to the previous lock
        state.knownLinks = [];
        state.stepLog = [];
        state.pickMistakes = 0;
        state.picksBroken = 0;
        if (state.stage === 'discovery') suggestDefault();
      }
      break;
    }
    case 'toggle-kbd':
      settings.keyboardShortcuts = !kbdEnabled();
      saveSettings(store, settings);
      break;
    case 'toggle-suggest':
      settings.suggestMoves = !suggestEnabled();
      saveSettings(store, settings);
      break;
    case 'toggle-collapse':
      settings.collapseCycles = !settings.collapseCycles;
      saveSettings(store, settings);
      break;
    case 'toggle-folder': {
      const key = t.dataset.folder;
      const overrides = settings.lockFolders || (settings.lockFolders = {});
      overrides[key] = !sectionOpen(key);
      saveSettings(store, settings);
      break;
    }
    case 'del-lock': {
      const id = t.dataset.id;
      const lock = getLock(store, id);
      if (!window.confirm(`Delete ${lock ? `"${lock.name}"` : 'this lock'}? This can't be undone.`)) break;
      deleteLock(store, id);
      if (state.shareId === id) state.shareId = undefined;
      if (state.lockId === id) { state.lockId = undefined; state.location = ''; state.kind = 'Chest'; state.description = ''; state.contents = []; }
      break;
    }
    case 'export-all': exportAllLocks(); return; // download only — no re-render needed
    case 'share-lock': state.shareId = state.shareId === t.dataset.id ? undefined : t.dataset.id; break;
    case 'close-share': state.shareId = undefined; break;
    case 'copy-share': copyShareCode(t); return;
    case 'content-add': { const arr = activeContents(); arr.push({ item: '', qty: 1 }); state.focusContentItem = arr.length - 1; persistContents(); break; }
    case 'content-del': activeContents().splice(+t.dataset.i, 1); persistContents(); break;
    case 'edit-contents': {
      const lock = getLock(store, t.dataset.id);
      if (lock) {
        state.stage = 'contents';
        state.contentsEdit = {
          id: lock.id,
          items: (Array.isArray(lock.contents) ? lock.contents : []).map((c) => ({ ...c })),
          location: lock.location || '',
          kind: lock.kind || 'Chest',
          description: lock.description || '',
          nameConflict: null,
        };
      }
      break;
    }
    case 'contents-done': state.stage = 'lock'; state.contentsEdit = undefined; break;
    case 'import-open': state.stage = 'import'; state.import = { phase: 'input' }; break;
    case 'import-parse': runImportParse(); break;
    case 'import-apply': runImportApply(); break;
    case 'import-cancel':
    case 'import-done': state.stage = 'lock'; state.import = undefined; break;
    case 'cf-choice': state.import.choices[+t.dataset.i] = t.dataset.choice; break;
    case 'open-changelog': openChangelog(); return; // overlay lives outside the app state/render cycle
    case 'open-fullplan': openPlanModal(); return; // overlay lives outside the app state/render cycle
    default: return;
  }
  render();
});

appEl.addEventListener('input', (e) => {
  // Import paste box: keep the typed text without re-rendering (keeps focus); a new
  // paste also clears any stale file selection and error so Review uses what's visible.
  if (e.target.closest('[data-action="import-text"]') && state.import) {
    state.import.text = e.target.value;
    state.import.fileText = undefined;
    state.import.fileName = undefined;
    state.import.error = undefined;
    return;
  }
  // Contents item/quantity edits — update the active buffer and save without re-rendering
  // (keeps focus). The buffer may hold a blank/partial row; persistContents stores it clean.
  const ctItem = e.target.closest('[data-action="content-item"]');
  const ctQty = e.target.closest('[data-action="content-qty"]');
  if (ctItem || ctQty) {
    const arr = activeContents();
    const row = arr && arr[+(ctItem || ctQty).dataset.i];
    if (!row) return;
    if (ctItem) row.item = e.target.value;
    else { const v = e.target.value; row.qty = v === '' ? '' : Number(v); }
    persistContents();
    refreshLiveShare();
    return;
  }
  // update text fields + autosave without re-rendering (keeps the input focused)
  if (e.target.closest('[data-action="loc-input"]')) activeName().location = e.target.value;
  else if (e.target.closest('[data-action="desc-input"]')) activeName().description = e.target.value;
  else return;
  persistName(); // syncLock (create) or saveLock (editor); refreshes the active nameConflict
  refreshLiveShare();
  const w = document.getElementById('name-warning');
  if (w) w.innerHTML = nameWarningHtml();
});

window.addEventListener('keydown', (e) => {
  if (document.getElementById('cl-overlay')) return; // changelog modal owns the keyboard while open
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd/Ctrl+R etc. for the browser
  if (!kbdEnabled() || isNarrowViewport()) return;
  const tag = (e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't hijack typing or the toggle

  // The full-plan modal stays open while you step through it: the stepping keys move
  // the current step and refresh the modal in place. Only the backdrop, the Close
  // button, or Esc (handled by the modal's own capture listener) dismiss it.
  const planModalOpen = !!document.getElementById('pm-overlay');

  // R — reset the pins to the lock's starting positions and re-solve from the top.
  // Works while the modal is open too: it just sends the plan back to step 1.
  if (e.key === 'r' || e.key === 'R') {
    if (!state.initial) return;
    resetPinsToInitial();
    e.preventDefault();
    render(); // recomputes the plan from the reset positions
    if (planModalOpen) refreshPlanModal();
    return;
  }

  // Z — toggle the full-plan modal while solving (the keyboard twin of "Show Full
  // Plan"): opens it, or closes it again if it's already up.
  if (e.key === 'z' || e.key === 'Z') {
    if (planModalOpen) {
      e.preventDefault();
      closePlanModal();
    } else if (state.stage === 'solve' && !state.editing &&
        Array.isArray(state.plan) && state.plan.length) {
      e.preventDefault();
      openPlanModal();
    }
    return;
  }

  // Setup / Edit-positions — digits set the active plate's pin; arrows move the cursor.
  if (!planModalOpen && isPositionEditing()) {
    if (handlePositionKey(e.key)) { e.preventDefault(); render(); }
    return; // these contexts consume no plan-stepping keys
  }

  // Step through the plan while solving. Advance: Enter / Space / ↓ / →. Back: ↑ / ←.
  // The modal only opens mid-solve with a plan, so it's safe to step while it's open.
  if (!planModalOpen && (state.stage !== 'solve' || state.editing)) return;
  if (!Array.isArray(state.plan)) return;

  // N / P — jump forward or back by a whole grouped section. Only meaningful in the
  // collapsed plan view, where each detected cycle reads as one ×N section: instead of
  // stepping move-by-move, N lands on the next section boundary and P on the current
  // section's start (or the previous one when already at a boundary). No-ops when
  // collapsed view is off.
  const nextSection = e.key === 'n' || e.key === 'N';
  const prevSection = e.key === 'p' || e.key === 'P';
  if ((nextSection || prevSection) && settings.collapseCycles && state.plan.length) {
    const segs = findCycles(state.plan);
    const target = nextSection
      ? nextSectionStart(segs, state.planIndex)
      : prevSectionStart(segs, state.planIndex);
    if (target === state.planIndex) return; // already at the end / start
    e.preventDefault();
    state.planIndex = target;
    state.positions = computeSolvePositions();
    if (planModalOpen) refreshPlanModal(); else render();
    return;
  }

  const advance = ['Enter', ' ', 'Spacebar', 'ArrowDown', 'ArrowRight'].includes(e.key);
  const back = ['ArrowUp', 'ArrowLeft', 'Backspace'].includes(e.key);
  if (!advance && !back) return;
  e.preventDefault();
  if (advance && state.planIndex < state.plan.length) state.planIndex++;
  else if (back && state.planIndex > 0) state.planIndex--;
  else return; // already at an end — nothing changes
  state.positions = computeSolvePositions();
  if (planModalOpen) refreshPlanModal(); else render();
});

// Paste-to-import: on the Lock step, pasting a share/export code anywhere on
// the page (not into a text field) imports it immediately and lands on the
// results screen — no need to open Import first. Anything that isn't a valid
// code pastes normally.
window.addEventListener('paste', (e) => {
  if (state.stage !== 'lock') return;
  const tag = (e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // typing fields keep normal paste
  const text = (e.clipboardData?.getData('text') || '').trim();
  if (!text || !parseImport(text)) return;
  e.preventDefault();
  state.stage = 'import';
  state.import = { phase: 'input', text };
  runImportParse();
  render();
});

// Read a chosen backup file into the import state, then re-render to show its name.
appEl.addEventListener('change', (e) => {
  if (!e.target.closest('[data-action="import-file"]') || !state.import) return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.import.fileText = String(reader.result || '');
    state.import.fileName = file.name;
    state.import.text = undefined;
    state.import.error = undefined;
    render();
  };
  reader.readAsText(file);
});

window.addEventListener('resize', () => {
  fitPlanList();
  // The full-plan modal's column count depends on the viewport, so rebuild it.
  if (document.getElementById('pm-overlay')) refreshPlanModal();
});

render();
