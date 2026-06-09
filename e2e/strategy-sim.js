// Offline dry-run of the harness's player strategy against the explore fixtures,
// to validate they force the intended flow (mistakes → pick break → reset →
// reposition via mapped moves) before driving the real UI.
//
//   node e2e/strategy-sim.js
import { LOCKS, EXPLORE_LOCKS } from './locks.js';
import { SimulatedLock } from './game.js';
import { applyMove, isLegal, MIN, MAX } from '../src/model.js';
import { createMapping, recordShifts, recommendNext, allMapped } from '../src/discovery.js';
import { solve, applySequence } from '../src/solver.js';

const towardCenter = (pos) => (pos > 4 ? 'R' : 'L');
const edgeCount = (positions) => positions.filter((v) => v <= MIN || v >= MAX).length;

// One mapping round of the player strategy. Returns an action description.
export function chooseAction({ positions, mapping, suggestion, blocked }) {
  const key = (plate, dir) => `${positions.join(',')}|${plate}${dir}`;
  if (suggestion && suggestion.type === 'plan') return { kind: 'plan', moves: suggestion.moves };

  // The app's suggested probe, unless the player already found it blocked here.
  if (suggestion && suggestion.type === 'probe' && !blocked.has(key(suggestion.plate, suggestion.dir))) {
    return { kind: 'probe', plate: suggestion.plate, dir: suggestion.dir };
  }

  // Deviate: another unmapped plate (interior ones first) not known to block here.
  const unmapped = [];
  for (let i = 0; i < mapping.n; i++) if (mapping.status[i] !== 'done') unmapped.push(i);
  unmapped.sort((a, b) => {
    const ea = positions[a] <= MIN || positions[a] >= MAX ? 1 : 0;
    const eb = positions[b] <= MIN || positions[b] >= MAX ? 1 : 0;
    return ea - eb;
  });
  for (const p of unmapped) {
    const toward = towardCenter(positions[p]);
    const away = toward === 'L' ? 'R' : 'L';
    for (const dir of [toward, away]) {
      // Never press a slide into the wall it already sits against.
      if (dir === 'L' && positions[p] >= MAX) continue;
      if (dir === 'R' && positions[p] <= MIN) continue;
      if (!blocked.has(key(p, dir))) return { kind: 'probe', plate: p, dir };
    }
  }

  // Everything probeable is known-blocked: reposition with a mapped move that
  // lowers the number of edge plates (the player can predict mapped rows).
  let best = null;
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') continue;
    for (const dir of ['L', 'R']) {
      if (!isLegal(positions, mapping.coupling, i, dir)) continue;
      const np = applyMove(positions, mapping.coupling, i, dir);
      const score = edgeCount(np);
      if (!best || score < best.score) best = { kind: 'move', plate: i, dir, score };
    }
  }
  return best; // null = truly stuck
}

export function simulate(lock, { maxRounds = 120 } = {}) {
  const game = new SimulatedLock(lock);
  const mapping = createMapping(lock.n);
  let positions = lock.initial.slice(); // the app's view (should track game exactly)
  const blocked = new Set();
  const events = [];
  let usedReposition = 0;
  let usedPlan = 0;

  for (let round = 0; round < maxRounds && !allMapped(mapping); round++) {
    const suggestion = recommendNext(positions, mapping);
    const act = chooseAction({ positions, mapping, suggestion, blocked });
    if (!act) { events.push('STUCK'); break; }

    if (act.kind === 'plan' || act.kind === 'move') {
      const moves = act.kind === 'plan' ? act.moves : [{ plate: act.plate, dir: act.dir }];
      if (act.kind === 'plan') usedPlan++; else usedReposition++;
      for (const mv of moves) {
        const r = game.press(mv.plate, mv.dir);
        if (r.blocked) { events.push(`KNOWN-MOVE BLOCKED P${mv.plate + 1}${mv.dir}`); return fail(); }
        positions = applyMove(positions, mapping.coupling, mv.plate, mv.dir);
      }
      events.push(`${act.kind} ${moves.map((m) => `P${m.plate + 1}${m.dir}`).join(',')}`);
      continue;
    }

    const r = game.press(act.plate, act.dir);
    if (r.blocked) {
      blocked.add(`${positions.join(',')}|${act.plate}${act.dir}`);
      if (r.broke) {
        positions = lock.initial.slice(); // player clicks Reset
        events.push(`probe P${act.plate + 1}${act.dir} BREAK+RESET`);
      } else {
        events.push(`probe P${act.plate + 1}${act.dir} blocked`);
      }
      continue;
    }
    const shifts = {};
    for (let j = 0; j < lock.n; j++) if (r.deltas[j] !== 0) shifts[j] = r.deltas[j] > 0 ? 'L' : 'R';
    recordShifts(mapping, act.plate, act.dir, shifts);
    mapping.status[act.plate] = 'done';
    positions = applyMove(positions, mapping.coupling, act.plate, act.dir);
    events.push(`probe P${act.plate + 1}${act.dir} ok`);
    if (positions.join(',') !== game.positions.join(',')) { events.push(`DRIFT app=[${positions}] game=[${game.positions}]`); return fail(); }
  }

  function fail() {
    return { ok: false, events, game, mapping, positions };
  }

  const mapped = allMapped(mapping);
  const couplingOk = mapped && JSON.stringify(mapping.coupling) === JSON.stringify(lock.coupling);
  const plan = mapped ? solve(positions, mapping.coupling) : null;
  const solved = plan ? applySequence(positions, lock.coupling, plan).every((v) => v === 4) : false;
  return {
    ok: mapped && couplingOk && !!plan && solved,
    mapped, couplingOk, solved,
    planLen: plan ? plan.length : null,
    mistakes: game.totalMistakes, breaks: game.breaks,
    usedReposition, usedPlan,
    events,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = false;
  for (const lock of [...LOCKS, ...EXPLORE_LOCKS]) {
    const r = simulate(lock);
    if (!r.ok) failed = true;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${lock.id}: mistakes=${r.mistakes} breaks=${r.breaks} repositions=${r.usedReposition} plans=${r.usedPlan} plan=${r.planLen ?? '—'}`);
    console.log('   ' + r.events.join(' | '));
  }
  process.exit(failed ? 1 : 0);
}
