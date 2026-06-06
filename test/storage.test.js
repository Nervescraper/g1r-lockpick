import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLocks,
  saveLock,
  getLock,
  deleteLock,
  saveSession,
  loadSession,
  exportLocks,
  encodeShare,
  parseImport,
  classifyImport,
  sameIdentity,
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

// ---------- import / export ----------

const fullLock = (id, over = {}) => ({
  id,
  name: `Lock ${id}`,
  location: `Loc ${id}`,
  kind: 'Chest',
  description: '',
  n: 3,
  initial: [4, 3, 5],
  coupling: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  status: ['done', 'done', 'done'],
  notes: '',
  ...over,
});

test('exportLocks → parseImport round-trips a multi-lock set', () => {
  const locks = [fullLock('a'), fullLock('b')];
  const text = exportLocks(locks);
  const { locks: out, invalidCount } = parseImport(text);
  assert.equal(invalidCount, 0);
  assert.deepEqual(out, locks);
});

test('encodeShare → parseImport round-trips a single lock', () => {
  const lock = fullLock('a');
  const { locks: out, invalidCount } = parseImport(encodeShare(lock));
  assert.equal(invalidCount, 0);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], lock);
});

test('parseImport drops malformed records and counts them', () => {
  const text = exportLocks([
    fullLock('ok'),
    fullLock('bad-n', { n: 99 }),
    fullLock('bad-coupling', { coupling: [[1, 0], [0, 1]] }), // not n×n
    { id: '', n: 3 }, // empty id
  ]);
  const { locks, invalidCount } = parseImport(text);
  assert.equal(locks.length, 1);
  assert.equal(locks[0].id, 'ok');
  assert.equal(invalidCount, 3);
});

test('parseImport rejects non-g1r JSON and garbage', () => {
  assert.equal(parseImport('{"hello":"world"}'), null);
  assert.equal(parseImport('not json at all'), null);
  assert.equal(parseImport(''), null);
});

test('classifyImport: empty store → all fresh', () => {
  const inc = [fullLock('a'), fullLock('b')];
  const { fresh, identical, conflicts } = classifyImport(inc, []);
  assert.equal(fresh.length, 2);
  assert.equal(identical.length, 0);
  assert.equal(conflicts.length, 0);
});

test('classifyImport: re-import of identical content → all identical', () => {
  const existing = [fullLock('a')];
  const { fresh, identical, conflicts } = classifyImport([fullLock('a')], existing);
  assert.equal(identical.length, 1);
  assert.equal(fresh.length, 0);
  assert.equal(conflicts.length, 0);
});

test('classifyImport: same id, changed content → conflict', () => {
  const existing = [fullLock('a')];
  const inc = [fullLock('a', { initial: [1, 1, 1] })];
  const { conflicts } = classifyImport(inc, existing);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].incoming.id, 'a');
  assert.equal(conflicts[0].existing.id, 'a');
});

test('classifyImport: different id, same identity → conflict', () => {
  const existing = [fullLock('a', { location: 'Old Camp', description: 'gate' })];
  const inc = [fullLock('z', { location: 'old camp ', description: 'GATE' })];
  const { conflicts, fresh } = classifyImport(inc, existing);
  assert.equal(conflicts.length, 1);
  assert.equal(fresh.length, 0);
});

test('classifyImport: different id, different identity → fresh', () => {
  const existing = [fullLock('a', { location: 'Old Camp' })];
  const inc = [fullLock('z', { location: 'New Camp' })];
  const { fresh } = classifyImport(inc, existing);
  assert.equal(fresh.length, 1);
});

test('sameIdentity matches on trimmed/lowercased location+type+description', () => {
  const a = { location: 'Old Camp', kind: 'Door', description: 'Behind Throne' };
  const b = { location: ' old camp ', kind: 'Door', description: 'behind throne' };
  const c = { location: 'Old Camp', kind: 'Chest', description: 'Behind Throne' };
  assert.equal(sameIdentity(a, b), true);
  assert.equal(sameIdentity(a, c), false);
});
