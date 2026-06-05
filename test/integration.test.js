import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapping, recordShifts } from '../src/discovery.js';
import { solve } from '../src/solver.js';
import { applyMove, isSolved, MIN, MAX } from '../src/model.js';

// Turn a true coupling row into the screen shifts a player would observe
// when pressing Left on that plate (+1 => 'L', -1 => 'R'; zeros unseen).
function observedLeftShifts(row) {
  const shifts = {};
  row.forEach((v, j) => {
    if (v === 1) shifts[j] = 'L';
    else if (v === -1) shifts[j] = 'R';
  });
  return shifts;
}

test('a discovered mapping reproduces the true coupling and yields a valid solve', () => {
  // Unimodular (det = 1) so any target is reachable with integer presses.
  const trueCoupling = [
    [1, -1, 0],
    [0, 1, -1],
    [0, 0, 1],
  ];

  // Player maps each plate by pressing Left and recording what shifted.
  const m = createMapping(3);
  trueCoupling.forEach((row, i) => recordShifts(m, i, 'L', observedLeftShifts(row)));
  assert.deepEqual(m.coupling, trueCoupling);

  // Solve from a starting position and verify the path is valid and edge-free.
  const start = [3, 4, 4];
  const moves = solve(start, m.coupling);
  assert.notEqual(moves, null);

  let p = start.slice();
  for (const mv of moves) {
    p = applyMove(p, m.coupling, mv.plate, mv.dir);
    assert.ok(p.every((v) => v >= MIN && v <= MAX), `out of bounds at ${p}`);
  }
  assert.ok(isSolved(p));
});
