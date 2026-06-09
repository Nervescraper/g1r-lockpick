// The simulated Gothic lock. This is "the game": it owns the hidden coupling and
// the real pin positions. The harness presses plates here and reports what it sees
// to the site UI — exactly the information a player at the real lock would have.
//
// Durability model (per the game): a press that would push any plate past an edge
// is BLOCKED — nothing moves, and the lockpick takes one point of damage (a
// "mistake"). The second mistake breaks the pick, and a break snaps every slide
// back to the original positions (a fresh pick is assumed).
import { MIN, MAX } from '../src/model.js';

const MISTAKES_PER_PICK = 1; // survivable mistakes; the next one breaks the pick

export class SimulatedLock {
  constructor(lock) {
    this.coupling = lock.coupling;
    this.initial = lock.initial.slice();
    this.positions = lock.initial.slice();
    this.mistakes = 0; // on the current pick
    this.totalMistakes = 0;
    this.breaks = 0;
  }

  // Press `plate` in direction 'L'|'R'. Returns what the player sees:
  //  - ok:      { blocked: false, deltas }   slides moved by `deltas`
  //  - mistake: { blocked: true, broke: false, wiggle }  nothing moved, pick damaged
  //  - break:   { blocked: true, broke: true, wiggle }   pick snapped, slides reset
  // `wiggle` lists the plates the game visibly wiggles on a jam — the ones the
  // press would have pushed past an edge.
  press(plate, dir) {
    const s = dir === 'L' ? 1 : -1;
    const deltas = this.coupling[plate].map((v) => s * v + 0);
    const next = this.positions.map((p, j) => p + deltas[j]);
    if (next.some((v) => v < MIN || v > MAX)) {
      const wiggle = [];
      next.forEach((v, j) => { if (v < MIN || v > MAX) wiggle.push(j); });
      this.totalMistakes++;
      if (this.mistakes >= MISTAKES_PER_PICK) {
        this.breaks++;
        this.mistakes = 0;
        this.positions = this.initial.slice();
        return { blocked: true, broke: true, wiggle };
      }
      this.mistakes++;
      return { blocked: true, broke: false, wiggle };
    }
    this.positions = next;
    return { blocked: false, deltas };
  }

  reset() {
    this.positions = this.initial.slice();
  }

  isSolved() {
    return this.positions.every((v) => v === 4);
  }
}
