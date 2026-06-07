import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLocks } from '../src/locks-view.js';

const lock = (id, location, updatedAt) => ({ id, location, updatedAt });

test('groupLocks: empty input yields empty recent and folders', () => {
  const out = groupLocks([]);
  assert.deepEqual(out.recent, []);
  assert.deepEqual(out.folders, []);
});

test('groupLocks: recent holds the 5 most recent by updatedAt desc', () => {
  const locks = [1, 2, 3, 4, 5, 6, 7].map((i) => lock(`l${i}`, 'Camp', i * 1000));
  const out = groupLocks(locks);
  assert.equal(out.recent.length, 5);
  assert.deepEqual(out.recent.map((l) => l.id), ['l7', 'l6', 'l5', 'l4', 'l3']);
});

test('groupLocks: undated locks sort after dated ones in recent', () => {
  const locks = [lock('a', 'Camp', undefined), lock('b', 'Camp', 100), lock('c', 'Camp', undefined)];
  const out = groupLocks(locks);
  // dated first, then undated in original relative order
  assert.deepEqual(out.recent.map((l) => l.id), ['b', 'a', 'c']);
});

test('groupLocks: groups by location, sorted alpha, Other last', () => {
  const locks = [
    lock('a', 'Old Camp', 3),
    lock('b', 'Khorinis', 2),
    lock('c', '', 1),
  ];
  const out = groupLocks(locks);
  assert.deepEqual(out.folders.map((f) => f.label), ['Khorinis', 'Old Camp', 'Other']);
});

test('groupLocks: blank/whitespace location goes to Other with __other__ key', () => {
  const out = groupLocks([lock('a', '   ', 1), lock('b', undefined, 2)]);
  assert.equal(out.folders.length, 1);
  assert.equal(out.folders[0].label, 'Other');
  assert.equal(out.folders[0].key, '__other__');
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['b', 'a']); // updatedAt desc
});

test('groupLocks: a recent lock also appears in its folder', () => {
  const locks = [lock('a', 'Old Camp', 5)];
  const out = groupLocks(locks);
  assert.deepEqual(out.recent.map((l) => l.id), ['a']);
  assert.equal(out.folders.length, 1);
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['a']);
});

test('groupLocks: folder sort is case-insensitive', () => {
  const out = groupLocks([lock('a', 'old camp', 1), lock('b', 'Khorinis', 2)]);
  assert.deepEqual(out.folders.map((f) => f.label), ['Khorinis', 'old camp']);
});

test('groupLocks: locks within a folder are sorted updatedAt desc', () => {
  const out = groupLocks([lock('a', 'Camp', 1), lock('b', 'Camp', 3), lock('c', 'Camp', 2)]);
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['b', 'c', 'a']);
});

test('groupLocks: a literal "Other" location merges into the blank-location bucket', () => {
  const out = groupLocks([
    { id: 'a', location: 'Other', updatedAt: 2 },
    { id: 'b', location: '', updatedAt: 1 },
  ]);
  assert.equal(out.folders.length, 1);
  assert.equal(out.folders[0].key, '__other__');
  assert.equal(out.folders[0].label, 'Other');
  assert.deepEqual(out.folders[0].locks.map((l) => l.id), ['a', 'b']);
});
