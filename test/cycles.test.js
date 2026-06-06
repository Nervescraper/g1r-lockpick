import test from 'node:test';
import assert from 'node:assert/strict';
import { findCycles } from '../src/cycles.js';

// Build a plan from a compact "P<dir>" shorthand, e.g. "1L 2R 1L".
function plan(s) {
  return s.trim().split(/\s+/).map((tok) => ({ plate: +tok[0] - 1, dir: tok[1] }));
}

test('empty plan yields no segments', () => {
  assert.deepEqual(findCycles([]), []);
});

test('plain no-repeat plan is all singles', () => {
  const segs = findCycles(plan('1L 2R 3L'));
  assert.deepEqual(segs.map((s) => s.type), ['single', 'single', 'single']);
  assert.deepEqual(segs.map((s) => s.index), [0, 1, 2]);
});

test('back-and-forth: one cycle, unitLen 2, reps 3, two plates', () => {
  const segs = findCycles(plan('1L 2R 1L 2R 1L 2R'));
  assert.equal(segs.length, 1);
  const c = segs[0];
  assert.equal(c.type, 'cycle');
  assert.equal(c.start, 0);
  assert.equal(c.unitLen, 2);
  assert.equal(c.reps, 3);
  assert.equal(c.length, 6);
  assert.deepEqual(c.plates, [0, 1]);
  assert.deepEqual(c.unit, plan('1L 2R'));
});

test('triangle: one cycle, unitLen 3, reps 2, three plates', () => {
  const segs = findCycles(plan('1L 2R 3L 1L 2R 3L'));
  assert.equal(segs.length, 1);
  const c = segs[0];
  assert.equal(c.unitLen, 3);
  assert.equal(c.reps, 2);
  assert.deepEqual(c.plates, [0, 1, 2]);
});

test('longer unit over two plates is flagged', () => {
  const segs = findCycles(plan('1L 1L 2R 1L 1L 2R'));
  assert.equal(segs.length, 1);
  assert.equal(segs[0].unitLen, 3);
  assert.equal(segs[0].reps, 2);
  assert.deepEqual(segs[0].plates, [0, 1]);
});

test('single-plate run is flagged at two repeats', () => {
  const segs = findCycles(plan('1L 1L'));
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'cycle');
  assert.equal(segs[0].unitLen, 1);
  assert.equal(segs[0].reps, 2);
  assert.deepEqual(segs[0].plates, [0]);
});

test('a four-plate repeating unit is NOT flagged (all singles)', () => {
  const segs = findCycles(plan('1L 2R 3L 4R 1L 2R 3L 4R'));
  assert.ok(segs.every((s) => s.type === 'single'));
  assert.equal(segs.length, 8);
});

test('two adjacent but distinct cycle runs become two cycle segments', () => {
  const segs = findCycles(plan('1L 2R 1L 2R 3L 4R 3L 4R'));
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.type), ['cycle', 'cycle']);
  assert.deepEqual(segs[0].plates, [0, 1]);
  assert.deepEqual(segs[1].plates, [2, 3]);
  assert.equal(segs[1].start, 4);
});

test('a cycle butted against singletons on both sides', () => {
  const segs = findCycles(plan('5R 1L 2R 1L 2R 3L'));
  assert.deepEqual(segs.map((s) => s.type), ['single', 'cycle', 'single']);
  assert.equal(segs[1].start, 1);
  assert.equal(segs[1].length, 4);
  assert.equal(segs[2].index, 5);
});

test('tie-break prefers the smallest unit: ABABAB is AB x3, not ABAB', () => {
  const segs = findCycles(plan('1L 2R 1L 2R 1L 2R'));
  assert.equal(segs[0].unitLen, 2);
  assert.equal(segs[0].reps, 3);
});
