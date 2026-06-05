import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLocks,
  saveLock,
  getLock,
  deleteLock,
  saveSession,
  loadSession,
} from '../src/storage.js';

// minimal localStorage-compatible store for tests
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const lock = (id) => ({
  id,
  name: `Lock ${id}`,
  n: 3,
  coupling: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  notes: '',
});

test('loadLocks returns [] when nothing is stored', () => {
  assert.deepEqual(loadLocks(memStore()), []);
});

test('saveLock inserts then updates by id', () => {
  const s = memStore();
  saveLock(s, lock('a'));
  saveLock(s, lock('b'));
  assert.equal(loadLocks(s).length, 2);
  saveLock(s, { ...lock('a'), name: 'Renamed' });
  assert.equal(loadLocks(s).length, 2);
  assert.equal(getLock(s, 'a').name, 'Renamed');
});

test('deleteLock removes by id', () => {
  const s = memStore();
  saveLock(s, lock('a'));
  saveLock(s, lock('b'));
  deleteLock(s, 'a');
  assert.equal(getLock(s, 'a'), null);
  assert.equal(loadLocks(s).length, 1);
});

test('loadSession returns null when nothing is stored', () => {
  assert.equal(loadSession(memStore()), null);
});

test('saveSession then loadSession round-trips the working state', () => {
  const s = memStore();
  const session = { stage: 'solve', positions: [4, 3, 5], n: 3 };
  saveSession(s, session);
  assert.deepEqual(loadSession(s), session);
});
