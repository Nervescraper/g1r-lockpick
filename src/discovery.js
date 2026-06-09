import { MIN, MAX, applyMove } from './model.js';
import { planEdgeClear } from './solver.js';

export function createMapping(n) {
  const coupling = Array.from({ length: n }, (_, i) => {
    const row = Array(n).fill(0);
    row[i] = 1; // every plate moves itself by default, even before it's mapped
    return row;
  });
  return { n, coupling, status: Array(n).fill('unstarted') };
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

function atEdge(positions, i) {
  return positions[i] <= MIN || positions[i] >= MAX;
}

// `blocked` holds presses the player reported as jamming at the CURRENT
// positions, as "plate|dir" strings — those are never suggested again until the
// positions change (the caller keys its memory by position).
export function recommendNext(positions, mapping, blocked = new Set()) {
  const candidates = [];
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] !== 'done') candidates.push(i);
  }
  if (candidates.length === 0) return null; // everything is mapped
  // Edge plates first (clear them before they block safe probing), then fresh before deferred.
  candidates.sort((a, b) => {
    const ea = atEdge(positions, a) ? 0 : 1;
    const eb = atEdge(positions, b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return candidateOrder(mapping.status[a]) - candidateOrder(mapping.status[b]);
  });

  // A press must be physically possible (not into the wall the slide sits on)
  // and not already reported as a jam here.
  const pressable = (plate, dir) => {
    if (dir === 'L' && positions[plate] >= MAX) return false;
    if (dir === 'R' && positions[plate] <= MIN) return false;
    return !blocked.has(`${plate}|${dir}`);
  };

  // 1) a guaranteed-safe probe (edge plates preferred, pressed toward center)
  for (const plate of candidates) {
    for (const dir of preferredDirs(positions, plate)) {
      if (pressable(plate, dir) && probeSafe(positions, mapping, plate, dir)) {
        return {
          type: 'probe',
          plate,
          dir,
          safe: true,
          reason: atEdge(positions, plate)
            ? 'On the edge — press toward center to clear it safely.'
            : 'Nothing this move can touch is at an edge, so it will go through cleanly.',
        };
      }
    }
  }

  // 2) an edge-clearing plan using already-mapped plates
  const donePlates = [];
  for (let i = 0; i < mapping.n; i++) {
    if (mapping.status[i] === 'done') donePlates.push(i);
  }
  const moves = planEdgeClear(positions, mapping.coupling, donePlates);
  if (moves && moves.length) {
    return {
      type: 'plan',
      moves,
      reason: 'Clear the edges first with these known moves, then the next probe is safe.',
    };
  }

  // 3) least-risky probe (no guaranteed-safe option, no clearing plan yet)
  for (const plate of candidates) {
    for (const dir of preferredDirs(positions, plate)) {
      if (!pressable(plate, dir)) continue;
      return {
        type: 'probe',
        plate,
        dir,
        safe: false,
        reason: 'No fully safe probe yet — some plates are at an edge. This is the least-risky option.',
      };
    }
  }

  // 4) every remaining press is known to jam at these positions
  return {
    type: 'stuck',
    reason: 'Every untried press jams at these positions — move a mapped slide to change the layout, or reset the pins.',
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
