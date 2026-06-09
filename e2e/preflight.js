// Sanity-check the lock fixtures against the project's own engine, without a
// browser: follow recommendNext as a truthful player would, confirm mapping
// completes with no jam (no plate ever pushed past an edge), then confirm the
// solver finds an edge-free plan from the mapped state.
//
//   node e2e/preflight.js
import { LOCKS } from './locks.js';
import { applyMove, moveDelta, isSolved, MIN, MAX } from '../src/model.js';
import { createMapping, recordShifts, recommendNext, allMapped } from '../src/discovery.js';
import { solve, applySequence } from '../src/solver.js';

function pressOutcome(positions, coupling, plate, dir) {
  const next = applyMove(positions, coupling, plate, dir);
  const jam = next.some((v) => v < MIN || v > MAX);
  return { next, jam };
}

let failed = false;

for (const lock of LOCKS) {
  let positions = lock.initial.slice();
  const mapping = createMapping(lock.n);
  let jams = 0;
  let steps = 0;
  const log = [];

  while (!allMapped(mapping) && steps++ < 200) {
    const rec = recommendNext(positions, mapping);
    if (!rec) break;
    if (rec.type === 'plan') {
      positions = applySequence(positions, mapping.coupling, rec.moves);
      log.push(`plan ${rec.moves.map((m) => `P${m.plate + 1}${m.dir}`).join(',')}`);
      continue;
    }
    const { next, jam } = pressOutcome(positions, lock.coupling, rec.plate, rec.dir);
    log.push(`probe P${rec.plate + 1}${rec.dir}${rec.safe ? '' : ' (risky)'}${jam ? ' JAM' : ''}`);
    if (jam) {
      jams++;
      positions = lock.initial.slice(); // pick breaks; pins snap back
      if (jams > 3) break;
      continue;
    }
    // Truthful observation: the true row is exactly what the player sees move.
    const shifts = {};
    const d = moveDelta(lock.coupling, rec.plate, rec.dir);
    for (let j = 0; j < lock.n; j++) if (d[j] !== 0) shifts[j] = d[j] > 0 ? 'L' : 'R';
    recordShifts(mapping, rec.plate, rec.dir, shifts);
    mapping.status[rec.plate] = 'done';
    positions = next;
  }

  const mapped = allMapped(mapping);
  const couplingOk = mapped && JSON.stringify(mapping.coupling) === JSON.stringify(lock.coupling);
  const plan = mapped ? solve(positions, mapping.coupling) : null;
  const solvedEnd = plan ? isSolved(applySequence(positions, lock.coupling, plan)) : false;
  const ok = mapped && couplingOk && plan && solvedEnd && jams === 0;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${lock.id}: mapped=${mapped} couplingOk=${couplingOk} jams=${jams} plan=${plan ? plan.length + ' moves' : 'none'} solved=${solvedEnd}`);
  if (!ok) console.log('  trace: ' + log.join(' | '));
}

process.exit(failed ? 1 : 0);
