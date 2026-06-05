export const MIN = 1;
export const MAX = 7;
export const GOAL = 4;

export function dirSign(dir) {
  return dir === 'L' ? 1 : -1;
}

export function moveDelta(coupling, plate, dir) {
  const s = dirSign(dir);
  // `+ 0` normalizes -0 (from -1 * 0) back to 0 so equality checks are clean
  return coupling[plate].map((v) => s * v + 0);
}

export function applyMove(positions, coupling, plate, dir) {
  const d = moveDelta(coupling, plate, dir);
  return positions.map((p, j) => p + d[j]);
}

export function isLegal(positions, coupling, plate, dir) {
  const np = applyMove(positions, coupling, plate, dir);
  return np.every((v) => v >= MIN && v <= MAX);
}

export function isSolved(positions) {
  return positions.every((v) => v === GOAL);
}

export function legalMoves(positions, coupling) {
  const out = [];
  for (let plate = 0; plate < positions.length; plate++) {
    for (const dir of ['L', 'R']) {
      if (isLegal(positions, coupling, plate, dir)) out.push({ plate, dir });
    }
  }
  return out;
}
