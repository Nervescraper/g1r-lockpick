import { MIN, MAX, applyMove, isLegal } from './model.js';

export function createMapping(n) {
  return {
    n,
    coupling: Array.from({ length: n }, () => Array(n).fill(0)),
    status: Array(n).fill('unstarted'),
  };
}

// Convert an observed screen shift ('L' = +1) into the Left-press effect value,
// accounting for which direction was actually probed.
export function leftEffect(probeDir, shift) {
  return (probeDir === 'L' ? 1 : -1) * (shift === 'L' ? 1 : -1);
}

export function recordShifts(mapping, plate, probeDir, shifts) {
  for (const j of Object.keys(shifts)) {
    mapping.coupling[plate][Number(j)] = leftEffect(probeDir, shifts[j]);
  }
}

// A probe is "guaranteed not to block" when:
//  - the selected plate itself won't be pushed past an edge by its own +/-1, and
//  - every OTHER plate is strictly interior (2..6), so any unknown +/-1 coupling
//    on it still lands in 1..7.
// Unknown cells are stored as 0, indistinguishable from a true zero, so we stay
// conservative: any other plate at an edge makes the probe unsafe.
export function probeSafe(positions, mapping, plate, dir) {
  const sel = positions[plate];
  if (dir === 'L' && sel === MAX) return false;
  if (dir === 'R' && sel === MIN) return false;
  for (let j = 0; j < positions.length; j++) {
    if (j === plate) continue;
    if (positions[j] <= MIN || positions[j] >= MAX) return false;
  }
  return true;
}

function preferredDirs(positions, plate) {
  // try the direction that moves the selected plate toward center first
  return positions[plate] > 4 ? ['R', 'L'] : ['L', 'R'];
}

function candidateOrder(status) {
  // unstarted (0) before partial (1); 'done' excluded by caller. Deferring a plate
  // marks it 'partial', so it is revisited only after fresh plates — otherwise the
  // just-deferred plate would be recommended again immediately.
  return status === 'unstarted' ? 0 : 1;
}

// Among fully-mapped plates, find a legal known move that pulls a plate currently
// at an edge toward center. Used to de-risk a future probe.
function findPrepMove(positions, mapping) {
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') continue;
    for (const dir of ['L', 'R']) {
      if (!isLegal(positions, mapping.coupling, i, dir)) continue;
      const np = applyMove(positions, mapping.coupling, i, dir);
      let improves = false;
      for (let j = 0; j < mapping.n; j++) {
        const atEdge = positions[j] === MIN || positions[j] === MAX;
        if (atEdge && Math.abs(np[j] - 4) < Math.abs(positions[j] - 4)) improves = true;
      }
      if (improves) {
        return {
          type: 'prep',
          plate: i,
          dir,
          reason:
            'Move a known plate first to pull an edge plate toward center, making the next probe safe.',
        };
      }
    }
  }
  return null;
}

export function recommendNext(positions, mapping) {
  const candidates = [];
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') candidates.push(i);
  }
  if (candidates.length === 0) return null; // everything is mapped
  candidates.sort(
    (a, b) => candidateOrder(mapping.status[a]) - candidateOrder(mapping.status[b])
  );

  // 1) a guaranteed-safe probe
  for (const plate of candidates) {
    for (const dir of preferredDirs(positions, plate)) {
      if (probeSafe(positions, mapping, plate, dir)) {
        return {
          type: 'probe',
          plate,
          dir,
          safe: true,
          reason: 'Nothing this move can touch is at an edge, so it will go through cleanly.',
        };
      }
    }
  }

  // 2) a prep move that de-risks using known relationships
  const prep = findPrepMove(positions, mapping);
  if (prep) return prep;

  // 3) least-risky probe (no guaranteed-safe option yet)
  const plate = candidates[0];
  const dir = preferredDirs(positions, plate)[0];
  return {
    type: 'probe',
    plate,
    dir,
    safe: false,
    reason: 'No fully safe probe yet — some plates are at an edge. This is the least-risky option.',
  };
}

export function applyProbe(positions, mapping, plate, dir, shifts, { complete = true } = {}) {
  recordShifts(mapping, plate, dir, shifts);
  mapping.status[plate] = complete ? 'done' : 'partial';
  // positions advance by exactly what was observed (the recorded row reproduces it)
  return applyMove(positions, mapping.coupling, plate, dir);
}

export function defer(mapping, plate) {
  if (mapping.status[plate] !== 'done') mapping.status[plate] = 'partial';
}

export function allMapped(mapping) {
  return mapping.status.every((s) => s === 'done');
}
