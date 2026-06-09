import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePlates, coachingMessage } from '../src/ui/coaching.js';

test('edgePlates lists only plates on pin 1 or 7, with their position', () => {
  assert.deepEqual(edgePlates([4, 7, 2, 1]), [
    { plate: 1, pos: 7 },
    { plate: 3, pos: 1 },
  ]);
  assert.deepEqual(edgePlates([2, 4, 6]), []); // all interior
});

test('coachingMessage reports the safe state when nothing is on an edge', () => {
  assert.match(coachingMessage([2, 4, 6]), /safe to probe freely/i);
});

test('coachingMessage names the edge slides and uses singular for one', () => {
  const msg = coachingMessage([4, 7, 4]);
  assert.match(msg, /1 slide on the edge/i);
  assert.match(msg, /P2 \(pin 7\)/);
  assert.match(msg, /toward center/i);
});

test('coachingMessage uses plural and lists all edge slides', () => {
  const msg = coachingMessage([1, 4, 7]);
  assert.match(msg, /2 slides on the edge/i);
  assert.match(msg, /P1 \(pin 1\)/);
  assert.match(msg, /P3 \(pin 7\)/);
});
