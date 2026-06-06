// Flat 2D board renderer. Rows are drawn P_n (top) → P1 (bottom) to match the game's
// front-at-bottom orientation. Each plate is a 7-hole slide that shifts left/right as a
// unit on a 13-column field; column 7 is the fixed keyway (goal). Optional per-row
// right-hand content (mapping controls) and row selection are supported so the mapping UI
// can live directly in the board.

export const FIELD_COLS = 13;
export const KEYWAY_COL = 7; // 1-based centre column of the field (the goal)

// Column geometry for a plate at position p (1..7) on the 13-wide field. The pin is the
// fixed keyway (column 7); position p is which of the slide's 7 holes sits over it. So the
// slide shifts as a unit: p=1 puts the leftmost hole on the keyway (slide hard right), p=7
// the rightmost hole (slide hard left), p=4 the middle hole (home). This matches the model's
// direction sense, where a higher position means the slide has moved left.
export function slideCols(p) {
  return { startCol: KEYWAY_COL + 1 - p, pinCol: KEYWAY_COL };
}

// Snap a drag to a 1..7 position. Dragging right (positive column delta) moves the slide
// right, which lowers the position number (startCol = 8 - p), so we subtract the delta.
export function dragToPosition(startPos, dxCols) {
  return Math.max(1, Math.min(7, startPos - dxCols));
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

    const lbl = document.createElement('div');
    lbl.className = 'tp-2dlabel';
    lbl.innerHTML = (s.labels && s.labels[i]) || `<b>P${i + 1}</b> · ${s.positions[i]}`;

    const field = document.createElement('div');
    field.className = 'tp-field';

    const { startCol, pinCol } = slideCols(s.positions[i]);

    const tray = document.createElement('div');
    tray.className = 'tp-tray';
    if (s.highlightPlate === i) tray.classList.add(s.highlightKind === 'next' ? 'next' : 'sel');
    tray.style.gridColumn = `${startCol} / span 7`;
    field.appendChild(tray);

    for (let c = startCol; c < startCol + 7; c++) {
      const hole = document.createElement('div');
      hole.className = 'tp-hole2';
      if (c === pinCol) {
        hole.classList.add('pin');
        if (s.positions[i] === 4) hole.classList.add('ok');
      }
      hole.style.gridColumn = String(c);
      field.appendChild(hole);
    }

    if (s.draggable) {
      const slideEls = [tray, ...field.querySelectorAll('.tp-hole2')];
      for (const el of slideEls) {
        el.style.cursor = 'grab';
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startPos = s.positions[i];
          const colW = field.getBoundingClientRect().width / FIELD_COLS;
          let lastPos = startPos;
          document.body.classList.add('tp-dragging');
          s.onSetPosition?.(i, startPos); // selecting the plate (no-move click)
          const onMove = (ev) => {
            const dxCols = Math.round((ev.clientX - startX) / colW);
            const next = dragToPosition(startPos, dxCols);
            if (next !== lastPos) { lastPos = next; s.onSetPosition?.(i, next); }
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.classList.remove('tp-dragging');
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }
    }

    if (s.selectable) {
      for (const el of [lbl, field]) {
        el.dataset.action = 'select-plate';
        el.dataset.plate = String(i);
      }
    }

    row.appendChild(lbl);
    row.appendChild(field);

    if (s.rowsRight && s.rowsRight[i]) {
      const right = document.createElement('div');
      right.className = 'tp-2dright';
      right.innerHTML = s.rowsRight[i];
      row.appendChild(right);
    }
    board.appendChild(row);
  }

  // one dashed keyway box over column 7, spanning all rows (positioned by CSS)
  const keybox = document.createElement('div');
  keybox.className = 'tp-keybox';
  board.appendChild(keybox);

  host.appendChild(board);
}
