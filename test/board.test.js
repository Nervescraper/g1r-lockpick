import test from 'node:test';
import assert from 'node:assert/strict';
import { slideCols, dragToPosition, drawablePosition, KEYWAY_COL, FIELD_COLS } from '../src/ui/board.js';

test('slideCols: the pin is always the fixed keyway column', () => {
  for (let p = 1; p <= 7; p++) {
    assert.equal(slideCols(p).pinCol, KEYWAY_COL, `pin sits in the keyway for p=${p}`);
  }
});

test('slideCols: a slide is 7 holes wide and stays within the field', () => {
  for (let p = 1; p <= 7; p++) {
    const { startCol } = slideCols(p);
    assert.ok(startCol >= 1 && startCol + 6 <= FIELD_COLS, `slide stays in field for p=${p}`);
  }
});

test('slideCols: every slide covers the keyway column', () => {
  for (let p = 1; p <= 7; p++) {
    const { startCol } = slideCols(p);
    assert.ok(startCol <= KEYWAY_COL && KEYWAY_COL <= startCol + 6, `covers keyway for p=${p}`);
  }
});

test('slideCols: position 1 sits hard right, position 7 hard left, 4 is home', () => {
  assert.deepEqual(slideCols(1), { startCol: 7, pinCol: 7 }); // leftmost hole over keyway → slide hard right
  assert.deepEqual(slideCols(4), { startCol: 4, pinCol: 7 }); // middle hole over keyway → home
  assert.deepEqual(slideCols(7), { startCol: 1, pinCol: 7 }); // rightmost hole over keyway → slide hard left
});

test('dragToPosition: no drag keeps the start position', () => {
  assert.equal(dragToPosition(4, 0), 4);
});

test('dragToPosition: dragging right (positive cols) lowers the position', () => {
  assert.equal(dragToPosition(4, 1), 3);
  assert.equal(dragToPosition(4, 3), 1);
});

test('dragToPosition: dragging left (negative cols) raises the position', () => {
  assert.equal(dragToPosition(4, -1), 5);
  assert.equal(dragToPosition(4, -3), 7);
});

test('dragToPosition: clamps to the 1..7 range', () => {
  assert.equal(dragToPosition(1, 5), 1);
  assert.equal(dragToPosition(7, -5), 7);
});

test('drawablePosition: in-range positions draw as-is', () => {
  for (let p = 1; p <= 7; p++) assert.deepEqual(drawablePosition(p), { pos: p, jam: false });
});

test('drawablePosition: out-of-bounds previews pin to the edge and flag a jam', () => {
  assert.deepEqual(drawablePosition(0), { pos: 1, jam: true }); // pushed past pin 1
  assert.deepEqual(drawablePosition(8), { pos: 7, jam: true }); // pushed past pin 7
});
