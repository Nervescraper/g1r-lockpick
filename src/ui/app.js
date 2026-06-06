import { createBoard } from './board.js';
import { applyMove, moveDelta, isSolved, GOAL } from '../model.js';
import { solve } from '../solver.js';
import { createMapping, recommendNext, applyProbe, probeSafe, allMapped } from '../discovery.js';
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
    record: {},
    outcome: 'moved',
    basic: false,
    editing: false,
    lockName: '',
    lockLoaded: false,
  };
}

function persist() {
  const { stage, n, positions, mapping, basic, lockName, lockLoaded } = state;
  saveSession(store, { stage, n, positions, mapping, basic, lockName, lockLoaded });
}

// ---------- helpers ----------

function plateLabel(i) {
  return `P${i + 1}`;
}

function shiftWord(delta) {
  return delta > 0 ? 'left' : 'right';
}

function describeMove(coupling, positions, plate, dir) {
  const d = moveDelta(coupling, plate, dir);
  const parts = [];
  for (let j = 0; j < d.length; j++) {
    if (d[j] === 0) continue;
    const from = positions[j];
    const to = from + d[j];
    const lead = j === plate ? 'shifts' : 'also shifts';
    parts.push(`${lead} ${plateLabel(j)} ${shiftWord(d[j])} (${from}→${to})`);
  }
  return parts.join(' · ');
}

function statusDot(s) {
  if (s === 'done') return 'done';
  if (s === 'partial') return 'part';
  return '';
}

// ---------- render ----------

function render() {
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap';
  wrap.appendChild(railEl());

  const main = document.createElement('div');
  main.className = 'ap-main';

  const boardCol = document.createElement('div');
  boardCol.className = 'ap-board';
  boardCol.appendChild(boardTopEl());
  const boardHost = document.createElement('div');
  boardCol.appendChild(boardHost);

  const side = document.createElement('div');
  side.className = 'ap-side';

  let boardProps = { positions: state.positions, basic: state.basic };
  if (state.stage === 'setup') side.appendChild(setupPanel());
  else if (state.stage === 'discovery') boardProps = discoveryPanel(side, boardProps);
  else if (state.stage === 'solve') boardProps = solvePanel(side, boardProps);

  main.appendChild(boardCol);
  main.appendChild(side);
  wrap.appendChild(main);
  appEl.appendChild(wrap);

  const board = createBoard(boardHost, boardProps);
  window.__align = board.align; // re-aligned on resize below
  persist();
}

function railEl() {
  const rail = document.createElement('div');
  rail.className = 'ap-rail';
  const stages = [
    ['setup', 'Setup'],
    ['discovery', 'Map the lock'],
    ['solve', 'Solve'],
  ];
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

function boardTopEl() {
  const top = document.createElement('div');
  top.className = 'ap-boardtop';
  const lbl = document.createElement('label');
  lbl.className = 'ap-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.basic;
  cb.addEventListener('change', () => { state.basic = cb.checked; render(); });
  lbl.appendChild(cb);
  lbl.appendChild(document.createTextNode(' 2D view'));
  top.appendChild(lbl);
  return top;
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

  const prows = state.positions
    .map((p, i) => `<div class="prow"><span class="pl">P${i + 1}</span><div class="scale">${positionScale(i, p)}</div></div>`)
    .reverse() // show P1 at the bottom, matching the board's front-to-back order
    .join('');

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
    ${prows}
    <div style="margin-top:12px">${primary}
      ${state.lockLoaded ? '<span class="ap-btn" data-action="new-lock">Start a new lock</span>' : ''}
    </div>
    ${lockListHtml}
  `;
  return card;
}

// ---------- Discovery ----------

function safeDefaultDir(plate) {
  if (probeSafe(state.positions, state.mapping, plate, 'L')) return 'L';
  if (probeSafe(state.positions, state.mapping, plate, 'R')) return 'R';
  return state.positions[plate] > 4 ? 'R' : 'L';
}

function observedFromCoupling(c, dir) {
  const v = dir === 'L' ? c : -c;
  return v === 1 ? 'L' : v === -1 ? 'R' : null;
}

// Rebuild the recorder marks for a plate from what's already stored, so revisiting a
// mapped plate shows its connections. The plate's own self-shift is implicit, not listed.
function recordFromMapping(plate, dir) {
  const row = state.mapping.coupling[plate];
  const rec = {};
  for (let j = 0; j < row.length; j++) {
    if (j === plate) continue;
    const s = observedFromCoupling(row[j], dir);
    if (s) rec[j] = s;
  }
  return rec;
}

// Pick the plate to record by default: the safe-ordered suggestion if any, else the
// first unmapped plate, else null (everything mapped). The user can override by clicking.
function suggestDefault() {
  const m = state.mapping;
  let next = null;
  for (let i = 0; i < m.n; i++) {
    if (m.status[i] !== 'done') { next = i; break; }
  }
  const rec = recommendNext(state.positions, m);
  if (rec && rec.type === 'probe') next = rec.plate;
  state.activePlate = next;
  state.probeDir = next == null ? 'L' : safeDefaultDir(next);
  state.record = next == null ? {} : recordFromMapping(next, state.probeDir);
}

function discoveryPanel(side, boardProps) {
  const m = state.mapping;
  if (state.record == null) state.record = {};
  if (state.outcome == null) state.outcome = 'moved';
  if (state.activePlate === undefined) suggestDefault();

  const mapped = m.status.filter((s) => s === 'done').length;
  const suggestion = allMapped(m) ? null : recommendNext(state.positions, m);
  const active = state.activePlate;

  // every plate clickable; the one being recorded is highlighted
  const labels = state.positions.map((p, i) => {
    const dotCls = m.status[i] === 'done' ? 'ok' : '';
    const tag = i === active ? ' ◀ recording' : '';
    return { html: `<b>P${i + 1}</b> · ${p}${tag}<span class="dot ${dotCls}"></span>`, active: i === active };
  });
  boardProps = { ...boardProps, labels, highlightPlate: active, selectable: true };

  let tip = '';
  if (suggestion && suggestion.type === 'prep') {
    tip = `<div class="note" style="border-left-color:var(--gold)">Tip: a plate is at an edge.
      Safe setup move <b>${plateLabel(suggestion.plate)} → ${DIR_WORD[suggestion.dir]}</b> pulls it toward center.
      <span class="ap-btn" data-action="prep-done" style="margin-left:6px">Do it ›</span></div>`;
  } else if (suggestion && suggestion.type === 'probe' && suggestion.plate !== active) {
    tip = `<div class="muted" style="margin-top:8px">Suggested: <b style="color:var(--gold)">${plateLabel(
      suggestion.plate)}</b> ${suggestion.safe ? '✓ safe' : '⚠ risky'}
      <span class="ap-btn" data-action="select-plate" data-plate="${suggestion.plate}" style="margin-left:6px">Record it ›</span></div>`;
  }

  const dotsHtml = `<div class="dots">${m.status.map((s) => `<i class="${statusDot(s)}"></i>`).join('')}</div>
    <div class="muted" style="margin-top:6px">● mapped &nbsp; ● not yet</div>`;
  const solveBtn = allMapped(m)
    ? '<div style="margin-top:12px"><span class="ap-btn primary" data-action="goto-solve">All mapped — Solve ›</span></div>'
    : '';

  const card = document.createElement('div');
  card.className = 'ap-card';

  if (active == null) {
    card.innerHTML = `<div class="ap-h">Map the lock · ${mapped} of ${m.n} mapped</div>
      <div class="muted">Tap any plate on the board to record its connections.</div>
      ${tip}${dotsHtml}${solveBtn}`;
    side.appendChild(card);
    return boardProps;
  }

  const safe = probeSafe(state.positions, m, active, state.probeDir);
  card.innerHTML = `
    <div class="ap-h">Map the lock · ${mapped} of ${m.n} mapped</div>
    <div style="font-size:15px;color:#fff;margin-bottom:2px">Recording <b style="color:var(--gold)">${plateLabel(active)}</b>
      <span class="muted" style="font-weight:400">— tap another plate to switch</span></div>
    <div class="muted" style="margin-bottom:6px">Press this direction on ${plateLabel(active)} once in game:</div>
    <div class="seg" style="margin-bottom:6px; align-items:center">
      <span class="${state.probeDir === 'L' ? 'on-l' : ''}" data-action="set-dir" data-dir="L">Left</span>
      <span class="${state.probeDir === 'R' ? 'on-r' : ''}" data-action="set-dir" data-dir="R">Right</span>
      <span class="badge ${safe ? 'safe' : 'risk'}">${safe ? "✓ won't block" : '⚠ risky'}</span>
    </div>
    <div class="outcome">
      <span class="${state.outcome === 'moved' ? 'on' : ''}" data-action="outcome" data-val="moved">Moved ✓</span>
      <span class="${state.outcome === 'blocked' ? 'on blk' : ''}" data-action="outcome" data-val="blocked">Blocked / shook ⚠</span>
    </div>
    ${state.outcome === 'moved' ? movedControls() : blockedControls()}
    ${tip}${dotsHtml}${solveBtn}
  `;
  side.appendChild(card);
  return boardProps;
}

function movedControls() {
  const active = state.activePlate;
  const rows = state.positions
    .map((_, j) => {
      if (j === active) {
        // placeholder so the row stays in place; the active plate moves itself
        const w = state.probeDir === 'L' ? '◀ left' : '▶ right';
        return `<div class="rec rec-self"><span class="pl">${plateLabel(j)}</span><span class="self-note">the plate you're moving — shifts ${w}</span></div>`;
      }
      const mark = state.record[j];
      const noMark = mark ? '' : '<span class="nomark">no shift seen</span>';
      return `<div class="rec"><span class="pl">${plateLabel(j)}</span><div class="seg">
        <span class="${mark === 'L' ? 'on-l' : ''}" data-action="rec-mark" data-plate="${j}" data-dir="L">◀ left</span>
        <span class="${mark === 'R' ? 'on-r' : ''}" data-action="rec-mark" data-plate="${j}" data-dir="R">▶ right</span>
      </div>${noMark}</div>`;
    })
    .reverse() // P1 at the bottom, matching the board
    .join('');
  return `
    <div class="muted" style="margin:6px 0">Mark each other plate you saw shift:</div>
    ${rows}
    <div style="margin-top:12px"><span class="ap-btn primary" data-action="save-next">Save ›</span></div>`;
}

function blockedControls() {
  const opp = state.probeDir === 'L' ? 'Right' : 'Left';
  return `
    <div class="note"><b>Blocked.</b> The game shakes only the stuck plate, hiding the others this move
      controls — so the row can't be read. Try pressing <b>${opp}</b> instead (toggle above), or first move
      the edge plate toward center, then retry. A blocked attempt costs 1 durability. Anything you already
      marked is kept.</div>`;
}

// ---------- Solve ----------

function solvePanel(side, boardProps) {
  const coupling = state.mapping.coupling;

  if (state.editing) {
    const card = document.createElement('div');
    card.className = 'ap-card';
    const prows = state.positions
      .map((p, i) => `<div class="prow"><span class="pl">P${i + 1}</span><div class="scale">${positionScale(i, p)}</div></div>`)
      .join('');
    card.innerHTML = `<div class="ap-h">Edit current positions</div>${prows}
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
      <div class="muted">The current mapping can't reach all-4 within bounds — a coupling cell is probably
        missing or wrong. Go back and re-check the mapping.</div>
      <div style="margin-top:12px">
        <span class="ap-btn" data-action="back-to-map">Back to mapping</span>
        <span class="ap-btn" data-action="edit-positions">Edit positions</span>
      </div>`;
    side.appendChild(card);
    return boardProps;
  }

  const next = plan[0];
  state.nextMove = next;
  const steps = plan
    .map((mv, i) => `<div class="${i === 0 ? 'cur' : ''}">${i + 1} · ${plateLabel(mv.plate)} → ${DIR_WORD[mv.dir]}${i === 0 ? '  ◀' : ''}</div>`)
    .join('');

  const nextCard = document.createElement('div');
  nextCard.className = 'ap-card';
  nextCard.innerHTML = `
    <div class="ap-nm-label">Next move · ${plan.length} left</div>
    <div class="ap-nm">${plateLabel(next.plate)} <span class="dir">→ ${DIR_WORD[next.dir]}</span>
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
          v === 1
            ? `<span class="chip left">${plateLabel(j)} ◀ left</span>`
            : v === -1
            ? `<span class="chip right">${plateLabel(j)} ▶ right</span>`
            : ''
        )
        .filter(Boolean)
        .join('');
      return `<div class="cpl-card"><span class="mv">Press <b>L</b> ${plateLabel(i)}</span><span>${chips || '<span class="muted">— no effect</span>'}</span></div>`;
    })
    .join('');
  card.innerHTML = `<div class="ap-h">Coupling (press Left →) · reference</div>${rows}
    <div class="ap-legend"><span class="left">◀ left</span> = pin +1 · <span class="right">▶ right</span> = pin −1</div>`;
  return card;
}

// ---------- events ----------

function clampN(n) {
  return Math.max(N_MIN, Math.min(N_MAX, n));
}

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
      state.record = {};
      state.outcome = 'moved';
      state.activePlate = undefined;
      state.stage = 'discovery';
      suggestDefault();
      break;
    case 'goto-solve': state.stage = 'solve'; state.editing = false; break;
    case 'new-lock': state = freshSetup(state.n); break;

    case 'select-plate': {
      const p = +t.dataset.plate;
      state.activePlate = p;
      state.probeDir = safeDefaultDir(p);
      state.record = recordFromMapping(p, state.probeDir); // restore prior marks
      state.outcome = 'moved';
      break;
    }
    case 'set-dir': {
      const d = t.dataset.dir;
      if (d !== state.probeDir) {
        // pressing the other direction inverts every observed shift
        const flipped = {};
        for (const k of Object.keys(state.record)) flipped[k] = state.record[k] === 'L' ? 'R' : 'L';
        state.record = flipped;
        state.probeDir = d;
      }
      break;
    }
    case 'outcome': state.outcome = t.dataset.val; break;
    case 'rec-mark': {
      const p = +t.dataset.plate;
      const d = t.dataset.dir;
      if (state.record[p] === d) delete state.record[p];
      else state.record[p] = d;
      break;
    }
    case 'save-next': {
      const p = state.activePlate;
      const dir = state.probeDir;
      // a Moved probe reveals the whole row at once, so rewrite it (unmarked = no connection)
      state.mapping.coupling[p] = state.mapping.coupling[p].map(() => 0);
      const rec = { ...state.record, [p]: dir }; // the active plate always moves itself
      state.positions = applyProbe(state.positions, state.mapping, p, dir, rec, { complete: true });
      state.outcome = 'moved';
      suggestDefault();
      break;
    }
    case 'prep-done': {
      const rec = recommendNext(state.positions, state.mapping);
      if (rec && rec.type === 'prep') {
        state.positions = applyMove(state.positions, state.mapping.coupling, rec.plate, rec.dir);
      }
      break;
    }

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

window.addEventListener('resize', () => { if (window.__align) window.__align(); });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

render();
