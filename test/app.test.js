import test from 'node:test';
import assert from 'node:assert/strict';
import { nextActivePlate } from '../src/ui/active-plate.js';

test('nextActivePlate: advances to the next plate', () => {
  assert.equal(nextActivePlate(0, 5), 1);
  assert.equal(nextActivePlate(3, 5), 4);
});

test('nextActivePlate: stops at the last plate (no wrap)', () => {
  assert.equal(nextActivePlate(4, 5), 4);
});
