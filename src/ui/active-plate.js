// Advance the Setup active-plate cursor P1->Pn, stopping at the last plate (no wrap).
export function nextActivePlate(active, n) {
  return Math.min(active + 1, n - 1);
}
