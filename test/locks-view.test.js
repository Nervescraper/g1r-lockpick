import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLocks, parseSearch, matchLockContents, filterLocks } from '../src/locks-view.js';

const lock = (id, location, updatedAt) => ({ id, location, updatedAt });
const withItems = (id, ...items) => ({ id, contents: items.map((item) => ({ item, qty: 1 })) });

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

test('parseSearch: plain terms are includes, lowercased', () => {
  assert.deepEqual(parseSearch('Gold Sword'), { include: ['gold', 'sword'], exclude: [] });
});

test('parseSearch: leading dash makes a term exclude', () => {
  assert.deepEqual(parseSearch('gold -sword'), { include: ['gold'], exclude: ['sword'] });
});

test('parseSearch: bare dash and extra whitespace are ignored', () => {
  assert.deepEqual(parseSearch('  -  gold   -ore '), { include: ['gold'], exclude: ['ore'] });
});

test('parseSearch: empty / whitespace yields empty lists', () => {
  assert.deepEqual(parseSearch(''), { include: [], exclude: [] });
  assert.deepEqual(parseSearch('   '), { include: [], exclude: [] });
  assert.deepEqual(parseSearch(null), { include: [], exclude: [] });
});

test('matchLockContents: include requires ALL terms (substring, case-insensitive)', () => {
  const lck = withItems('a', 'Gold nugget', 'Rusty Sword');
  assert.equal(matchLockContents(lck, parseSearch('gold sword')), true);
  assert.equal(matchLockContents(lck, parseSearch('gold axe')), false);
  assert.equal(matchLockContents(lck, parseSearch('GOLD')), true);
});

test('matchLockContents: exclude drops a lock if ANY term matches', () => {
  const lck = withItems('a', 'Gold nugget', 'Rusty Sword');
  assert.equal(matchLockContents(lck, parseSearch('-sword')), false);
  assert.equal(matchLockContents(lck, parseSearch('-axe')), true);
  assert.equal(matchLockContents(lck, parseSearch('gold -sword')), false);
});

test('matchLockContents: empty contents passes exclude-only, fails any include', () => {
  const lck = { id: 'a', contents: [] };
  assert.equal(matchLockContents(lck, parseSearch('-gold')), true);
  assert.equal(matchLockContents(lck, parseSearch('gold')), false);
  assert.equal(matchLockContents(lck, parseSearch('')), true);
});

test('filterLocks: keeps matching locks in original order', () => {
  const locks = [withItems('a', 'Gold'), withItems('b', 'Sword'), withItems('c', 'Gold', 'Sword')];
  assert.deepEqual(filterLocks(locks, parseSearch('gold')).map((l) => l.id), ['a', 'c']);
  assert.deepEqual(filterLocks(locks, parseSearch('-gold')).map((l) => l.id), ['b']);
});
