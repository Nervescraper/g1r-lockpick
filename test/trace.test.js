import test from 'node:test';
import assert from 'node:assert/strict';
import { pushSnapshot, formatTrace, isLocalHost } from '../src/ui/trace.js';

test('pushSnapshot appends a snapshot', () => {
  const buf = [];
  pushSnapshot(buf, '{"a":1}');
  assert.deepEqual(buf, ['{"a":1}']);
});

test('pushSnapshot skips a no-op repeat of the last snapshot', () => {
  const buf = [];
  pushSnapshot(buf, '{"a":1}');
  pushSnapshot(buf, '{"a":1}');
  assert.deepEqual(buf, ['{"a":1}']);
  // a different snapshot after the repeat is still recorded
  pushSnapshot(buf, '{"a":2}');
  assert.deepEqual(buf, ['{"a":1}', '{"a":2}']);
});

test('pushSnapshot caps the buffer, dropping the oldest', () => {
  const buf = [];
  pushSnapshot(buf, 'a', 2);
  pushSnapshot(buf, 'b', 2);
  pushSnapshot(buf, 'c', 2);
  assert.deepEqual(buf, ['b', 'c']);
});

test('formatTrace produces a JSON array that parses back to the snapshots', () => {
  const buf = ['{"a":1}', '{"a":2}'];
  const out = formatTrace(buf);
  assert.deepEqual(JSON.parse(out), [{ a: 1 }, { a: 2 }]);
});

test('formatTrace of an empty buffer is an empty JSON array', () => {
  assert.equal(formatTrace([]), '[]');
});

test('isLocalHost recognizes local hostnames and rejects remote ones', () => {
  for (const h of ['localhost', '127.0.0.1', '', '::1', '[::1]']) {
    assert.equal(isLocalHost(h), true, h);
  }
  for (const h of ['example.com', 'g1r.app', '10.0.0.5']) {
    assert.equal(isLocalHost(h), false, h);
  }
});
