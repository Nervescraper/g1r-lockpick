import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/solver.js';
import { applyMove, isSolved, MIN, MAX } from '../src/model.js';

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
