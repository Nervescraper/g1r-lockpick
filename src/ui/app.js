import { createBoard } from './board.js';
import { nextActivePlate } from './active-plate.js';
import { applyMove, moveDelta, isSolved, GOAL } from '../model.js';
import { solve } from '../solver.js';
import { findCycles } from '../cycles.js';
import { createMapping, recommendNext, allMapped } from '../discovery.js';
import {
  loadLocks, saveLock, getLock, deleteLock, loadSession, saveSession, loadSettings, saveSettings,
  exportLocks, encodeShare, parseImport, classifyImport, sameIdentity, sanitizeContents,
} from '../storage.js';

const store = window.localStorage;
const N_MIN = 3;
const N_MAX = 8;
const DIR_WORD = { L: 'Left', R: 'Right' };

const appEl = document.getElementById('app');

let state = restore();
let settings = loadSettings(store);
const kbdEnabled = () => settings.keyboardShortcuts !== false; // on by default
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
    rel: {},
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

function composeName() {
  return [(state.location || '').trim(), state.kind, (state.description || '').trim()].filter(Boolean).join(' · ') || 'Unnamed lock';
}

// Another saved lock (not this one) with the same location + type + description.
function findDuplicate() {
  const me = { location: state.location, kind: state.kind, description: state.description };
  return loadLocks(store).find((l) => l.id !== state.lockId && sameIdentity(l, me)) || null;
}

function nameWarningHtml() {
  return state.nameConflict
    ? `<div class="note" style="border-left-color:var(--danger);margin-top:8px">A lock “${escapeHtml(
        state.nameConflict
      )}” already has the same location, type, and description. Load it from the left, or change the details to save a new one.</div>`
    : '';
}

// Once the lock is identifiable (a location or description), keep its saved record current —
// unless it would duplicate an existing lock, in which case refuse and flag a conflict.
function syncLock() {
  if (!(state.location || '').trim() && !(state.description || '').trim()) { state.nameConflict = null; return; }
  const dup = findDuplicate();
  if (dup) { state.nameConflict = dup.name; return; }
  state.nameConflict = null;
  if (!state.lockId) state.lockId = `lock-${Date.now()}`;
  saveLock(store, {
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
  });
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
  const rec = recommendNext(state.positions, m);
  if (rec && rec.type === 'probe') next = rec.plate;
  state.activePlate = next;
  state.rel = next == null ? {} : relFromMapping(next);
}

function saveActivePlate() {
  const a = state.activePlate;
  const row = state.mapping.coupling[a].map(() => 0);
  row[a] = 1; // the plate moves itself, by definition
  for (const j of Object.keys(state.rel)) row[+j] = state.rel[j] === 'with' ? 1 : -1;
  state.mapping.coupling[a] = row;
  state.mapping.status[a] = 'done';
  suggestDefault();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      <span class="ap-kbd-tip" data-tip="Advance:  Enter · Space · ↓ · →&#10;Back:  ↑ · ← · Backspace&#10;Reset pins:  R">Keyboard shortcuts</span></label>`;
  wrap.appendChild(footer);

  appEl.appendChild(wrap);
  reserveMoveDescHeight();
  alignCycleBraces();
  positionCycleCounts();
  fitPlanList();
  scrollCurrentStepIntoView();
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
function alignCycleBraces() {
  const list = appEl.querySelector('.ap-steplist');
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
function positionCycleCounts() {
  const list = appEl.querySelector('.ap-steplist');
  if (!list) return;
  for (const group of list.querySelectorAll('.cyc-group')) {
    const count = group.querySelector('.cyc-count');
    const cur = group.querySelector('.cur');
    if (cur) {
      count.style.alignSelf = 'flex-start';
      count.style.marginTop = `${cur.getBoundingClientRect().top - group.getBoundingClientRect().top}px`;
    } else {
      count.style.alignSelf = '';
      count.style.marginTop = '';
    }
  }
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
function scrollCurrentStepIntoView() {
  const list = appEl.querySelector('.ap-steplist');
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

// The location/type/description fields, reused on the Lock step.
function namingWidgetHtml() {
  return `
    <div class="muted" style="margin-bottom:4px">General location</div>
    <div class="fill-row">
      ${['Old Camp', 'New Camp', 'Swamp Camp', 'Orc Camp']
        .map((loc) => `<button class="ap-btn loc-fill${state.location === loc ? ' primary' : ''}" data-action="loc-fill" data-loc="${loc}">${loc}</button>`)
        .join('')}
    </div>
    <input class="lock-name-input" type="text" data-action="loc-input" placeholder="General location…" value="${escapeHtml(state.location || '')}" />
    <div class="muted" style="margin:10px 0 4px">Type</div>
    <div class="kind-row">
      ${['Chest', 'Door', 'Other']
        .map((k) => `<label class="kind-opt" data-action="kind-set" data-kind="${k}"><input type="radio" name="kind" ${state.kind === k ? 'checked' : ''}/> ${k}</label>`)
        .join('')}
    </div>
    <div class="muted" style="margin:10px 0 4px">Description (optional)</div>
    <input class="lock-name-input" type="text" data-action="desc-input" placeholder="e.g. behind the throne" value="${escapeHtml(state.description || '')}" />
    <div id="name-warning">${nameWarningHtml()}</div>`;
}

// The contents (loot) list is edited in two places — the Solve "Lock open!" screen
// (state.contents) and a saved lock's dedicated editor (state.contentsEdit.items). This
// returns whichever array the current screen is editing so the row handlers stay shared.
function activeContents() {
  return state.stage === 'contents' ? state.contentsEdit.items : state.contents;
}

// Write the edited contents back to its lock record, cleaned. The on-screen buffer keeps
// any blank/in-progress row (the UI renders from it), but the stored record never does.
function persistContents() {
  if (state.stage === 'contents') {
    const base = getLock(store, state.contentsEdit.id);
    if (base) saveLock(store, { ...base, contents: sanitizeContents(state.contentsEdit.items) });
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

// The dedicated editor for a saved lock's contents, reached by the ✎ icon in its row.
function contentsView() {
  const ed = state.contentsEdit;
  const lock = ed ? getLock(store, ed.id) : null;
  const col = document.createElement('div');
  col.className = 'lock-col import-col';
  const card = document.createElement('div');
  card.className = 'ap-card';
  card.innerHTML = `<div class="ap-h">Contents</div>
    <div class="muted" style="margin-bottom:10px">${escapeHtml(lock ? lock.name : 'Lock')}</div>
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
      ? `<div class="lock-list">${locks.map(lockRowHtml).join('')}</div>`
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
  for (const l of fresh) { saveLock(store, l); newCount++; }
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
      saveLock(store, { ...c.incoming, id: `lock-${Date.now()}-${i}` });
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
  if (state.rel == null) state.rel = {};
  if (state.activePlate === undefined) suggestDefault();

  const active = state.activePlate;
  const mapped = m.status.filter((s) => s === 'done').length;
  const suggestion = allMapped(m) ? null : recommendNext(state.positions, m);

  const col = document.createElement('div');
  col.className = 'map-wrap';

  const isActive = active != null;
  const done = allMapped(m);
  const head = document.createElement('div');
  head.className = 'ap-card';
  const suggestHtml =
    suggestion && suggestion.type === 'probe' && suggestion.plate !== active
      ? `<div class="muted" style="margin-top:6px">Suggested: <b style="color:var(--gold)">${plateLabel(
          suggestion.plate
        )}</b> ${suggestion.safe ? '✓ safe to press' : '⚠ may jam at an edge'}
        <span class="ap-btn" data-action="select-plate" data-plate="${suggestion.plate}" style="margin-left:6px">Select ›</span></div>`
      : '';
  const headBody = isActive
    ? `<div class="muted">For <b style="color:var(--gold)">${plateLabel(active)}</b>: press it in game, then mark how each
        <i>other</i> plate moves — <span style="color:var(--goal)">Moves with</span> = same direction,
        <span style="color:var(--danger)">Moves opposite</span> = the other way.</div>
       <div style="margin-top:6px;font-size:14px;color:#fff">Recording <b style="color:var(--gold)">${plateLabel(active)}</b></div>`
    : `<div class="muted">All plates mapped (green). Click any plate to review or fix it, or continue to Solve.</div>`;
  const title = done ? `Map the lock · all ${m.n} mapped ✓` : `Map the lock · ${mapped} of ${m.n} mapped`;
  head.innerHTML = `<div class="ap-h">${title}</div>${headBody}${suggestHtml}`;
  col.appendChild(head);

  const boardHost = document.createElement('div');
  col.appendChild(boardHost);

  const rowsRight = state.positions.map((_, i) => {
    if (i === active) return `<span class="self-note">the plate you're moving</span>`;
    if (active == null) return '';
    const r = state.rel[i];
    return `<div class="rel">
      <span class="rel-btn ${r === 'with' ? 'on-with' : ''}" data-action="set-rel" data-plate="${i}" data-rel="with">Moves with</span>
      <span class="rel-btn ${r === 'opposite' ? 'on-opp' : ''}" data-action="set-rel" data-plate="${i}" data-rel="opposite">Moves opposite</span>
    </div>`;
  });

  const foot = document.createElement('div');
  foot.className = 'ap-card';
  const saveBlock = isActive
    ? `<span class="ap-btn primary" data-action="save-next">Save plate ›</span>
       <div class="muted" style="margin-top:8px">Saved plates turn <span style="color:var(--goal)">green</span>.</div>
       <div class="note" style="margin-top:10px">If pressing a plate jams at an edge, you won't see its real connections — press the
         other direction, or move that plate toward center first, then map it.</div>`
    : '';
  const solveBlock = done
    ? `<div style="${isActive ? 'margin-top:12px' : ''}"><span class="ap-btn primary" data-action="goto-solve">Solve ›</span></div>`
    : '';
  foot.innerHTML = saveBlock + solveBlock;
  col.appendChild(foot);

  // labels go green once a plate is saved
  const labels = state.positions.map((p, i) => `<b${m.status[i] === 'done' ? ' class="done"' : ''}>P${i + 1}</b> · ${p}`);
  createBoard(boardHost, { positions: state.positions, selectable: true, highlightPlate: active, labels, rowsRight });
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

// Expanded: list every move of the run.
function expandedSegHtml(seg) {
  if (seg.type === 'single') return stepRowHtml(seg.index);
  let rows = '';
  for (let i = seg.start; i < seg.start + seg.length; i++) rows += stepRowHtml(i);
  return cycleGroupHtml(rows, seg);
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
      state.rel = {};
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
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; suggestDefault(); }
      else if (target === 'solve' && state.mapping) { state.stage = 'solve'; state.plan = undefined; }
      break;
    }
    case 'loc-fill': state.location = state.location === t.dataset.loc ? '' : t.dataset.loc; break;
    case 'kind-set': state.kind = t.dataset.kind; break;
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
      state.rel = relFromMapping(p);
      break;
    }
    case 'set-rel': {
      const p = +t.dataset.plate;
      const r = t.dataset.rel;
      if (state.rel[p] === r) delete state.rel[p];
      else state.rel[p] = r;
      break;
    }
    case 'save-next': saveActivePlate(); break;

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
        state.rel = {};
        if (state.stage === 'discovery') suggestDefault();
      }
      break;
    }
    case 'toggle-kbd':
      settings.keyboardShortcuts = !kbdEnabled();
      saveSettings(store, settings);
      break;
    case 'toggle-collapse':
      settings.collapseCycles = !settings.collapseCycles;
      saveSettings(store, settings);
      break;
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
    case 'content-add': activeContents().push({ item: '', qty: 1 }); persistContents(); break;
    case 'content-del': activeContents().splice(+t.dataset.i, 1); persistContents(); break;
    case 'edit-contents': {
      const lock = getLock(store, t.dataset.id);
      if (lock) {
        state.stage = 'contents';
        state.contentsEdit = { id: lock.id, items: (Array.isArray(lock.contents) ? lock.contents : []).map((c) => ({ ...c })) };
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
  if (e.target.closest('[data-action="loc-input"]')) state.location = e.target.value;
  else if (e.target.closest('[data-action="desc-input"]')) state.description = e.target.value;
  else return;
  persist(); // runs syncLock, which updates state.nameConflict
  const w = document.getElementById('name-warning');
  if (w) w.innerHTML = nameWarningHtml();
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd/Ctrl+R etc. for the browser
  if (!kbdEnabled() || isNarrowViewport()) return;
  const tag = (e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't hijack typing or the toggle

  // R — reset the pins to the lock's starting positions
  if (e.key === 'r' || e.key === 'R') {
    if (!state.initial) return;
    state.positions = state.initial.slice();
    if (state.stage === 'solve') state.plan = undefined;
    e.preventDefault();
    render();
    return;
  }

  // Setup / Edit-positions — digits set the active plate's pin; arrows move the cursor.
  if (isPositionEditing()) {
    if (handlePositionKey(e.key)) { e.preventDefault(); render(); }
    return; // these contexts consume no plan-stepping keys
  }

  // Step through the plan while solving. Advance: Enter / Space / ↓ / →. Back: ↑ / ←.
  if (state.stage !== 'solve' || state.editing || !Array.isArray(state.plan)) return;
  const advance = ['Enter', ' ', 'Spacebar', 'ArrowDown', 'ArrowRight'].includes(e.key);
  const back = ['ArrowUp', 'ArrowLeft', 'Backspace'].includes(e.key);
  if (!advance && !back) return;
  e.preventDefault();
  if (advance && state.planIndex < state.plan.length) state.planIndex++;
  else if (back && state.planIndex > 0) state.planIndex--;
  else return; // already at an end — nothing changes
  state.positions = computeSolvePositions();
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

window.addEventListener('resize', fitPlanList);

render();
