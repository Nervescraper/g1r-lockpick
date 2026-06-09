import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestedDeltaI,
  clampStep,
  createRecording,
  tagOf,
  positionsOf,
  couplingRow,
  setActiveDir,
  toggleTag,
  dragActive,
  dragOther,
  validRecording,
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

test('setActiveDir normalizes to ±1 and does not mutate the input rec', () => {
  const rec = createRecording([2, 4], 0); // deltaI +1
  const flipped = setActiveDir(rec, -5);
  assert.equal(flipped.deltaI, -1);
  assert.equal(rec.deltaI, 1); // original untouched
  assert.equal(setActiveDir(rec, 3).deltaI, 1);
});

test('toggleTag sets, flips, and clears a plate tag immutably', () => {
  let rec = createRecording([4, 4], 0);
  rec = toggleTag(rec, 1, 'with');
  assert.equal(tagOf(rec, 1), 'with');
  rec = toggleTag(rec, 1, 'opposite'); // different kind -> switch
  assert.equal(tagOf(rec, 1), 'opposite');
  rec = toggleTag(rec, 1, 'opposite'); // same kind -> clear
  assert.equal(tagOf(rec, 1), 'none');
});

test('toggleTag and dragOther ignore the active index (never self-tag)', () => {
  const rec = createRecording([4, 4], 0);
  assert.equal(toggleTag(rec, 0, 'with'), rec);   // returns the rec unchanged
  assert.equal(tagOf(toggleTag(rec, 0, 'with'), 0), 'none');
  assert.equal(dragOther(rec, 0, 6), rec);        // dragging the active plate here is a no-op
});

test('dragActive sets the press direction from the drag sign; baseline drag keeps it', () => {
  const rec = createRecording([4, 4], 0); // deltaI +1
  assert.equal(dragActive(rec, 5).deltaI, 1);  // dragged up -> Left press
  assert.equal(dragActive(rec, 3).deltaI, -1); // dragged down -> Right press
  assert.equal(dragActive(rec, 4).deltaI, 1);  // back to baseline -> unchanged (a press is always ±1)
});

test('dragOther infers with/opposite/none relative to the active direction, clamped ±1', () => {
  const rec = createRecording([4, 4, 4], 0); // deltaI +1
  assert.equal(tagOf(dragOther(rec, 1, 5), 1), 'with');     // +1 matches deltaI
  assert.equal(tagOf(dragOther(rec, 1, 3), 1), 'opposite'); // -1 opposes deltaI
  assert.equal(tagOf(dragOther(rec, 1, 4), 1), 'none');     // back to baseline -> untagged
  assert.equal(tagOf(dragOther(rec, 1, 7), 1), 'with');     // dragged far -> clamped to +1 -> with
});

test('dragOther flips its sense when the active direction is Right (deltaI -1)', () => {
  const rec = { baseline: [4, 4], active: 0, deltaI: -1, tags: {} };
  assert.equal(tagOf(dragOther(rec, 1, 3), 1), 'with');     // -1 matches deltaI -1
  assert.equal(tagOf(dragOther(rec, 1, 5), 1), 'opposite'); // +1 opposes deltaI -1
});

test('validRecording rejects a move that would push a plate past an edge', () => {
  // active plate 0 at the MAX edge, pressed Left (+1) -> would land on 8.
  const offBoard = { baseline: [7, 4], active: 0, deltaI: 1, tags: {} };
  assert.equal(validRecording(offBoard), false);
  // a with-plate at the edge pushed off:
  const tagOff = { baseline: [4, 7], active: 0, deltaI: 1, tags: { 1: 'with' } };
  assert.equal(validRecording(tagOff), false);
  // an in-bounds recording is valid:
  assert.equal(validRecording(createRecording([4, 4, 4], 0, { 1: 'with', 2: 'opposite' })), true);
});
