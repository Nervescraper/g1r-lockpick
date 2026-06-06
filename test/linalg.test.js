import test from 'node:test';
import assert from 'node:assert/strict';
import { transpose, matVec, det, adjugate } from '../src/linalg.js';

test('transpose flips rows and columns', () => {
  assert.deepEqual(transpose([[1, 2], [3, 4]]), [[1, 3], [2, 4]]);
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
});

test('matVec multiplies a matrix by a column vector', () => {
  assert.deepEqual(matVec([[1, 2], [3, 4]], [5, 6]), [17, 39]);
  assert.deepEqual(matVec([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [7, 8, 9]), [7, 8, 9]);
});

test('det of 1x1 and 2x2', () => {
  assert.equal(det([[5]]), 5);
  assert.equal(det([[1, 2], [3, 4]]), -2);
  assert.equal(det([[2, 0], [0, 3]]), 6);
});

test('det is 0 for a singular matrix', () => {
  assert.equal(det([[1, 2], [2, 4]]), 0);
  assert.equal(det([[0, 1], [0, 1]]), 0);
});

test('det handles a leading-zero pivot via row swap', () => {
  assert.equal(det([[0, 1], [1, 0]]), -1);
});

test('det of a 3x3 with mixed entries (exact integer)', () => {
  // det([[2,-1,0],[-1,2,-1],[0,-1,2]]) = 4
  assert.equal(det([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]), 4);
  assert.equal(det([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), 1);
});

test('det does not mutate its input', () => {
  const m = [[1, 2], [3, 4]];
  det(m);
  assert.deepEqual(m, [[1, 2], [3, 4]]);
});

test('adjugate of a 1x1 is [[1]]', () => {
  assert.deepEqual(adjugate([[5]]), [[1]]);
});

test('adjugate of a 2x2 matches the classic formula', () => {
  assert.deepEqual(adjugate([[1, 2], [3, 4]]), [[4, -2], [-3, 1]]);
});

test('adjugate of the identity is the identity', () => {
  assert.deepEqual(adjugate([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

// The defining property: A * adj(A) = det(A) * I, for several integer matrices.
test('A * adj(A) equals det(A) * I', () => {
  const mats = [
    [[2, -1, 0], [-1, 2, -1], [0, -1, 2]],
    [[1, 1, 0], [0, 1, 1], [1, 0, 1]],
    [[1, -1, 0, 0], [0, 1, -1, 0], [0, 0, 1, -1], [0, 0, 0, 1]],
  ];
  for (const A of mats) {
    const n = A.length;
    const adj = adjugate(A);
    const d = det(A);
    // product P = A * adj
    const P = A.map((row, i) =>
      adj[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * adj[k][j], 0)),
    );
    const expected = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? d : 0)),
    );
    assert.deepEqual(P, expected);
  }
});
