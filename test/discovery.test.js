import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/solver.js';
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

test('createMapping gives each plate a default self-move and marks all unstarted', () => {
  const m = createMapping(3);
  assert.equal(m.n, 3);
  assert.deepEqual(m.coupling, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  assert.deepEqual(m.status, ['unstarted', 'unstarted', 'unstarted']);
});

test('an unmapped lock is still solvable using self-moves only', () => {
  const m = createMapping(2);
  const moves = solve([2, 5], m.coupling); // no connections recorded yet
  assert.notEqual(moves, null);
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

test('skips done plates and works fresh plates before deferred (partial) ones', () => {
  const m = createMapping(3);
  m.status = ['done', 'partial', 'unstarted'];
  const rec = recommendNext([4, 3, 5], m);
  assert.equal(rec.plate, 2); // unstarted first; the deferred plate waits its turn
});

test('after deferring a plate, a different plate is recommended next', () => {
  const m = createMapping(3); // all interior, every probe safe
  defer(m, 0); // P1 -> partial
  const rec = recommendNext([4, 4, 4], m);
  assert.notEqual(rec.plate, 0);
});

test('recommendNext returns null when every plate is mapped', () => {
  const m = createMapping(2);
  m.status = ['done', 'done'];
  assert.equal(recommendNext([4, 4], m), null);
});

test('falls back to a least-risky probe when nothing is safe and no prep helps', () => {
  const m = createMapping(2); // neither plate mapped -> no prep move available
  const rec = recommendNext([1, 7], m); // both plates at edges, nothing safe
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, false);
});

test('recommends an edge-clearing plan when a known plate can pull an edge plate inward', () => {
  const m = createMapping(2);
  // plate 1 is fully mapped: pressing Left on it shifts plate 1 by -1 (toward center).
  m.coupling = [[0, 0], [0, -1]];
  m.status = ['unstarted', 'done'];
  // plate 1 sits at the top edge (7); no probe of plate 0 is safe while it's there,
  // so the recommender returns a known-move plan that nudges plate 1 inward (Left).
  const rec = recommendNext([4, 7], m);
  assert.equal(rec.type, 'plan');
  assert.deepEqual(rec.moves, [{ plate: 1, dir: 'L' }]);
});

test('orders an at-edge plate ahead of an interior one for a guaranteed-safe probe', () => {
  const m = createMapping(3); // all unstarted
  // plate 2 sits on the MAX edge, plates 0 and 1 are interior. With no OTHER plate at
  // an edge, probing plate 2 toward center (R) is safe and should be preferred.
  const rec = recommendNext([3, 5, 7], m);
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, true);
  assert.equal(rec.plate, 2);
  assert.equal(rec.dir, 'R');
});

test('edge-first sort picks an at-edge plate first in the tier-3 fallback', () => {
  const m = createMapping(3); // all unstarted, no done plates -> no clearing plan
  // positions [4, 1, 7]: plate 0 interior, plates 1 (MIN) and 2 (MAX) on edges.
  // Every probe is unsafe: plate 0's probes are blocked by the two edge plates;
  // plate 1's probes are blocked because plate 2 is at MAX (and plate 1 at MIN blocks
  // dir-L); plate 2's probes are blocked by plate 1 at MIN. planEdgeClear returns null
  // (no done plates). So tier 3 fires and returns candidates[0].
  // Under the OLD status-only sort candidates = [0, 1, 2] -> plate 0 (interior) wins.
  // Under the NEW edge-first sort plates 1 and 2 (both at edges) sort before plate 0,
  // so candidates[0] = plate 1 -> plate 1 is recommended.
  // preferredDirs([4,1,7], 1) = ['L','R'] (pos 1 < 4) -> dir is 'L'.
  const rec = recommendNext([4, 1, 7], m);
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, false);
  assert.equal(rec.plate, 1);
  assert.equal(rec.dir, 'L');
});

test('a blocked press is skipped even when it would be the safe pick', () => {
  const m = createMapping(3); // all interior, every probe safe
  const first = recommendNext([4, 3, 5], m);
  assert.equal(first.safe, true);
  const rec = recommendNext([4, 3, 5], m, new Set([`${first.plate}|${first.dir}`]));
  assert.equal(rec.type, 'probe');
  assert.equal(`${rec.plate}|${rec.dir}` === `${first.plate}|${first.dir}`, false);
});

test('tier-3 fallback skips blocked presses and never presses into a wall', () => {
  const m = createMapping(2); // nothing mapped, both plates on edges -> nothing safe
  // [1, 7]: plate 0 can only go L (R is into the wall), plate 1 only R.
  const rec = recommendNext([1, 7], m, new Set(['0|L']));
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, false);
  assert.deepEqual({ plate: rec.plate, dir: rec.dir }, { plate: 1, dir: 'R' });
});

test('reports stuck when every possible press is blocked and nothing is mapped', () => {
  const m = createMapping(2);
  const rec = recommendNext([1, 7], m, new Set(['0|L', '1|R']));
  assert.equal(rec.type, 'stuck');
  assert.match(rec.reason, /jam/i);
});

test('a link learned from a jam wiggle rules out presses that must jam', () => {
  const m = createMapping(3);
  // A reported wiggle taught us: pressing plate 0 moves plate 2 the same way.
  m.coupling[0][2] = 1;
  m.status[0] = 'partial';
  // Plate 0 at MIN, plate 2 at MAX: pressing plate 0 Left would push plate 2 to
  // 8 — a certain jam by what's known, so it must not be suggested even though
  // the player never reported that exact press at these positions.
  const rec = recommendNext([1, 4, 7], m);
  assert.equal(rec.type, 'probe');
  assert.deepEqual({ plate: rec.plate, dir: rec.dir }, { plate: 2, dir: 'R' });
});

test('unknown (zero) cells imply nothing — wiggle reports may be incomplete', () => {
  const m = createMapping(2);
  // Nothing learned beyond the self-cells: with no plate on a hostile edge for
  // the probed plate itself, the probe is still offered (conservatively risky).
  const rec = recommendNext([1, 7], m);
  assert.equal(rec.type, 'probe');
  assert.equal(rec.safe, false);
});

test('falls back to an edge-reducing plan when a full clear is impossible', () => {
  const m = createMapping(3);
  m.status[0] = 'done'; // mapped: moves only itself (default row)
  // plate 0 on MAX, plate 2 stranded on MIN where no mapped plate reaches it.
  const rec = recommendNext([7, 4, 1], m);
  assert.equal(rec.type, 'plan');
  assert.deepEqual(rec.moves, [{ plate: 0, dir: 'R' }]);
  assert.match(rec.reason, /edge/i);
});

test('when every untried press jams, suggests a known move to change the layout', () => {
  const m = createMapping(2);
  m.status[0] = 'done';
  // plate 1 at MIN: only L is physically possible, and the player saw it jam.
  // Moving mapped plate 0 cannot reduce edges, but it re-opens untried presses.
  const rec = recommendNext([4, 1], m, new Set(['1|L']));
  assert.equal(rec.type, 'plan');
  assert.deepEqual(rec.moves, [{ plate: 0, dir: 'L' }]);
  assert.match(rec.reason, /layout/i);
});

test('a safe probe that clears an edge gets an edge-aware reason', () => {
  const m = createMapping(3);
  const rec = recommendNext([3, 5, 7], m);
  assert.match(rec.reason, /edge/i);
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
