import { createBoard } from './board.js';
import { nextActivePlate } from './active-plate.js';
import { applyMove, moveDelta, isSolved, isLegal, GOAL } from '../model.js';
import { solve, applySequence } from '../solver.js';
import {
  createRecording, tagOf, positionsOf, couplingRow,
  toggleTag, dragActive, dragOther, validRecording,
} from './mapping-record.js';
import { coachingMessage } from './coaching.js';
import { findCycles, expandedLayout, nextSectionStart, prevSectionStart } from '../cycles.js';
import { planColumnCount } from './plan-columns.js';
import { createMapping, recommendNext, allMapped } from '../discovery.js';
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
const CHANGELOG_VERSION = '1.2.0';

// User-facing changelog, newest first. Shown in the in-app changelog modal.
const CHANGELOG = [
  {
    date: '2026-06-09',
    items: [
      'Mapping now tracks where your slides are as you go — record each plate by dragging the slides or with the Moves with / Moves opposite buttons, and the board stays in sync.',
      'The suggested next move is shown right on the board: a faint ghost marks where each slide is now, and the solid slide shows where the press lands.',
      'New “Move slides” controls let you apply moves you’ve already mapped to reposition the slides — handy for pulling a slide off an edge before mapping it.',
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
  const { n, initial, mapping, location, kind, description, contents, lockId, lockLoaded, plan, planIndex, solveStart } = state;
  // The import and contents screens are transient overlays over the Lock step — never
  // persist them as a saved session stage (a reload would otherwise restore an empty one).
  const stage = state.stage === 'import' || state.stage === 'contents' ? 'lock' : state.stage;
  // While editing positions in Solve, changes stay pending until Apply — persist the
  // pre-edit snapshot so a drag/keystroke (or a reload) doesn't silently commit them.
  const positions = state.editing && state.editBackup ? state.editBackup : state.positions;
  saveSession(store, { stage, n, positions, initial, mapping, location, kind, description, contents, lockId, lockLoaded, plan, planIndex, solveStart });
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

// Once the lock is identifiable (a location or description), keep its saved record current —
// unless it would duplicate an existing lock, in which case refuse and flag a conflict.
function syncLock() {
  if (!(state.location || '').trim() && !(state.description || '').trim()) { state.nameConflict = null; return; }
  const dup = findDuplicate();
  if (dup) { state.nameConflict = dup.name; return; }
  state.nameConflict = null;
  if (!state.lockId) state.lockId = `lock-${Date.now()}`;
  saveLock(store, stamp({
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
  }));
}

// ---------- helpers ----------

const plateLabel = (i) => `P${i + 1}`;
const shiftWord = (delta) => (delta > 0 ? 'left' : 'right');
const dirArrow = (dir) => (dir === 'L' ? '◀' : '▶');

function describeMove(coupling, positions, plate, dir) {
  const d = moveDelta(coupling, plate, dir);
  const parts = [];
  for (let j = 0; j < d.length; j++) {
    if (d[j] === 0) continue;
    const lead = j === plate ? 'shifts' : 'also shifts';
    parts.push(`${lead} ${plateLabel(j)} ${shiftWord(d[j])} (${positions[j]}→${positions[j] + d[j]})`);
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

// Default plate to record: the safe-ordered suggestion if any, else first unmapped, else null.
function suggestDefault() {
  const m = state.mapping;
  let next = null;
  for (let i = 0; i < m.n; i++) if (m.status[i] !== 'done') { next = i; break; }
  // With suggestions on, jump to the recommended plate; off, just take the first unmapped.
  if (suggestEnabled()) {
    const rec = recommendNext(state.positions, m);
    if (rec && rec.type === 'probe') next = rec.plate;
  }
  state.activePlate = next;
  state.rec = next == null ? null : createRecording(state.positions, next, relFromMapping(next));
  state.recTouched = false;
}

function saveActivePlate() {
  const rec = state.rec;
  if (!rec) return;
  if (!validRecording(rec)) return; // a successful press can't push a slide off an edge (that's a jam)
  state.mapping.coupling[rec.active] = couplingRow(rec);
  state.positions = positionsOf(rec); // commit the live, recorded positions
  state.mapping.status[rec.active] = 'done';
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
  for (const mv of state.plan) {
    sub.textContent = `${describeMove(coupling, pos, mv.plate, mv.dir)}. No plate hits an edge.`;
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
  state.activePlate = i;
  state.rec = createRecording(state.positions, i, relFromMapping(i));
  state.recTouched = false;
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

// True while the board is in a position-editing context (Setup, or Solve's Edit mode).
function isPositionEditing() {
  return state.stage === 'setup' || (state.stage === 'solve' && state.editing);
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

function mappingView() {
  const m = state.mapping;
  if (state.activePlate === undefined) suggestDefault();

  const active = state.activePlate;
  const mapped = m.status.filter((s) => s === 'done').length;
  const suggestion = allMapped(m) ? null : recommendNext(state.positions, m);

  const col = document.createElement('div');
  col.className = 'map-wrap';

  const isActive = active != null;
  const done = allMapped(m);

  // Board data derived from the in-progress recording: the solid slide sits at the
  // tentative landing (positionsOf), a faint ghost marks each moved plate's start, and
  // moved plates get a "start → landing" label — so a previewed press never looks
  // committed. With "Suggest moves" off we don't preview the suggested press on entry:
  // the board shows the real positions until you actually record a move (recTouched).
  const previewing = !!state.rec && (suggestEnabled() || state.recTouched);
  const boardPositions = previewing ? positionsOf(state.rec) : state.positions;
  const ghosts = previewing
    ? boardPositions.map((p, i) => (p !== state.rec.baseline[i] ? state.rec.baseline[i] : null))
    : null;
  const hasGhost = !!ghosts && ghosts.some((g) => g != null);
  const activeDir = isActive && state.rec ? (state.rec.deltaI === 1 ? 'L' : 'R') : null;

  const head = document.createElement('div');
  head.className = 'ap-card';
  const suggestHtml =
    suggestEnabled() && suggestion && suggestion.type === 'probe' && suggestion.plate !== active
      ? `<div class="muted" style="margin-top:6px">Suggested: <b style="color:var(--gold)">${plateLabel(
          suggestion.plate
        )}</b> ${suggestion.safe ? '✓ safe to press' : '⚠ may jam at an edge'}
        <span class="ap-btn" data-action="select-plate" data-plate="${suggestion.plate}" style="margin-left:6px">Select ›</span></div>`
      : '';
  // Live edge coaching, recomputed from committed positions every render.
  const coachHtml = done ? '' : `<div class="coach muted" style="margin-top:6px">${coachingMessage(state.positions)}</div>`;
  // The edge-clearing plan (tier 2 of recommendNext), rendered as a Done/Skip panel.
  // A Skip is remembered against the current positions so it stays dismissed until the
  // board changes (Save, or a Done'd move); any position change re-offers it.
  const planPending =
    suggestEnabled() && suggestion && suggestion.type === 'plan' && state.skipPlanKey !== state.positions.join(',');
  const planHtml = planPending
    ? `<div class="plan-suggest" style="margin-top:6px">
        <div class="muted">${suggestion.reason}</div>
        <div style="margin:4px 0;color:#fff">${suggestion.moves
          .map((mv) => `${plateLabel(mv.plate)} <span class="dir">${dirArrow(mv.dir)} ${DIR_WORD[mv.dir]}</span>`)
          .join(' · ')}</div>
        <span class="ap-btn primary" data-action="plan-done">Done ›</span>
        <span class="ap-btn" data-action="plan-skip">Skip</span>
       </div>`
    : '';
  const headBody = isActive
    ? `<div class="muted">For <b style="color:var(--gold)">${plateLabel(active)}</b>: press it in game, then mark how each
        <i>other</i> plate moves — <span style="color:var(--goal)">Moves with</span> = same direction,
        <span style="color:var(--danger)">Moves opposite</span> = the other way.</div>
       <div style="margin-top:6px;font-size:14px;color:#fff">Recording <b style="color:var(--gold)">${plateLabel(active)}</b></div>`
    : `<div class="muted">All plates mapped (green). Click any plate to review or fix it, or continue to Solve.</div>`;
  // The suggested press for the active plate, stated explicitly (direction follows the
  // recording's live deltaI). The board previews it as a ghost → solid move.
  const moveHintHtml = suggestEnabled() && isActive && state.rec
    ? `<div style="margin-top:6px;font-size:14px;color:#fff">Suggested move: press <b style="color:var(--gold)">${plateLabel(active)}</b>
        <span class="dir">${dirArrow(activeDir)} ${DIR_WORD[activeDir]}</span> — do it in the lock, then record what moved.</div>`
    : '';
  // Legend explaining the ghost, shown only while a previewed move is on the board.
  const ghostLegendHtml = hasGhost
    ? `<div class="muted" style="margin-top:4px;font-size:12px">On the board, the <b style="color:var(--gold);font-weight:600">dashed</b> slide marks where a plate is <i>now</i>; the solid slide is where the press lands.</div>`
    : '';
  const title = done ? `Map the lock · all ${m.n} mapped ✓` : `Map the lock · ${mapped} of ${m.n} mapped`;
  // Per-user toggle: off hides the app's move guidance (preview, suggested-press text,
  // recommended-plate jump, Done/Skip plan) but keeps the edge/jam warning.
  const suggestToggleHtml = `<label class="ap-kbd" style="margin-top:4px"><input type="checkbox" data-action="toggle-suggest"${suggestEnabled() ? ' checked' : ''}> Suggest moves</label>`;
  head.innerHTML = `<div class="ap-h">${title}</div>${suggestToggleHtml}${headBody}${moveHintHtml}${coachHtml}${ghostLegendHtml}${suggestHtml}${planHtml}`;
  col.appendChild(head);

  const boardHost = document.createElement('div');
  col.appendChild(boardHost);

  // Manual reposition: apply a known move (a press of an already-mapped plate) to the live
  // positions — e.g. to pull a slide off an edge before mapping it. Only legal (in-bounds)
  // presses of mapped plates (whose full coupling is known) are offered. Always available,
  // independent of the Suggest-moves toggle and the auto edge-clearing plan.
  const knownMoves = [];
  if (!done) {
    for (let i = 0; i < m.n; i++) {
      if (m.status[i] !== 'done') continue;
      for (const dir of ['L', 'R']) {
        if (isLegal(state.positions, m.coupling, i, dir)) knownMoves.push({ plate: i, dir });
      }
    }
  }
  if (knownMoves.length) {
    const moveCard = document.createElement('div');
    moveCard.className = 'ap-card';
    moveCard.innerHTML = `<div class="ap-h">Move slides — apply a known move</div>
      <div class="muted" style="margin:2px 0 8px;font-size:12px">Reposition with moves you've already mapped (do these in the lock too) — e.g. to pull a slide off an edge before mapping it.</div>
      <div class="ms-btns">${knownMoves
        .map((mv) => `<span class="ap-btn" data-action="apply-move" data-plate="${mv.plate}" data-dir="${mv.dir}">${plateLabel(mv.plate)} <span class="dir">${dirArrow(mv.dir)} ${DIR_WORD[mv.dir]}</span></span>`)
        .join('')}</div>`;
    col.appendChild(moveCard);
  }

  const rowsRight = state.positions.map((_, i) => {
    if (i === active) return `<span class="self-note">the plate you're moving</span>`;
    if (active == null) return '';
    const r = state.rec ? tagOf(state.rec, i) : 'none';
    return `<div class="rel">
      <span class="rel-btn ${r === 'with' ? 'on-with' : ''}" data-action="set-rel" data-plate="${i}" data-rel="with">Moves with</span>
      <span class="rel-btn ${r === 'opposite' ? 'on-opp' : ''}" data-action="set-rel" data-plate="${i}" data-rel="opposite">Moves opposite</span>
    </div>`;
  });

  const foot = document.createElement('div');
  foot.className = 'ap-card';
  const recInvalid = isActive && !!state.rec && !validRecording(state.rec);
  const saveBlock = isActive
    ? `${recInvalid ? `<div class="note" style="margin-top:0;color:var(--danger)">⚠ This tag would push a slide past an edge. A successful press can't do that — it's a jam. Re-tag, or clear the edge first.</div>` : ''}<span class="ap-btn primary${recInvalid ? ' disabled' : ''}" data-action="save-next">Save plate ›</span>
       <div class="muted" style="margin-top:8px">Saved plates turn <span style="color:var(--goal)">green</span>.</div>
       <div class="note" style="margin-top:10px">If pressing a plate jams at an edge, you won't see its real connections — press the
         other direction, or move that plate toward center first, then map it.</div>`
    : '';
  const solveBlock = done
    ? `<div style="${isActive ? 'margin-top:12px' : ''}"><span class="ap-btn primary" data-action="goto-solve">Solve ›</span></div>`
    : '';
  foot.innerHTML = saveBlock + solveBlock;
  col.appendChild(foot);

  // Labels go green once a plate is saved, and show the move as "start → landing" for
  // any plate the in-progress recording shifts (matching the board's ghost → solid).
  const labels = boardPositions.map((p, i) => {
    const moved = previewing && p !== state.rec.baseline[i];
    const val = moved ? `${state.rec.baseline[i]} → ${p}` : `${p}`;
    return `<b${m.status[i] === 'done' ? ' class="done"' : ''}>P${i + 1}</b> · ${val}`;
  });
  createBoard(boardHost, {
    positions: boardPositions,
    ghosts,
    selectable: true,
    draggable: active != null,
    onSetPosition: onMapDrag,
    onClick: onMapClick,
    highlightPlate: active,
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
      ${contentsEditorHtml(state.contents)}`;
    side.appendChild(card);
    if (state.plan.length) side.appendChild(planCardEl());
    return boardProps;
  }

  const next = state.plan[state.planIndex];
  const remaining = state.plan.length - state.planIndex;
  boardProps.highlightPlate = next.plate;
  boardProps.highlightKind = 'next';

  const nextCard = document.createElement('div');
  nextCard.className = 'ap-card';
  nextCard.innerHTML = `
    <div class="ap-nm-label">Next move · ${remaining} left</div>
    <div class="ap-nm">${plateLabel(next.plate)} <span class="dir">${dirArrow(next.dir)} ${DIR_WORD[next.dir]}</span>
      <span class="badge safe">✓ safe</span></div>
    <div class="ap-nm-sub">${describeMove(coupling, state.positions, next.plate, next.dir)}. No plate hits an edge.</div>
    <div style="margin-top:12px">
      <span class="ap-btn primary" data-action="did-it">Did it ›</span>
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
  const rows = coupling
    .map((row, i) => {
      const chips = row
        .map((v, j) =>
          j === i
            ? ''
            : v === 1
            ? `<span class="chip with">${plateLabel(j)} with</span>`
            : v === -1
            ? `<span class="chip opp">${plateLabel(j)} opposite</span>`
            : ''
        )
        .filter(Boolean)
        .join('');
      return `<div class="cpl-card"><span class="mv">Slide <b>${plateLabel(i)}</b></span><span>${chips || '<span class="muted">— no links</span>'}</span></div>`;
    })
    .join('');
  card.innerHTML = `<div class="ap-h">Connections · reference</div>${rows}`;
  return card;
}

// ---------- events ----------

const clampN = (n) => Math.max(N_MIN, Math.min(N_MAX, n));

function resizeN(n) {
  state.n = n;
  state.positions = Array.from({ length: n }, (_, i) => state.positions[i] ?? GOAL);
}

appEl.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;

  switch (a) {
    case 'n-dec': resizeN(clampN(state.n - 1)); break;
    case 'n-inc': resizeN(clampN(state.n + 1)); break;
    case 'start-mapping':
      if (!state.mapping || state.mapping.n !== state.n) state.mapping = createMapping(state.n);
      state.initial = state.positions.slice(); // the setup positions are the lock's reset point
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
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; state.rec = null; suggestDefault(); }
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
      if (state.initial) {
        state.positions = state.initial.slice();
        if (state.stage === 'solve') state.plan = undefined; // re-plan from the reset point
      }
      break;

    case 'select-plate': {
      const p = +t.dataset.plate;
      state.activePlate = p;
      state.rec = createRecording(state.positions, p, relFromMapping(p));
      break;
    }
    case 'set-rel':
      if (state.rec) { state.rec = toggleTag(state.rec, +t.dataset.plate, t.dataset.rel); state.recTouched = true; }
      break;
    case 'save-next': saveActivePlate(); break;

    case 'plan-done': {
      // Apply the known edge-clearing sequence to the live positions, then re-seed.
      const rec = allMapped(state.mapping) ? null : recommendNext(state.positions, state.mapping);
      if (rec && rec.type === 'plan') {
        state.positions = applySequence(state.positions, state.mapping.coupling, rec.moves);
        state.skipPlanKey = undefined; // positions changed; future plans are fresh
        suggestDefault();
      }
      break;
    }
    case 'plan-skip':
      state.skipPlanKey = state.positions.join(','); // dismiss until positions change
      break;
    case 'apply-move': {
      // Manually apply a known move (press of a mapped plate) to reposition the slides.
      const plate = +t.dataset.plate;
      const dir = t.dataset.dir;
      if (state.mapping.status[plate] === 'done' && isLegal(state.positions, state.mapping.coupling, plate, dir)) {
        state.positions = applyMove(state.positions, state.mapping.coupling, plate, dir);
        state.skipPlanKey = undefined; // positions changed → re-offer any edge plan
        if (state.activePlate != null) {
          // re-base the in-progress recording against the new positions
          state.rec = createRecording(state.positions, state.activePlate, relFromMapping(state.activePlate));
          state.recTouched = false;
        }
      }
      break;
    }

    case 'did-it':
      if (state.plan && state.planIndex < state.plan.length) {
        state.planIndex++;
        state.positions = computeSolvePositions();
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
      state.editing = false;
      state.editBackup = undefined;
      state.initial = state.positions.slice(); // corrected positions become the new reset point
      state.plan = undefined;
      break;
    case 'cancel-edit': discardPendingEdit(); break;
    case 'back-to-map': state.stage = 'discovery'; break;
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
    return;
  }
  // update text fields + autosave without re-rendering (keeps the input focused)
  if (e.target.closest('[data-action="loc-input"]')) activeName().location = e.target.value;
  else if (e.target.closest('[data-action="desc-input"]')) activeName().description = e.target.value;
  else return;
  persistName(); // syncLock (create) or saveLock (editor); refreshes the active nameConflict
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
    state.positions = state.initial.slice();
    if (state.stage === 'solve') state.plan = undefined;
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
