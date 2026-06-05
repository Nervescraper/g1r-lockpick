// Pure board renderer. No engine logic — it only draws positions.
// createBoard(host, state) builds the 3D + 2D board into `host` and returns
// { align } so the caller can re-measure gutter labels after layout.

const GOAL_INDEX = 3; // hole index for pin position 4

export function createBoard(host, s) {
  const n = s.positions.length;
  host.classList.add('tp');
  host.classList.toggle('basic', !!s.basic);
  host.innerHTML = '';

  const view3d = document.createElement('div');
  view3d.className = 'tp-view3d';
  const stage = document.createElement('div');
  stage.className = 'tp-stage';
  view3d.appendChild(stage);

  const view2d = document.createElement('div');
  view2d.className = 'tp-view2d';

  host.appendChild(view3d);
  host.appendChild(view2d);

  const step = Math.max(30, 40 - Math.max(0, n - 5) * 2);
  stage.style.height = `${150 + n * step + 40}px`;
  stage.style.width = '430px';

  // plates: index 0 = front (nearest)
  for (let i = 0; i < n; i++) {
    const plate = document.createElement('div');
    plate.className = 'tp-plate';
    const tx = Math.round(i * step * 0.74);
    const ty = -i * step;
    const sc = (1 - i * 0.022).toFixed(3);
    const bright = (1.05 - i * 0.07).toFixed(2);
    plate.style.transform =
      `translate3d(${tx}px, ${ty}px, 0) rotateX(54deg) rotateZ(10deg) scale(${sc})`;
    plate.style.zIndex = String((n - i) * 10);
    plate.style.filter = `brightness(${bright})`;
    if (s.highlightPlate === i) plate.classList.add('probe');
    else if (s.dimOthers) plate.classList.add('dim');
    if (s.selectable) {
      plate.classList.add('selectable');
      plate.dataset.action = 'select-plate';
      plate.dataset.plate = String(i);
    }

    const pos = s.positions[i];
    for (let h = 0; h < 7; h++) {
      const hole = document.createElement('div');
      hole.className = 'tp-hole';
      if (h === GOAL_INDEX) hole.classList.add('goal');
      if (h === pos - 1) hole.classList.add('pin');
      plate.appendChild(hole);
    }
    stage.appendChild(plate);
  }

  // upright gutter labels (positioned by align())
  const labels = [];
  for (let i = 0; i < n; i++) {
    const lab = document.createElement('span');
    lab.className = 'tp-flatlabel';
    const info = (s.labels && s.labels[i]) || { html: `<b>P${i + 1}</b> · ${s.positions[i]}` };
    lab.innerHTML = info.html;
    if (info.active) lab.classList.add('on');
    stage.appendChild(lab);
    labels.push(lab);
  }

  // 2D fallback rows
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'tp-2drow';
    if (s.selectable) {
      row.classList.add('selectable');
      row.dataset.action = 'select-plate';
      row.dataset.plate = String(i);
    }
    if (s.highlightPlate === i) row.classList.add('active2d');
    const lbl = document.createElement('div');
    lbl.className = 'tp-2dlabel';
    lbl.innerHTML = (s.labels && s.labels[i] && s.labels[i].html) || `<b>P${i + 1}</b> · ${s.positions[i]}`;
    const holes = document.createElement('div');
    holes.className = 'tp-2dholes';
    for (let h = 0; h < 7; h++) {
      const hole = document.createElement('div');
      hole.className = 'tp-2dhole';
      if (h === GOAL_INDEX) hole.classList.add('goal');
      if (h === s.positions[i] - 1) hole.classList.add('pin');
      holes.appendChild(hole);
    }
    row.appendChild(lbl);
    row.appendChild(holes);
    view2d.appendChild(row);
  }

  function align() {
    const plates = stage.querySelectorAll('.tp-plate');
    const sr = stage.getBoundingClientRect();
    plates.forEach((p, i) => {
      const g = p.querySelector('.tp-hole.goal').getBoundingClientRect();
      if (labels[i]) labels[i].style.top = `${g.top + g.height / 2 - sr.top - 9}px`;
    });
  }

  requestAnimationFrame(align);
  return { align };
}
