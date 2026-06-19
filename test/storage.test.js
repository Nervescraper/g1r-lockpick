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
  sanitizeContents,
  sanitizePhotos,
  splitPhotos,
  attachPhotos,
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

// updatedAt is volatile bookkeeping, not lock content: a same-id record that differs
// ONLY by its timestamp (or by having/lacking one) is the same lock and must be treated
// as identical — not a phantom conflict where every visible field matches.
test('classifyImport: same id, identical but incoming lacks updatedAt → identical', () => {
  const existing = [fullLock('a', { updatedAt: 1780000000000 })];
  const inc = [fullLock('a')]; // e.g. an export predating the updatedAt field
  const { identical, conflicts } = classifyImport(inc, existing);
  assert.equal(identical.length, 1);
  assert.equal(conflicts.length, 0);
});

test('classifyImport: same id, differs only by updatedAt value → identical', () => {
  const existing = [fullLock('a', { updatedAt: 1780000000000 })];
  const inc = [fullLock('a', { updatedAt: 1780000099999 })];
  const { identical, conflicts } = classifyImport(inc, existing);
  assert.equal(identical.length, 1);
  assert.equal(conflicts.length, 0);
});

test('classifyImport: same id, real content differs → still conflict even if updatedAt also differs', () => {
  const existing = [fullLock('a', { updatedAt: 1780000000000 })];
  const inc = [fullLock('a', { initial: [1, 1, 1], updatedAt: 1780000099999 })];
  const { identical, conflicts } = classifyImport(inc, existing);
  assert.equal(conflicts.length, 1);
  assert.equal(identical.length, 0);
});

test('sameIdentity matches on trimmed/lowercased location+type+description', () => {
  const a = { location: 'Old Camp', kind: 'Door', description: 'Behind Throne' };
  const b = { location: ' old camp ', kind: 'Door', description: 'behind throne' };
  const c = { location: 'Old Camp', kind: 'Chest', description: 'Behind Throne' };
  assert.equal(sameIdentity(a, b), true);
  assert.equal(sameIdentity(a, c), false);
});

// ---------- contents (loot list) ----------

test('sanitizeContents trims items, coerces qty to int >= 1, drops blank items', () => {
  const out = sanitizeContents([
    { item: '  Gold coins ', qty: 3 },
    { item: 'Half', qty: 2.7 }, // floored
    { item: 'Free', qty: 0 }, // bumped to 1
    { item: 'NaN qty', qty: 'x' }, // defaults to 1
    { item: '   ', qty: 5 }, // blank → dropped
    { item: '', qty: 1 }, // blank → dropped
    'not an object', // → dropped
  ]);
  assert.deepEqual(out, [
    { item: 'Gold coins', qty: 3 },
    { item: 'Half', qty: 2 },
    { item: 'Free', qty: 1 },
    { item: 'NaN qty', qty: 1 },
  ]);
});

test('sanitizeContents returns [] for non-array / missing input', () => {
  assert.deepEqual(sanitizeContents(undefined), []);
  assert.deepEqual(sanitizeContents(null), []);
  assert.deepEqual(sanitizeContents('nope'), []);
  assert.deepEqual(sanitizeContents({}), []);
});

test('parseImport sanitizes a lock’s contents (drops blanks, coerces qty)', () => {
  const text = exportLocks([
    fullLock('a', {
      contents: [
        { item: ' Gold ', qty: 2.9 },
        { item: '', qty: 4 }, // blank → dropped
        { item: 'Note', qty: 0 }, // → qty 1
      ],
    }),
  ]);
  const { locks } = parseImport(text);
  assert.deepEqual(locks[0].contents, [
    { item: 'Gold', qty: 2 },
    { item: 'Note', qty: 1 },
  ]);
});

test('parseImport replaces a malformed contents field with []', () => {
  const text = exportLocks([fullLock('a', { contents: 'junk' })]);
  const { locks } = parseImport(text);
  assert.deepEqual(locks[0].contents, []);
});

test('parseImport leaves a lock without contents untouched (no field added)', () => {
  const text = exportLocks([fullLock('a')]); // fullLock has no contents
  const { locks } = parseImport(text);
  assert.equal('contents' in locks[0], false);
});

test('classifyImport: same id, only contents differ → conflict', () => {
  const existing = [fullLock('a', { contents: [{ item: 'Gold', qty: 1 }] })];
  const inc = [fullLock('a', { contents: [{ item: 'Gold', qty: 2 }] })];
  const { conflicts, identical } = classifyImport(inc, existing);
  assert.equal(conflicts.length, 1);
  assert.equal(identical.length, 0);
});

test('classifyImport: identical contents → still identical (skipped)', () => {
  const existing = [fullLock('a', { contents: [{ item: 'Gold', qty: 1 }] })];
  const inc = [fullLock('a', { contents: [{ item: 'Gold', qty: 1 }] })];
  const { identical, conflicts } = classifyImport(inc, existing);
  assert.equal(identical.length, 1);
  assert.equal(conflicts.length, 0);
});

// ---------- updatedAt validation ----------

test('parseImport: accepts a lock with a numeric updatedAt', () => {
  const env = { format: 'g1r-locks', version: 1, locks: [{ id: 'a', n: 3, updatedAt: 1700000000000 }] };
  const out = parseImport(JSON.stringify(env));
  assert.equal(out.locks.length, 1);
  assert.equal(out.invalidCount, 0);
});

test('parseImport: accepts a lock with no updatedAt', () => {
  const env = { format: 'g1r-locks', version: 1, locks: [{ id: 'a', n: 3 }] };
  const out = parseImport(JSON.stringify(env));
  assert.equal(out.locks.length, 1);
  assert.equal(out.invalidCount, 0);
});

test('parseImport: rejects a lock whose updatedAt is not a number', () => {
  const env = { format: 'g1r-locks', version: 1, locks: [{ id: 'a', n: 3, updatedAt: 'soon' }] };
  const out = parseImport(JSON.stringify(env));
  assert.equal(out.locks.length, 0);
  assert.equal(out.invalidCount, 1);
});

test('sanitizePhotos keeps image data URLs and caps at 2', () => {
  const a = 'data:image/jpeg;base64,AAAA';
  const b = 'data:image/png;base64,BBBB';
  const c = 'data:image/jpeg;base64,CCCC';
  assert.deepEqual(sanitizePhotos([a, b, c]), [a, b]);
});

test('sanitizePhotos drops non-string and non-image entries', () => {
  assert.deepEqual(
    sanitizePhotos(['data:image/jpeg;base64,AAAA', 'http://x/y.png', 42, null, '']),
    ['data:image/jpeg;base64,AAAA'],
  );
});

test('sanitizePhotos returns [] for non-array input', () => {
  assert.deepEqual(sanitizePhotos(undefined), []);
  assert.deepEqual(sanitizePhotos(null), []);
  assert.deepEqual(sanitizePhotos('nope'), []);
  assert.deepEqual(sanitizePhotos({}), []);
});

test('splitPhotos strips photos into a separate array and sets photoCount', () => {
  const lock = { id: 'a', n: 3, photos: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'] };
  const { record, photos } = splitPhotos(lock);
  assert.equal('photos' in record, false);
  assert.equal(record.photoCount, 2);
  assert.deepEqual(photos, ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB']);
});

test('splitPhotos on a lock with no photos yields photoCount 0 and empty array', () => {
  const { record, photos } = splitPhotos({ id: 'a', n: 3 });
  assert.equal(record.photoCount, 0);
  assert.deepEqual(photos, []);
});

test('splitPhotos drops malformed photo entries via sanitizePhotos', () => {
  const { record, photos } = splitPhotos({ id: 'a', n: 3, photos: ['nope', 'data:image/png;base64,CCCC'] });
  assert.equal(record.photoCount, 1);
  assert.deepEqual(photos, ['data:image/png;base64,CCCC']);
});

test('attachPhotos adds a photos array to a record copy without mutating the input', () => {
  const record = { id: 'a', n: 3, photoCount: 1 };
  const out = attachPhotos(record, ['data:image/jpeg;base64,AAAA']);
  assert.deepEqual(out.photos, ['data:image/jpeg;base64,AAAA']);
  assert.equal('photos' in record, false); // original untouched
});

test('attachPhotos with no photos omits the field', () => {
  const out = attachPhotos({ id: 'a', n: 3, photoCount: 0 }, []);
  assert.equal('photos' in out, false);
});
