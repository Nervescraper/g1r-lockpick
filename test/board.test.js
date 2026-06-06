import test from 'node:test';
import assert from 'node:assert/strict';
import { slideCols, KEYWAY_COL, FIELD_COLS } from '../src/ui/board.js';

test('slideCols: position 4 puts the pin in the keyway', () => {
  assert.equal(slideCols(4).pinCol, KEYWAY_COL);
});

test('slideCols: a slide is 7 holes wide and the pin is the middle hole', () => {
  for (let p = 1; p <= 7; p++) {
    const { startCol, pinCol } = slideCols(p);
    assert.equal(pinCol, startCol + 3, `pin is middle hole for p=${p}`);
    assert.ok(startCol >= 1 && startCol + 6 <= FIELD_COLS, `slide stays in field for p=${p}`);
  }
});

test('slideCols: every slide covers the keyway column', () => {
  for (let p = 1; p <= 7; p++) {
    const { startCol } = slideCols(p);
    assert.ok(startCol <= KEYWAY_COL && KEYWAY_COL <= startCol + 6, `covers keyway for p=${p}`);
  }
});

test('slideCols: boundary positions span the full 13-col field', () => {
  assert.deepEqual(slideCols(1), { startCol: 1, pinCol: 4 });
  assert.deepEqual(slideCols(7), { startCol: 7, pinCol: 10 });
});
