import test from 'node:test';
import assert from 'node:assert/strict';
import { semverGt, shouldShowBadge } from '../src/ui/changelog-badge.js';

test('semverGt: greater patch/minor/major is true', () => {
  assert.equal(semverGt('1.0.1', '1.0.0'), true);
  assert.equal(semverGt('1.1.0', '1.0.9'), true);
  assert.equal(semverGt('2.0.0', '1.9.9'), true);
});

test('semverGt: equal version is false', () => {
  assert.equal(semverGt('1.3.0', '1.3.0'), false);
});

test('semverGt: lesser version is false', () => {
  assert.equal(semverGt('1.0.0', '1.0.1'), false);
  assert.equal(semverGt('1.2.9', '1.3.0'), false);
});

test('semverGt: compares numerically, not lexically', () => {
  // '10' > '9' numerically, but '10' < '9' as strings
  assert.equal(semverGt('1.10.0', '1.9.0'), true);
});

test('semverGt: missing segments coerce to 0', () => {
  assert.equal(semverGt('1.3', '1.2.9'), true);
  assert.equal(semverGt('1.3', '1.3.0'), false);
  assert.equal(semverGt('2', '1.9.9'), true);
});

test('semverGt: malformed input never throws and is not greater', () => {
  assert.doesNotThrow(() => semverGt('abc', '1.0.0'));
  assert.equal(semverGt('abc', '1.0.0'), false);
  assert.equal(semverGt('1.0.0', 'abc'), true); // 1.0.0 > 0.0.0
  assert.equal(semverGt(undefined, '1.0.0'), false);
});

test('shouldShowBadge: unset last-seen shows the badge', () => {
  assert.equal(shouldShowBadge('1.3.0', undefined), true);
  assert.equal(shouldShowBadge('1.3.0', null), true);
  assert.equal(shouldShowBadge('1.3.0', ''), true);
});

test('shouldShowBadge: current greater than last-seen shows the badge', () => {
  assert.equal(shouldShowBadge('1.3.0', '1.2.0'), true);
});

test('shouldShowBadge: equal version hides the badge', () => {
  assert.equal(shouldShowBadge('1.3.0', '1.3.0'), false);
});

test('shouldShowBadge: last-seen ahead of current hides the badge', () => {
  assert.equal(shouldShowBadge('1.3.0', '1.4.0'), false);
});
