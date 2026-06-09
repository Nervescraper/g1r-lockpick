// Search random locks for one that forces the flow the harness must exercise:
// blocked probes (mistakes), at least one pick break (2nd mistake → reset), and
// at least one reposition of mapped slides before mapping can finish — while
// still being fully mappable and solvable by the strategy player.
//
//   node e2e/find-trap.js
import { simulate } from './strategy-sim.js';
import { applyMove, isLegal, MIN, MAX } from '../src/model.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genLock(n, seed, density, steps) {
  const rnd = mulberry32(seed);
  const coupling = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : rnd() < density ? (rnd() < 0.5 ? 1 : -1) : 0))
  );
  // Reverse-walk from solved; prefer to stop at a state with 2+ plates on edges
  // (guaranteed reachable → solvable).
  let pos = Array(n).fill(4);
  let best = null;
  for (let s = 0; s < steps; s++) {
    const opts = [];
    for (let p = 0; p < n; p++)
      for (const d of ['L', 'R']) if (isLegal(pos, coupling, p, d)) opts.push({ p, d });
    if (!opts.length) break;
    const mv = opts[Math.floor(rnd() * opts.length)];
    pos = applyMove(pos, coupling, mv.p, mv.d);
    const edges = pos.filter((v) => v <= MIN || v >= MAX).length;
    if (edges >= 2) best = pos.slice();
  }
  return { coupling, initial: best || pos };
}

let found = 0;
outer:
for (let seed = 1; seed <= 30000; seed++) {
  for (const n of [4, 5]) {
    const lock = { n, ...genLock(n, seed * 131 + n, 0.5, 30) };
    const r = simulate(lock);
    if (r.ok && r.mistakes >= 2 && r.breaks >= 1 && r.usedReposition >= 1) {
      console.log(`FOUND n=${n} seed=${seed}: mistakes=${r.mistakes} breaks=${r.breaks} repositions=${r.usedReposition} plans=${r.usedPlan} planLen=${r.planLen}`);
      console.log('coupling:', JSON.stringify(lock.coupling));
      console.log('initial:', JSON.stringify(lock.initial));
      console.log('events:', r.events.join(' | '));
      console.log('');
      if (++found >= 3) break outer;
    }
  }
}
if (!found) console.log('none found');
