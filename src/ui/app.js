import { createBoard } from './board.js';
import { applyMove, moveDelta, isSolved, GOAL } from '../model.js';
import { solve } from '../solver.js';
import { createMapping, recommendNext, allMapped } from '../discovery.js';
import { loadLocks, saveLock, getLock, deleteLock, loadSession, saveSession, loadSettings, saveSettings } from '../storage.js';

const store = window.localStorage;
const N_MIN = 3;
const N_MAX = 8;
const DIR_WORD = { L: 'Left', R: 'Right' };

const appEl = document.getElementById('app');

let state = restore();
let flash = '';
let settings = loadSettings(store);
const kbdEnabled = () => settings.keyboardShortcuts !== false; // on by default

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
    lockId: undefined,
    lockLoaded: false,
  };
}

function persist() {
  const { stage, n, positions, initial, mapping, location, kind, description, lockId, lockLoaded, plan, planIndex, solveStart } = state;
  saveSession(store, { stage, n, positions, initial, mapping, location, kind, description, lockId, lockLoaded, plan, planIndex, solveStart });
  syncLock();
}

function composeName() {
  return [(state.location || '').trim(), state.kind, (state.description || '').trim()].filter(Boolean).join(' · ') || 'Unnamed lock';
}

// Another saved lock (not this one) with the same location + type + description.
function findDuplicate() {
  const loc = (state.location || '').trim().toLowerCase();
  const desc = (state.description || '').trim().toLowerCase();
  return (
    loadLocks(store).find(
      (l) =>
        l.id !== state.lockId &&
        (l.location || '').trim().toLowerCase() === loc &&
        (l.kind || 'Chest') === state.kind &&
        (l.description || '').trim().toLowerCase() === desc
    ) || null
  );
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
    if (state.stage === 'setup') side.appendChild(setupPanel());
    else if (state.stage === 'solve') boardProps = solvePanel(side, boardProps);

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

// Keep the current plan step one line down from the top of the steplist, so the
// previous step stays visible for context (the whole app re-renders each action,
// which would otherwise snap the list back to the top).
function scrollCurrentStepIntoView() {
  const list = appEl.querySelector('.ap-steplist');
  if (!list) return;
  const cur = list.querySelector('.cur');
  if (cur) {
    list.scrollTop = cur.offsetTop - list.offsetTop - cur.offsetHeight; // clamps at 0
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

function positionScale(plate, value) {
  let cells = '';
  for (let v = 1; v <= 7; v++) {
    const cls = ['sc', v === value ? 'cur' : '', v === 4 ? 'goal' : ''].filter(Boolean).join(' ');
    cells += `<span class="${cls}" data-action="pos-set" data-plate="${plate}" data-val="${v}">${v}</span>`;
  }
  return cells;
}

function positionRows() {
  return state.positions
    .map((p, i) => `<div class="prow"><span class="pl">P${i + 1}</span><div class="scale">${positionScale(i, p)}</div></div>`)
    .reverse()
    .join('');
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

// First step: EITHER load a saved lock (left) OR start a new one (right).
function lockStep() {
  const holder = document.createElement('div');
  const intro = document.createElement('div');
  intro.className = 'lock-intro';
  intro.textContent = 'Either load a saved lock, or start a new one.';
  holder.appendChild(intro);

  const main = document.createElement('div');
  main.className = 'ap-main';

  const locks = loadLocks(store).filter((l) => l.id !== state.lockId);
  const left = document.createElement('div');
  left.className = 'lock-col';
  left.innerHTML = `<div class="ap-card">
    <div class="ap-h">Load a saved lock</div>
    ${locks.length
      ? `<div class="lock-list">${locks
          .map(
            (l) =>
              `<div class="lock-item"><span data-action="load-lock" data-id="${l.id}" style="cursor:pointer">${escapeHtml(
                l.name
              )} <span class="muted">(${l.n} plates)</span></span><span class="x" data-action="del-lock" data-id="${l.id}">✕</span></div>`
          )
          .join('')}</div>`
      : '<div class="muted">No saved locks yet — start a new one on the right →</div>'}
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
    ${positionRows()}
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

function planCardEl() {
  const steps = state.plan
    .map((mv, i) => {
      const cls = i < state.planIndex ? 'past' : i === state.planIndex ? 'cur' : '';
      const check = i < state.planIndex ? ' ✓' : '';
      return `<div class="${cls}" data-action="goto-step" data-i="${i}">${i + 1} · ${plateLabel(
        mv.plate
      )} <span class="step-arrow">${dirArrow(mv.dir)}</span> ${DIR_WORD[mv.dir]}${check}</div>`;
    })
    .join('');
  const card = document.createElement('div');
  card.className = 'ap-card';
  card.innerHTML = `<div class="ap-h">Plan · click a step to jump there</div><div class="ap-steplist">${steps}</div>`;
  return card;
}

function solvePanel(side, boardProps) {
  const coupling = state.mapping.coupling;

  if (state.editing) {
    const card = document.createElement('div');
    card.className = 'ap-card';
    card.innerHTML = `<div class="ap-h">Set the plates' current positions</div>${positionRows()}
      <div style="margin-top:12px"><span class="ap-btn primary" data-action="apply-edit">Apply ›</span></div>`;
    side.appendChild(card);
    return boardProps;
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
      <div style="margin-top:12px">
        <span class="ap-btn primary" data-action="save-lock">Save this lock</span>
        <span class="ap-btn" data-action="new-lock">New lock</span>
        <span class="flash">${flash}</span>
      </div>`;
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
      <span class="ap-btn" data-action="reset-pins">Reset pins (R)</span>
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
  flash = '';

  switch (a) {
    case 'n-dec': resizeN(clampN(state.n - 1)); break;
    case 'n-inc': resizeN(clampN(state.n + 1)); break;
    case 'pos-set': state.positions[+t.dataset.plate] = +t.dataset.val; break;
    case 'start-mapping':
      if (!state.mapping || state.mapping.n !== state.n) state.mapping = createMapping(state.n);
      state.initial = state.positions.slice(); // the setup positions are the lock's reset point
      state.activePlate = undefined;
      state.rel = {};
      state.stage = 'discovery';
      suggestDefault();
      break;
    case 'goto-solve': state.stage = 'solve'; state.editing = false; state.plan = undefined; break;
    case 'new-setup': {
      const dup = findDuplicate();
      if (dup) { state.nameConflict = dup.name; break; } // stay on Lock step; warning shows
      state.stage = 'setup';
      break;
    }
    case 'goto-stage': {
      const target = t.dataset.stage;
      if (target === 'lock') state.stage = 'lock';
      else if (target === 'setup') { state.stage = 'setup'; state.editing = false; }
      else if (target === 'discovery' && state.mapping) { state.stage = 'discovery'; state.activePlate = undefined; suggestDefault(); }
      else if (target === 'solve' && state.mapping) { state.stage = 'solve'; state.editing = false; state.plan = undefined; }
      break;
    }
    case 'new-lock': state = freshSetup(state.n); break;
    case 'loc-fill': state.location = state.location === t.dataset.loc ? '' : t.dataset.loc; break;
    case 'kind-set': state.kind = t.dataset.kind; break;
    case 'start-over':
      if (!state.mapping || window.confirm('Start over? This clears the current lock from the workspace (saved locks are kept).')) {
        state = freshSetup(state.n);
      }
      break;
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
    case 'edit-positions': state.editing = true; break;
    case 'apply-edit':
      state.editing = false;
      state.initial = state.positions.slice(); // corrected positions become the new reset point
      state.plan = undefined;
      break;
    case 'back-to-map': state.stage = 'discovery'; break;
    case 'save-lock': {
      if (!(state.location || '').trim() && !(state.description || '').trim()) {
        const d = prompt('Describe this lock (location / which chest):', '');
        if (!d) break;
        state.description = d;
      }
      const dup = findDuplicate();
      if (dup) { flash = `A lock “${dup.name}” with the same details already exists.`; break; }
      syncLock();
      flash = 'Saved.';
      break;
    }
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
        // jump straight to whatever step is next: Solve if fully mapped, else resume mapping
        state.stage = state.lockLoaded ? 'solve' : 'discovery';
        state.editing = false;
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
    case 'del-lock': {
      const id = t.dataset.id;
      const lock = getLock(store, id);
      if (!window.confirm(`Delete ${lock ? `"${lock.name}"` : 'this lock'}? This can't be undone.`)) break;
      deleteLock(store, id);
      if (state.lockId === id) { state.lockId = undefined; state.location = ''; state.kind = 'Chest'; state.description = ''; }
      break;
    }
    default: return;
  }
  render();
});

appEl.addEventListener('input', (e) => {
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
  if (!kbdEnabled()) return;
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

render();
