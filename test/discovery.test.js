import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMapping,
  leftEffect,
  recordShifts,
  probeSafe,
  recommendNext,
  applyProbe,
  defer,
  allMapped,
} from '../src/discovery.js';

test('createMapping makes an n-plate zeroed matrix marked unstarted', () => {
  const m = createMapping(3);
  assert.equal(m.n, 3);
  assert.deepEqual(m.coupling, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(m.status, ['unstarted', 'unstarted', 'unstarted']);
});

test('leftEffect converts an observed shift into a Left-frame value', () => {
  assert.equal(leftEffect('L', 'L'), 1); // probed Left, saw Left  => +1
  assert.equal(leftEffect('L', 'R'), -1); // probed Left, saw Right => -1
  assert.equal(leftEffect('R', 'L'), -1); // probed Right, saw Left => Left would be -1
  assert.equal(leftEffect('R', 'R'), 1);
});

test('recordShifts writes observed cells in the Left frame', () => {
  const m = createMapping(3);
  // probed plate 0 with Right; saw plate 0 shift Right and plate 2 shift Left
  recordShifts(m, 0, 'R', { 0: 'R', 2: 'L' });
  assert.deepEqual(m.coupling[0], [1, 0, -1]);
});

test('probe is safe when every other plate is interior (2..6)', () => {
  const m = createMapping(3);
  assert.equal(probeSafe([4, 3, 5], m, 0, 'L'), true);
});

test('probe is unsafe when another plate sits at an edge', () => {
  const m = createMapping(3);
  assert.equal(probeSafe([4, 1, 5], m, 0, 'L'), false); // plate 1 at edge
  assert.equal(probeSafe([4, 5, 7], m, 0, 'R'), false); // plate 2 at edge
});

test('probe is unsafe when the selected plate is pushed past its own edge', () => {
  const m = createMapping(2);
  assert.equal(probeSafe([7, 4], m, 0, 'L'), false); // 7 -> 8
  assert.equal(probeSafe([1, 4], m, 0, 'R'), false); // 1 -> 0
  assert.equal(probeSafe([7, 4], m, 0, 'R'), true); // 7 -> 6 ok, other interior
});

test('recommends a guaranteed-safe probe when one exists', () => {
  const m = createMapping(3);
  const rec = recommendNext([4, 3, 5], m);
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, true);
  assert.equal(m.status[rec.plate] !== 'done', true);
});

test('skips already-done plates and prefers partial ones', () => {
  const m = createMapping(3);
  m.status = ['done', 'partial', 'unstarted'];
  const rec = recommendNext([4, 3, 5], m);
  assert.equal(rec.plate, 1); // partial preferred over unstarted, done skipped
});

test('falls back to a least-risky probe when an edge plate blocks safety', () => {
  const m = createMapping(2);
  m.status = ['unstarted', 'done'];
  const rec = recommendNext([1, 7], m); // both at edges, nothing safe, no prep helps
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, false);
});

test('recommends a prep move when a known plate can pull an edge plate inward', () => {
  const m = createMapping(2);
  // plate 1 is fully mapped: pressing Left on it shifts plate 1 by -1 (toward center).
  m.coupling = [[0, 0], [0, -1]];
  m.status = ['unstarted', 'done'];
  // plate 1 sits at the top edge (7); while it's there no probe of plate 0 is safe,
  // so the wizard first nudges plate 1 inward with the known move (Left on plate 1).
  const rec = recommendNext([4, 7], m);
  assert.equal(rec.type, 'prep');
  assert.equal(rec.plate, 1);
  assert.equal(rec.dir, 'L');
});

test('applyProbe records shifts, advances positions, and marks done', () => {
  const m = createMapping(2);
  // probe plate 0 with Left; saw plate 0 shift Left (+1) and plate 1 shift Right (-1)
  const np = applyProbe([3, 5], m, 0, 'L', { 0: 'L', 1: 'R' }, { complete: true });
  assert.deepEqual(m.coupling[0], [1, -1]);
  assert.deepEqual(np, [4, 4]);
  assert.equal(m.status[0], 'done');
});

test('applyProbe with complete:false marks the plate partial but keeps marks', () => {
  const m = createMapping(2);
  applyProbe([3, 5], m, 0, 'L', { 0: 'L' }, { complete: false });
  assert.deepEqual(m.coupling[0], [1, 0]);
  assert.equal(m.status[0], 'partial');
});

test('defer keeps existing marks and sets status partial', () => {
  const m = createMapping(2);
  recordShifts(m, 0, 'L', { 0: 'L' });
  defer(m, 0);
  assert.equal(m.status[0], 'partial');
  assert.deepEqual(m.coupling[0], [1, 0]); // marks retained
});

test('allMapped is true only when every plate is done', () => {
  const m = createMapping(2);
  assert.equal(allMapped(m), false);
  m.status = ['done', 'partial'];
  assert.equal(allMapped(m), false);
  m.status = ['done', 'done'];
  assert.equal(allMapped(m), true);
});
