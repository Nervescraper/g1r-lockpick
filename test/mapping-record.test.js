import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestedDeltaI,
  clampStep,
  createRecording,
  tagOf,
  positionsOf,
  couplingRow,
} from '../src/ui/mapping-record.js';

test('suggestedDeltaI points toward center: -1 above the goal, +1 at or below', () => {
  assert.equal(suggestedDeltaI(7), -1); // press Right to come down toward 4
  assert.equal(suggestedDeltaI(5), -1);
  assert.equal(suggestedDeltaI(4), 1);
  assert.equal(suggestedDeltaI(2), 1); // press Left to go up toward 4
});

test('clampStep limits a raw drag to one slot from baseline and to the 1..7 board', () => {
  assert.equal(clampStep(4, 4), 4); // no move
  assert.equal(clampStep(4, 6), 5); // dragged two slots up, clamped to +1
  assert.equal(clampStep(4, 1), 3); // dragged down, clamped to -1
  assert.equal(clampStep(7, 9), 7); // can't exceed MAX even within one slot
  assert.equal(clampStep(1, -3), 1); // can't go below MIN
});

test('createRecording snapshots baseline, derives the default direction, and seeds tags', () => {
  const rec = createRecording([4, 7, 2], 1); // active = plate 1, at the top edge
  assert.deepEqual(rec.baseline, [4, 7, 2]);
  assert.equal(rec.active, 1);
  assert.equal(rec.deltaI, -1); // pos 7 -> toward center is Right
  assert.deepEqual(rec.tags, {});
});

test('createRecording snapshots a copy of positions (later mutation does not leak in)', () => {
  const pos = [4, 4];
  const rec = createRecording(pos, 0);
  pos[1] = 7;
  assert.deepEqual(rec.baseline, [4, 4]);
});

test('createRecording accepts initial tags (re-selecting an already-mapped plate)', () => {
  const rec = createRecording([4, 4, 4], 0, { 1: 'with', 2: 'opposite' });
  assert.equal(tagOf(rec, 1), 'with');
  assert.equal(tagOf(rec, 2), 'opposite');
  assert.equal(tagOf(rec, 0), 'none'); // the active plate is never tagged
});

test('positionsOf moves the active plate by deltaI and coupled plates accordingly', () => {
  // active = plate 0 pressed Left (deltaI +1); plate 1 with, plate 2 opposite, plate 3 none.
  const rec = createRecording([4, 4, 4, 4], 0, { 1: 'with', 2: 'opposite' });
  assert.deepEqual(positionsOf(rec), [5, 5, 3, 4]);
});

test('positionsOf re-derives coupled plates when the active direction flips', () => {
  const rec = { baseline: [4, 4, 4], active: 0, deltaI: -1, tags: { 1: 'with', 2: 'opposite' } };
  assert.deepEqual(positionsOf(rec), [3, 3, 5]); // active down, with-plate down, opposite-plate up
});

test('couplingRow encodes self=1, with=+1, opposite=-1, none=0 (independent of deltaI sign)', () => {
  const recL = createRecording([4, 4, 4, 4], 0, { 1: 'with', 2: 'opposite' });
  const recR = { ...recL, deltaI: -1 };
  const expected = [1, 1, -1, 0];
  assert.deepEqual(couplingRow(recL), expected);
  assert.deepEqual(couplingRow(recR), expected); // press direction does not change learned couplings
});

test('couplingRow keeps the self-entry even if the active index is wrongly tagged', () => {
  const rec = { baseline: [4, 4], active: 0, deltaI: 1, tags: { 0: 'opposite', 1: 'with' } };
  assert.deepEqual(couplingRow(rec), [1, 1]); // row[0] stays 1, not -1
});
