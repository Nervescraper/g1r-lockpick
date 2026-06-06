import test from 'node:test';
import assert from 'node:assert/strict';
import { MinHeap } from '../src/heap.js';

test('pops numbers in ascending order with a numeric comparator', () => {
  const h = new MinHeap((a, b) => a < b);
  for (const x of [5, 1, 4, 2, 8, 3, 7, 6]) h.push(x);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('honors a custom lexicographic comparator on pairs', () => {
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const h = new MinHeap(less);
  for (const x of [[2, 0], [1, 9], [1, 1], [2, -1], [0, 5]]) h.push(x);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, [[0, 5], [1, 1], [1, 9], [2, -1], [2, 0]]);
});

test('size tracks pushes and pops; interleaving preserves order', () => {
  const h = new MinHeap((a, b) => a < b);
  h.push(3); h.push(1);
  assert.equal(h.size, 2);
  assert.equal(h.pop(), 1);
  h.push(2); h.push(0);
  assert.equal(h.size, 3);
  assert.equal(h.pop(), 0);
  assert.equal(h.pop(), 2);
  assert.equal(h.pop(), 3);
  assert.equal(h.size, 0);
});

test('pop from a single-element heap returns that element', () => {
  const h = new MinHeap((a, b) => a < b);
  h.push(7);
  assert.equal(h.pop(), 7);
  assert.equal(h.size, 0);
});
