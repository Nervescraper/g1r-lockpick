import test from 'node:test';
import assert from 'node:assert/strict';
import { planColumnCount } from '../src/ui/plan-columns.js';

test('planColumnCount: one column when the plan fits the available height', () => {
  assert.equal(planColumnCount({ naturalHeight: 300, availHeight: 400, colWidth: 200, availWidth: 2000 }), 1);
});

test('planColumnCount: one column when it just fits (equal heights)', () => {
  assert.equal(planColumnCount({ naturalHeight: 400, availHeight: 400, colWidth: 200, availWidth: 2000 }), 1);
});

test('planColumnCount: splits into the fewest columns that fit the height', () => {
  // 1200 tall content into 400 of height needs 3 columns; viewport is wide enough.
  assert.equal(planColumnCount({ naturalHeight: 1200, availHeight: 400, colWidth: 200, availWidth: 2000, gap: 32 }), 3);
});

test('planColumnCount: capped by how many columns fit the viewport width', () => {
  // Needs 5 columns by height, but only 2 fit the width (200 + 32 gap → ~464 per col pair).
  assert.equal(planColumnCount({ naturalHeight: 2000, availHeight: 400, colWidth: 200, availWidth: 460, gap: 32 }), 2);
});

test('planColumnCount: never fewer than one column even on a tiny viewport', () => {
  assert.equal(planColumnCount({ naturalHeight: 2000, availHeight: 400, colWidth: 200, availWidth: 100, gap: 32 }), 1);
});

test('planColumnCount: one column when the column width is unmeasurable', () => {
  assert.equal(planColumnCount({ naturalHeight: 2000, availHeight: 400, colWidth: 0, availWidth: 2000 }), 1);
});
