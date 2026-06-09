import { MIN, MAX, applyMove, isLegal, dirSign } from './model.js';
import { planEdgeClear, planEdgeReduce } from './solver.js';

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
// `softLinks` holds "i|j" pairs known to be linked with UNKNOWN sign (a slide
// seen wiggling on one of plate i's jams). They can't rule a press out — the
// link may move the slide inward — but they raise its risk: a soft link to an
// edge slide is a coin flip, worse than a fully unknown cell.
export function recommendNext(positions, mapping, blocked = new Set(), softLinks = new Set()) {
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

  // A press must be physically possible (not into the wall the slide sits on),
  // not already reported as a jam here, and not a *certain* jam by what's been
  // learned: nonzero cells (from a recorded probe or a reported wiggle) are
  // exact, so a known link that would push a plate past an edge disqualifies
  // the press. Zero cells may merely be unlearned — wiggle reports can be
  // incomplete — so they imply nothing.
  const pressable = (plate, dir) => {
    if (dir === 'L' && positions[plate] >= MAX) return false;
    if (dir === 'R' && positions[plate] <= MIN) return false;
    if (blocked.has(`${plate}|${dir}`)) return false;
    const s = dirSign(dir);
    const row = mapping.coupling[plate];
    for (let j = 0; j < row.length; j++) {
      if (row[j] === 0) continue;
      const np = positions[j] + s * row[j];
      if (np < MIN || np > MAX) return false;
    }
    return true;
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
      reason: 'Clear the edges with these known moves — then probing is safe.',
    };
  }

  // 2b) a full clear is impossible (some edge plates aren't reachable from the
  // mapped ones) — but freeing even one edge with known moves beats probing blind.
  const reduce = planEdgeReduce(positions, mapping.coupling, donePlates);
  if (reduce && reduce.length) {
    return {
      type: 'plan',
      moves: reduce,
      reason: 'A full edge-clear isn’t possible yet — these known moves pull a slide off an edge, so the next probe risks less.',
    };
  }

  // 3) least-risky probe (no guaranteed-safe option, no clearing plan yet).
  // Risk of a press = the chance some OTHER edge slide gets pushed past its
  // edge: a known cell contributes nothing (pressable already removed certain
  // jams, so it moves inward), a soft link 1/2, a fully unknown cell 1/3.
  // Candidates were sorted above, so the first minimum keeps that tie-break.
  let least = null;
  for (const plate of candidates) {
    for (const dir of preferredDirs(positions, plate)) {
      if (!pressable(plate, dir)) continue;
      let risk = 0;
      for (let j = 0; j < mapping.n; j++) {
        if (j === plate || (positions[j] > MIN && positions[j] < MAX)) continue;
        if (mapping.coupling[plate][j] !== 0) continue;
        risk += softLinks.has(`${plate}|${j}`) ? 1 / 2 : 1 / 3;
      }
      if (!least || risk < least.risk) least = { plate, dir, risk };
    }
  }
  if (least) {
    return {
      type: 'probe',
      plate: least.plate,
      dir: least.dir,
      safe: false,
      reason: 'No fully safe probe yet — some plates are at an edge. This is the least-risky option.',
    };
  }

  // 4) every untried press jams here. Any legal known move changes the layout,
  // which re-opens presses that haven't been tried at the new positions.
  for (const plate of donePlates) {
    for (const dir of ['L', 'R']) {
      if (!isLegal(positions, mapping.coupling, plate, dir)) continue;
      return {
        type: 'plan',
        moves: [{ plate, dir }],
        reason: 'Every untried press jams here — this known move changes the layout so new presses open up.',
      };
    }
  }
  return {
    type: 'stuck',
    reason: 'Every untried press jams and no mapped slide can move — reset the pins to start from a known state.',
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
