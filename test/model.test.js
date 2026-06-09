import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dirSign,
  moveDelta,
  applyMove,
  isLegal,
  isSolved,
  legalMoves,
  allInterior,
} from '../src/model.js';

test('dirSign maps L to +1 and R to -1', () => {
  assert.equal(dirSign('L'), 1);
  assert.equal(dirSign('R'), -1);
});

test('moveDelta returns the coupling row for L and its negation for R', () => {
  const coupling = [[1, -1, 0]];
  assert.deepEqual(moveDelta(coupling, 0, 'L'), [1, -1, 0]);
  assert.deepEqual(moveDelta(coupling, 0, 'R'), [-1, 1, 0]);
});

test('applyMove adds the delta to positions without mutating input', () => {
  const coupling = [[1, 0], [0, 1]];
  const positions = [2, 2];
  assert.deepEqual(applyMove(positions, coupling, 0, 'L'), [3, 2]);
  assert.deepEqual(applyMove(positions, coupling, 1, 'R'), [2, 1]);
  assert.deepEqual(positions, [2, 2]); // unchanged
});

test('isLegal is false when any plate would leave 1..7', () => {
  assert.equal(isLegal([7], [[1]], 0, 'L'), false); // 7 -> 8
  assert.equal(isLegal([7], [[1]], 0, 'R'), true); // 7 -> 6
  assert.equal(isLegal([1], [[1]], 0, 'R'), false); // 1 -> 0
});

test('isLegal accounts for coupled plates hitting an edge', () => {
  const coupling = [[1, 1]]; // L on plate 0 shifts both +1
  assert.equal(isLegal([3, 7], coupling, 0, 'L'), false); // plate 1: 7 -> 8
});

test('isSolved is true only when every pin is at 4', () => {
  assert.equal(isSolved([4, 4]), true);
  assert.equal(isSolved([4, 3]), false);
});

test('allInterior is true only when every plate is strictly inside the edges', () => {
  assert.equal(allInterior([2, 4, 6]), true);
  assert.equal(allInterior([4, 4, 4]), true);
  assert.equal(allInterior([1, 4]), false); // 1 is the MIN edge
  assert.equal(allInterior([4, 7]), false); // 7 is the MAX edge
});

test('legalMoves lists only in-bounds plate/dir combos', () => {
  const coupling = [[1, 0], [0, 1]];
  const moves = legalMoves([1, 7], coupling);
  assert.deepEqual(moves, [
    { plate: 0, dir: 'L' }, // 1 -> 2 ok; R would be 1 -> 0
    { plate: 1, dir: 'R' }, // 7 -> 6 ok; L would be 7 -> 8
  ]);
});
