import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapping, recommendNext, jamSignature, activeBlocks, dropJamsForPlate, wiggleEdgeBlock, dropWiggleBlock } from '../src/discovery.js';

// A jam can only happen when the press pushes some plate past an edge, and a
// plate can only be pushed past an edge if it is already sitting on one. So
// every possible blocker is among the plates on an edge at jam time. If all of
// them are still on their edges, the press is guaranteed to jam again — no
// matter where the interior (non-edge) plates have moved.

test('a jam stays blocked while every edge plate at jam-time persists, even when interior plates move', () => {
  // P4 (idx3) R jammed at 7,6,7,7,2,2,4 — plates 0, 2, 3 are on the top edge.
  const sig = jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R');
  // Later only P2 (idx1) slid 6 -> 5; the edge plates (0, 2, 3) are unchanged.
  const blocked = activeBlocks([7, 5, 7, 7, 2, 2, 4], [sig]);
  assert.equal(blocked.has('3|R'), true);
});

test('a jam is released once any edge plate from jam-time has cleared', () => {
  const sig = jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R');
  // P1 (idx0) cleared off the top edge (7 -> 6) — it might have been the blocker,
  // so the press becomes retryable.
  const blocked = activeBlocks([6, 6, 7, 7, 2, 2, 4], [sig]);
  assert.equal(blocked.has('3|R'), false);
});

test('activeBlocks still blocks at the exact position the jam was recorded', () => {
  const sig = jamSignature([6, 6, 7, 7, 1, 1, 4], 2, 'R');
  const blocked = activeBlocks([6, 6, 7, 7, 1, 1, 4], [sig]);
  assert.equal(blocked.has('2|R'), true);
});

test('dropJamsForPlate forgets a plate’s jams while keeping other plates’', () => {
  const jams = [
    jamSignature([6, 6, 7, 7, 1, 1, 4], 2, 'R'), // P3
    jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R'), // P4
    jamSignature([7, 6, 7, 7, 2, 2, 4], 2, 'R'), // P3
  ];
  const kept = dropJamsForPlate(jams, 2);
  assert.equal(kept.length, 1);
  assert.equal(kept[0], jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R'));
});

test('wiggleEdgeBlock records a per-wiggler veto when the tagged plate is on an edge', () => {
  // P1 (idx0) tagged wiggling on the top edge during a P4 (idx3) R jam.
  assert.equal(wiggleEdgeBlock(3, 'R', 0, 7), '3|R|0:7');
});

test('wiggleEdgeBlock returns null when the tagged plate is interior (no edge to blame)', () => {
  assert.equal(wiggleEdgeBlock(3, 'R', 0, 5), null);
});

test('a wiggle veto still blocks the press after the full-edge jam has released', () => {
  const fullEdge = jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R'); // edges 0:7,2:7,3:7
  const wiggle = wiggleEdgeBlock(3, 'R', 0, 7); // P1 tagged on edge 7
  const board = [7, 6, 6, 7, 2, 2, 4]; // P3 (idx2) cleared off 7; P1 (idx0) still on 7
  // The full-edge jam no longer applies (idx2 moved off its edge)...
  assert.equal(activeBlocks(board, [fullEdge]).has('3|R'), false);
  // ...but the tagged wiggler P1 is still on its edge, so the press stays blocked.
  assert.equal(activeBlocks(board, [fullEdge, wiggle]).has('3|R'), true);
});

test('dropWiggleBlock removes one wiggler’s veto but keeps the full-edge jam', () => {
  const fullEdge = jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R');
  const wiggle = wiggleEdgeBlock(3, 'R', 0, 7);
  const kept = dropWiggleBlock([fullEdge, wiggle], 3, 0);
  assert.deepEqual(kept, [fullEdge]);
});

test('recommendNext avoids a press whose tagged wiggler still sits on its edge', () => {
  const m = createMapping(7);
  m.coupling[0] = [1, 0, 0, 0, 0, 1, 0];
  m.status = ['done', 'done', 'partial', 'partial', 'done', 'unstarted', 'unstarted'];
  const board = [7, 6, 6, 7, 2, 2, 4]; // P3 cleared; P1 (idx0) & P4 (idx3) still on 7
  const blocks = [
    jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R'), // full-edge jam, now released
    wiggleEdgeBlock(3, 'R', 0, 7), // P1 tagged wiggling on edge 7 under P4 R
  ];
  const blocked = activeBlocks(board, blocks);
  const rec = recommendNext(board, m, blocked);
  assert.equal(rec.type === 'probe' && rec.plate === 3 && rec.dir === 'R', false);
  assert.equal(blocked.has(`${rec.plate}|${rec.dir}`), false);
});

test('recommendNext will not re-suggest a press its own blocked-memory rules out', () => {
  // Reconstruct the trace state right after P2 was mapped (positions 7,5,7,7,2,2,4):
  // P1, P3, P4 sit on the top edge; P4 R and P3 R have both jammed earlier on this
  // same wall of edge plates. Neither should be offered again.
  const m = createMapping(7);
  m.coupling[0] = [1, 0, 0, 0, 0, 1, 0];
  m.status = ['done', 'done', 'partial', 'partial', 'done', 'unstarted', 'unstarted'];
  const positions = [7, 5, 7, 7, 2, 2, 4];
  const jams = [
    jamSignature([7, 6, 7, 7, 2, 2, 4], 3, 'R'), // P4 R
    jamSignature([7, 6, 7, 7, 2, 2, 4], 2, 'R'), // P3 R
  ];
  const blocked = activeBlocks(positions, jams);
  const rec = recommendNext(positions, m, blocked);
  assert.equal(rec.type, 'probe');
  assert.equal(blocked.has(`${rec.plate}|${rec.dir}`), false);
});
