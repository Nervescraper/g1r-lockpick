// Dev-only session tracing. When the site runs from localhost, app.js feeds
// every persisted session snapshot through pushSnapshot so a problematic run can
// be copied out verbatim (formatTrace) and replayed. Kept pure and dependency-
// free so it can be unit tested; the DOM wiring lives in app.js.

const MAX_SNAPSHOTS = 1000;

// Append a serialized session snapshot, skipping a no-op repeat of the last one
// and capping the buffer so a long session can't grow without bound. Mutates and
// returns the buffer.
export function pushSnapshot(buffer, json, max = MAX_SNAPSHOTS) {
  if (buffer.length && buffer[buffer.length - 1] === json) return buffer;
  buffer.push(json);
  if (buffer.length > max) buffer.shift();
  return buffer;
}

// The clipboard payload: a JSON array of the raw snapshot strings, ready to paste
// straight back for replay.
export function formatTrace(buffer) {
  return `[${buffer.join(',')}]`;
}

// Hostnames where the dev trace UI is offered: localhost, the loopback IPs, and
// file:// (empty hostname).
export function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
