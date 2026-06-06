import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, countSwitches } from '../src/solver.js';
import { applyMove, isSolved, legalMoves, MIN, MAX } from '../src/model.js';

// helper: replay a solution, asserting every step stays in 1..7
function replay(positions, coupling, moves) {
  let p = positions.slice();
  for (const mv of moves) {
    p = applyMove(p, coupling, mv.plate, mv.dir);
    assert.ok(p.every((v) => v >= MIN && v <= MAX), `step left bounds: ${p}`);
  }
  return p;
}

test('already-solved returns an empty move list', () => {
  assert.deepEqual(solve([4, 4], [[1, 0], [0, 1]]), []);
});

test('single uncoupled plate needs two Left moves from 2 to 4', () => {
  const moves = solve([2], [[1]]);
  assert.equal(moves.length, 2);
  assert.deepEqual(replay([2], [[1]], moves), [4]);
});

test('two independent plates: shortest path reaches all-4 in bounds', () => {
  const coupling = [[1, 0], [0, 1]];
  const moves = solve([2, 5], coupling);
  assert.equal(moves.length, 3); // +2 on plate 0, -1 on plate 1
  assert.ok(isSolved(replay([2, 5], coupling, moves)));
});

test('coupled plates: solution respects side effects and stays in bounds', () => {
  // L on plate 0 shifts plate 0 +1 and plate 1 -1
  const coupling = [[1, -1], [0, 1]];
  const moves = solve([3, 5], coupling);
  assert.ok(isSolved(replay([3, 5], coupling, moves)));
});

test('returns null when no move can change the state', () => {
  // zero coupling: nothing ever moves, and we are not at goal
  assert.equal(solve([3], [[0]]), null);
});

test('returns null when the goal is unreachable within bounds', () => {
  // L on plate 0 only ever moves plate 1; plate 0 can never reach 4
  const coupling = [[0, 1], [0, 1]];
  assert.equal(solve([2, 4], coupling), null);
});

test('countSwitches: empty and single-move plans have zero switches', () => {
  assert.equal(countSwitches([]), 0);
  assert.equal(countSwitches([{ plate: 0, dir: 'L' }]), 0);
});

test('countSwitches: consecutive moves on the same plate add no switches', () => {
  const moves = [
    { plate: 1, dir: 'L' },
    { plate: 1, dir: 'L' },
    { plate: 1, dir: 'R' },
  ];
  assert.equal(countSwitches(moves), 0);
});

test('countSwitches: each change of plate counts once', () => {
  const moves = [
    { plate: 0, dir: 'L' }, // first move: 0
    { plate: 1, dir: 'L' }, // 0 -> 1 : +1
    { plate: 1, dir: 'R' }, // same   : +0
    { plate: 0, dir: 'L' }, // 1 -> 0 : +1
  ];
  assert.equal(countSwitches(moves), 2);
});

// Deterministic PRNG (mulberry32) so the generated sweep is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A valid lock coupling: n x n, diagonal = 1 (a plate moves itself by +1 on Left),
// off-diagonal cells in {-1, 0, 1} (moves-with / no-move / opposite).
function randomCoupling(n, rnd) {
  const m = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : [-1, 0, 1][Math.floor(rnd() * 3)]);
    m.push(row);
  }
  return m;
}

function randomStart(n, rnd) {
  return Array.from({ length: n }, () => MIN + Math.floor(rnd() * (MAX - MIN + 1)));
}

// Reference shortest-path BFS (one shortest plan, in BFS discovery order). Used as
// the baseline for both optimal length and a "naive" switch count to beat.
function bfsShortest(positions, coupling) {
  const start = positions.slice();
  if (isSolved(start)) return [];
  const startKey = start.join(',');
  const visited = new Set([startKey]);
  const parent = new Map();
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    for (const mv of legalMoves(pos, coupling)) {
      const np = applyMove(pos, coupling, mv.plate, mv.dir);
      const nk = np.join(',');
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, { prev: pos.join(','), move: mv });
      if (isSolved(np)) {
        const out = [];
        let k = nk;
        while (k !== startKey) {
          const { prev, move } = parent.get(k);
          out.push(move);
          k = prev;
        }
        return out.reverse();
      }
      queue.push(np);
    }
  }
  return null;
}

test('generated sweep: plans stay in bounds, match optimal length, never increase switches', () => {
  const cases = [];
  // Exhaustive small case: n = 2, all 9 off-diagonal couplings, all 49 starts.
  for (const c01 of [-1, 0, 1]) {
    for (const c10 of [-1, 0, 1]) {
      const coupling = [[1, c01], [c10, 1]];
      for (let a = MIN; a <= MAX; a++) {
        for (let b = MIN; b <= MAX; b++) cases.push({ coupling, start: [a, b] });
      }
    }
  }
  // Seeded random sweep for n = 3..5.
  const rnd = mulberry32(0xC0FFEE);
  for (let i = 0; i < 600; i++) {
    const n = 3 + (i % 3); // 3, 4, 5
    cases.push({ coupling: randomCoupling(n, rnd), start: randomStart(n, rnd) });
  }

  let solvedCount = 0;
  for (const { coupling, start } of cases) {
    const plan = solve(start, coupling);
    const ref = bfsShortest(start, coupling);

    // Solvability must agree with the reference BFS.
    assert.equal(plan === null, ref === null, `solvability mismatch for ${start} / ${JSON.stringify(coupling)}`);
    if (plan === null) continue;
    solvedCount++;

    // Edge safety: replay every step, assert it never leaves 1..7. (Headline guarantee.)
    let p = start.slice();
    for (const mv of plan) {
      p = applyMove(p, coupling, mv.plate, mv.dir);
      assert.ok(
        p.every((v) => v >= MIN && v <= MAX),
        `step left bounds: ${p} for start ${start} / ${JSON.stringify(coupling)}`,
      );
    }
    // ...and actually solves the lock.
    assert.ok(isSolved(p), `plan did not solve ${start} / ${JSON.stringify(coupling)}`);

    // Move-count optimality preserved: same length as the reference shortest path.
    assert.equal(plan.length, ref.length, `length regressed for ${start} / ${JSON.stringify(coupling)}`);

    // Switches never worse than the naive shortest path.
    assert.ok(
      countSwitches(plan) <= countSwitches(ref),
      `switches not improved for ${start} / ${JSON.stringify(coupling)}: ${countSwitches(plan)} > ${countSwitches(ref)}`,
    );
  }

  assert.ok(solvedCount > 100, `expected many solvable cases, got ${solvedCount}`);
});

// Independent oracle: the minimum number of plate switches among ALL shortest
// in-bounds plans, computed as a layered depth-DP (no priority queue) — a
// different formulation from the production Dijkstra solver, so it cross-checks
// the result from another direction. Returns { len, switches } or null.
function optimalPlan(positions, coupling) {
  const ref = bfsShortest(positions, coupling);
  if (ref === null) return null;
  const D = ref.length; // proven-optimal plan length
  const startKey = positions.join(',') + '|'; // lastPlate = none
  let layer = new Map([[startKey, 0]]); // stateKey -> min switches at this depth
  let posOf = new Map([[startKey, positions.slice()]]);
  for (let step = 0; step < D; step++) {
    const next = new Map();
    const nextPos = new Map();
    for (const [key, sw] of layer) {
      const pos = posOf.get(key);
      const last = key.slice(key.indexOf('|') + 1); // '' (none) or plate-index string
      for (const mv of legalMoves(pos, coupling)) {
        const np = applyMove(pos, coupling, mv.plate, mv.dir);
        const nLast = String(mv.plate);
        const nsw = sw + (last !== '' && nLast !== last ? 1 : 0);
        const nKey = np.join(',') + '|' + nLast;
        if (!next.has(nKey) || nsw < next.get(nKey)) {
          next.set(nKey, nsw);
          nextPos.set(nKey, np);
        }
      }
    }
    layer = next;
    posOf = nextPos;
  }
  let best = Infinity;
  for (const [key, sw] of layer) {
    if (isSolved(posOf.get(key)) && sw < best) best = sw;
  }
  return { len: D, switches: best };
}

test('n=2 exhaustive: solver hits the true minimum switches (independent DP oracle)', () => {
  let checked = 0;
  for (const c01 of [-1, 0, 1]) {
    for (const c10 of [-1, 0, 1]) {
      const coupling = [[1, c01], [c10, 1]];
      for (let a = MIN; a <= MAX; a++) {
        for (let b = MIN; b <= MAX; b++) {
          const start = [a, b];
          const plan = solve(start, coupling);
          const opt = optimalPlan(start, coupling);
          assert.equal(plan === null, opt === null, `solvability mismatch for ${start} / ${JSON.stringify(coupling)}`);
          if (plan === null) continue;
          checked++;
          assert.equal(plan.length, opt.len, `length not optimal for ${start} / ${JSON.stringify(coupling)}`);
          assert.equal(
            countSwitches(plan),
            opt.switches,
            `switches not optimal for ${start} / ${JSON.stringify(coupling)}: got ${countSwitches(plan)}, true min ${opt.switches}`,
          );
        }
      }
    }
  }
  assert.ok(checked > 100, `expected many solvable cases, got ${checked}`);
});

test('constructed case: optimizer reaches minimum switches, beating a naive interleaving', () => {
  // Two independent plates, each two Left moves from center. A grouped plan
  // (plate 0 twice, then plate 1 twice) needs only 1 switch; a naive interleaving
  // (alternating plates) is an equally-short, in-bounds plan that needs 3 switches.
  // The optimizer must find the grouped, minimum-switch ordering. We compare
  // against a hand-built plan rather than bfsShortest so the test does not depend
  // on the reference BFS's incidental tie-breaking order.
  const coupling = [[1, 0], [0, 1]];
  const start = [2, 2]; // each plate needs +2

  const plan = solve(start, coupling);

  // A hand-built alternative shortest plan that interleaves the two plates.
  const interleaved = [
    { plate: 0, dir: 'L' },
    { plate: 1, dir: 'L' },
    { plate: 0, dir: 'L' },
    { plate: 1, dir: 'L' },
  ];

  // Both are valid: same minimal length, stay in bounds (replay asserts this), and solve.
  assert.equal(plan.length, 4);
  assert.equal(interleaved.length, 4);
  assert.ok(isSolved(replay(start, coupling, plan)));
  assert.ok(isSolved(replay(start, coupling, interleaved)));

  // The optimizer achieves the theoretical minimum (one switch) and is strictly
  // better than the naive interleaving (three switches).
  assert.equal(countSwitches(plan), 1);
  assert.equal(countSwitches(interleaved), 3);
  assert.ok(
    countSwitches(plan) < countSwitches(interleaved),
    `expected strict improvement; plan=${countSwitches(plan)} interleaved=${countSwitches(interleaved)}`,
  );
});
