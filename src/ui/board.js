// Flat 2D board renderer. Rows are drawn P_n (top) → P1 (bottom) to match the game's
// front-at-bottom orientation. Each plate is a 7-hole slide that shifts left/right as a
// unit on a 13-column field; column 7 is the fixed keyway (goal). Optional per-row
// right-hand content (mapping controls) and row selection are supported so the mapping UI
// can live directly in the board.

export const FIELD_COLS = 13;
export const KEYWAY_COL = 7; // 1-based centre column of the field (the goal)

// Column geometry for a plate at position p (1..7) on the 13-wide field. The slide is 7
// holes wide and its pin is the middle hole, so pinCol(4) === KEYWAY_COL (position 4 = home).
export function slideCols(p) {
  return { startCol: p, pinCol: p + 3 };
}

export function createBoard(host, s) {
  host.classList.add('tp');
  host.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'tp-2d';

  const n = s.positions.length;
  for (let i = n - 1; i >= 0; i--) {
    const row = document.createElement('div');
    row.className = 'tp-2drow';
    if (s.selectable) row.classList.add('selectable');
    if (s.highlightPlate === i) row.classList.add('active2d');

    const lbl = document.createElement('div');
    lbl.className = 'tp-2dlabel';
    lbl.innerHTML = (s.labels && s.labels[i]) || `<b>P${i + 1}</b> · ${s.positions[i]}`;

    const holes = document.createElement('div');
    holes.className = 'tp-2dholes';
    for (let h = 0; h < 7; h++) {
      const hole = document.createElement('div');
      hole.className = 'tp-2dhole';
      if (h === 3) hole.classList.add('goal');
      if (h === s.positions[i] - 1) hole.classList.add('pin');
      holes.appendChild(hole);
    }

    if (s.selectable) {
      for (const el of [lbl, holes]) {
        el.dataset.action = 'select-plate';
        el.dataset.plate = String(i);
      }
    }

    row.appendChild(lbl);
    row.appendChild(holes);

    if (s.rowsRight && s.rowsRight[i]) {
      const right = document.createElement('div');
      right.className = 'tp-2dright';
      right.innerHTML = s.rowsRight[i];
      row.appendChild(right);
    }
    board.appendChild(row);
  }

  host.appendChild(board);
}
