import { createBoard } from './board.js';
import { applyMove, moveDelta, isSolved, GOAL } from '../model.js';
import { solve } from '../solver.js';
import { createMapping, recommendNext, allMapped } from '../discovery.js';
import { loadLocks, saveLock, getLock, deleteLock, loadSession, saveSession } from '../storage.js';

const store = window.localStorage;
const N_MIN = 3;
const N_MAX = 8;
const DIR_WORD = { L: 'Left', R: 'Right' };

const appEl = document.getElementById('app');

let state = restore();
let flash = '';

function restore() {
  const s = loadSession(store);
  if (s && s.stage) return s;
  return freshSetup(5);
}

function freshSetup(n) {
  return {
    stage: 'setup',
    n,
    positions: Array(n).fill(GOAL),
    mapping: null,
    rel: {},
    editing: false,
    lockName: '',
    lockLoaded: false,
  };
}

function persist() {
  const { stage, n, positions, mapping, lockName, lockLoaded } = state;
  saveSession(store, { stage, n, positions, mapping, lockName, lockLoaded });
}

// ---------- helpers ----------

const plateLabel = (i) => `P${i + 1}`;
const shiftWord = (delta) => (delta > 0 ? 'left' : 'right');

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
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap';
  wrap.appendChild(railEl());

  if (state.stage === 'discovery') {
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

  appEl.appendChild(wrap);
  persist();
}

function railEl() {
  const rail = document.createElement('div');
  rail.className = 'ap-rail';
  const stages = [['setup', 'Setup'], ['discovery', 'Map the lock'], ['solve', 'Solve']];
  const order = { setup: 0, discovery: 1, solve: 2 };
  for (const [key, label] of stages) {
    const span = document.createElement('span');
    span.textContent = (order[state.stage] > order[key] ? '✓ ' : '') + label;
    if (state.stage === key) span.className = 'active';
    else if (order[state.stage] > order[key]) span.className = 'done';
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

function setupPanel() {
  const card = document.createElement('div');
  card.className = 'ap-card';
  const locks = loadLocks(store);
  const lockListHtml = locks.length
    ? `<div class="ap-h" style="margin-top:14px">Saved locks</div><div class="lock-list">${locks
        .map(
          (l) =>
            `<div class="lock-item"><span data-action="load-lock" data-id="${l.id}" style="cursor:pointer">${escapeHtml(
              l.name
            )} <span class="muted">(${l.n} plates)</span></span><span class="x" data-action="del-lock" data-id="${l.id}">✕</span></div>`
        )
        .join('')}</div>`
    : '';

  const primary = state.lockLoaded
    ? `<span class="ap-btn primary" data-action="goto-solve">Solve ›</span>`
    : `<span class="ap-btn primary" data-action="start-mapping">Start mapping ›</span>`;

  card.innerHTML = `
    <div class="ap-h">New lock${state.lockLoaded ? ` — ${escapeHtml(state.lockName)} loaded` : ''}</div>
    <div class="cnt">
      <span class="muted">Plates</span>
      <button class="step" data-action="n-dec">−</button>
      <span class="num">${state.n}</span>
      <button class="step" data-action="n-inc">+</button>
      <span class="muted">(${N_MIN}–${N_MAX})</span>
    </div>
    <div class="ap-h">Current pin position of each plate</div>
    ${positionRows()}
    <div style="margin-top:12px">${primary}
      ${state.lockLoaded ? '<span class="ap-btn" data-action="new-lock">Start a new lock</span>' : ''}
    </div>
    ${lockListHtml}
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

  if (isSolved(state.positions)) {
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
    return boardProps;
  }

  const plan = solve(state.positions, coupling);
  if (plan === null) {
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

  const next = plan[0];
  state.nextMove = next;
  const dirArrow = (dir) => (dir === 'L' ? '◀' : '▶');
  const steps = plan
    .map(
      (mv, i) =>
        `<div class="step-line${i === 0 ? ' cur' : ''}"><span>${i + 1} · ${plateLabel(mv.plate)} ${DIR_WORD[mv.dir]}</span><span class="step-arrow">${dirArrow(mv.dir)}</span></div>`
    )
    .join('');

  const nextCard = document.createElement('div');
  nextCard.className = 'ap-card';
  nextCard.innerHTML = `
    <div class="ap-nm-label">Next move · ${plan.length} left</div>
    <div class="ap-nm">${plateLabel(next.plate)} <span class="dir">${dirArrow(next.dir)} ${DIR_WORD[next.dir]}</span>
      <span class="badge safe">✓ safe</span></div>
    <div class="ap-nm-sub">${describeMove(coupling, state.positions, next.plate, next.dir)}. No plate hits an edge.</div>
    <div style="margin-top:12px">
      <span class="ap-btn primary" data-action="did-it">Did it ›</span>
      <span class="ap-btn" data-action="edit-positions">Edit positions</span>
    </div>`;
  side.appendChild(nextCard);

  const planCard = document.createElement('div');
  planCard.className = 'ap-card';
  planCard.innerHTML = `<div class="ap-h">Plan</div><div class="ap-steplist">${steps}</div>`;
  side.appendChild(planCard);

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
      return `<div class="cpl-card"><span class="mv">Press <b>${plateLabel(i)}</b></span><span>${chips || '<span class="muted">— no links</span>'}</span></div>`;
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
      state.mapping = createMapping(state.n);
      state.activePlate = undefined;
      state.rel = {};
      state.stage = 'discovery';
      suggestDefault();
      break;
    case 'goto-solve': state.stage = 'solve'; state.editing = false; break;
    case 'new-lock': state = freshSetup(state.n); break;

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

    case 'did-it': {
      const mv = state.nextMove;
      state.positions = applyMove(state.positions, state.mapping.coupling, mv.plate, mv.dir);
      break;
    }
    case 'edit-positions': state.editing = true; break;
    case 'apply-edit': state.editing = false; break;
    case 'back-to-map': state.stage = 'discovery'; break;
    case 'save-lock': {
      const name = prompt('Name this lock:', state.lockName || 'Lock');
      if (name) {
        const id = state.lockId || `lock-${loadLocks(store).length + 1}-${name.replace(/\s+/g, '_')}`;
        state.lockId = id;
        state.lockName = name;
        saveLock(store, { id, name, n: state.mapping.n, coupling: state.mapping.coupling, notes: '' });
        flash = 'Saved.';
      }
      break;
    }
    case 'load-lock': {
      const lock = getLock(store, t.dataset.id);
      if (lock) {
        state.n = lock.n;
        state.positions = Array(lock.n).fill(GOAL);
        state.mapping = { n: lock.n, coupling: lock.coupling, status: Array(lock.n).fill('done') };
        state.lockId = lock.id;
        state.lockName = lock.name;
        state.lockLoaded = true;
      }
      break;
    }
    case 'del-lock': deleteLock(store, t.dataset.id); break;
    default: return;
  }
  render();
});

render();
