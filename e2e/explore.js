// Exploratory scenarios beyond the straight map-and-solve runs: phone viewport,
// reload-resume, keyboard driving, the full-plan modal, recovering from a wrong
// mapping, and the save/load roundtrip.
//
//   node e2e/explore.js
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChromium } from './browser.js';
import { Driver } from './harness.js';
import { LOCKS, EXPLORE_LOCKS } from './locks.js';

const PORT = 8124;
const BASE_URL = `http://localhost:${PORT}/`;
const ARTIFACTS = new URL('./artifacts/explore/', import.meta.url).pathname;

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('dev server did not come up');
}

const results = [];
async function scenario(browser, name, viewport, fn) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const lock = LOCKS[0];
  const driver = new Driver(page, lock, { artifactsDir: `${ARTIFACTS}${name}` });
  try {
    await fn(driver, page, context);
  } catch (err) {
    driver.issue('exception', `${err.message}\n${err.stack?.split('\n')[1] || ''}`);
    await driver.shot('exception');
  }
  results.push({ name, issues: driver.issues, observations: driver.observations || [] });
  await context.close();
}

const server = spawn('python3', ['scripts/serve.py', String(PORT)], { stdio: 'ignore' });
try {
  await waitForServer(BASE_URL);
  const browser = await launchChromium();

  // 1 · Full easy run on a phone-sized viewport, watching for layout breakage.
  await scenario(browser, 'phone', { width: 390, height: 844 }, async (d) => {
    d.lock = LOCKS[0];
    await d.gotoFreshApp(BASE_URL);
    await d.checkOverflow('phone lock step');
    await d.shot('lock-step');
    await d.setupLock({});
    await d.checkOverflow('phone setup');
    const mapped = await d.mapLock();
    await d.checkOverflow('phone mapping');
    if (mapped) {
      await d.solveLock({});
      await d.checkOverflow('phone solve');
    }
  });

  // 2 · Reload mid-mapping: the session must restore the same stage, positions,
  // and mapping progress.
  await scenario(browser, 'reload-resume', { width: 1280, height: 800 }, async (d, page) => {
    d.lock = LOCKS[1]; // medium
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({});
    await d.click('start-mapping');
    await page.waitForSelector('.map-wrap');
    // map two plates the truthful way, then reload
    for (let i = 0; i < 2; i++) {
      const hint = (await d.text('.map-instruction')) || '';
      const m = hint.match(/Slide\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) { d.issue('deadend', 'no suggestion while building reload fixture'); return; }
      const positions = await d.boardPositions();
      const r = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
      if (r.blocked) { d.issue('deadend', 'unexpected block while building reload fixture'); return; }
      await d.recordProbe(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R', r.deltas, positions);
    }
    const before = (await d.text('.map-wrap .ap-card')) || '';
    const beforeCount = before.match(/(\d+) of (\d+) mapped/)?.[0];
    await page.reload();
    await page.waitForSelector('.map-wrap');
    const after = (await d.text('.map-wrap .ap-card')) || '';
    const afterCount = after.match(/(\d+) of (\d+) mapped/)?.[0];
    if (beforeCount !== afterCount) {
      d.issue('state', `reload lost mapping progress: "${beforeCount}" before, "${afterCount}" after`);
    }
    await d.expectBoardMatchesGame('after reload');
    await d.shot('after-reload');
  });

  // 3 · Keyboard solve: Enter to advance, Backspace to go back, R to reset,
  // Z for the full-plan modal, Esc to close it.
  await scenario(browser, 'keyboard-solve', { width: 1280, height: 800 }, async (d, page) => {
    d.lock = LOCKS[0];
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({});
    if (!(await d.mapLock())) return;
    await d.click('goto-solve');
    await page.waitForSelector('.ap-nm');

    // Z opens the full-plan modal; Esc closes it.
    await page.keyboard.press('z');
    if (!(await page.$('#pm-overlay'))) d.issue('ui', 'Z did not open the full-plan modal');
    await d.shot('fullplan-modal');
    await page.keyboard.press('Escape');
    if (await page.$('#pm-overlay')) d.issue('ui', 'Esc did not close the full-plan modal');

    // Step the whole plan with Enter, mirroring each move in the game.
    for (let i = 0; i < 50 && !(await page.$('.success')); i++) {
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) { d.issue('ui', `keyboard solve: unreadable next move "${nm}"`); return; }
      const r = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
      if (r.blocked) { d.issue('solver', 'plan move blocked during keyboard solve'); return; }
      await page.keyboard.press('Enter');
    }
    if (!(await page.$('.success'))) { d.issue('ui', 'keyboard solve never reached Lock open'); return; }
    if (!d.game.isSolved()) d.issue('drift', `keyboard solve finished but lock is at [${d.game.positions}]`);

    // Backspace from the success screen should step back into the plan.
    await page.keyboard.press('Backspace');
    if (await page.$('.success')) {
      d.issue('ui', 'Backspace did not step back from the success screen');
    } else {
      // undo in the game too (press the inverse of the last move shown as current)
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (m) d.game.press(+m[1] - 1, m[2] === 'Left' ? 'R' : 'L'); // inverse
      await d.expectBoardMatchesGame('after Backspace undo');
    }

    // R resets pins to the start; the game does the same with a fresh pick.
    await page.keyboard.press('r');
    d.game.reset();
    await d.expectBoardMatchesGame('after R reset');
    await d.shot('after-r-reset');
  });

  // 4 · Wrong mapping → "No solution found" → fix the bad row → solve. This is
  // the recovery path the README promises ("head back to Map the lock").
  await scenario(browser, 'wrong-mapping-recovery', { width: 1280, height: 800 }, async (d, page) => {
    d.lock = LOCKS[0]; // easy: P2/P3 are coupled
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({});
    await d.click('start-mapping');
    await page.waitForSelector('.map-wrap');

    // Map truthfully, except: on P2 deliberately tag P3 wrong (opposite instead of with).
    for (let i = 0; i < 6; i++) {
      const head = (await d.text('.map-wrap .ap-card')) || '';
      if (head.includes('All plates mapped')) break;
      const hint = (await d.text('.map-instruction')) || '';
      const m = hint.match(/Slide\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) { d.issue('deadend', 'no suggestion in wrong-mapping scenario'); return; }
      const plate = +m[1] - 1;
      const dir = m[2] === 'Left' ? 'L' : 'R';
      const positions = await d.boardPositions();
      const r = d.game.press(plate, dir);
      if (r.blocked) { d.issue('deadend', 'unexpected block in wrong-mapping scenario'); return; }
      const deltas = r.deltas.slice();
      if (plate === 1) deltas[2] = -deltas[2]; // lie about P3's direction
      await d.recordProbe(plate, dir, deltas, positions);
    }

    // Follow the (wrong) plan; in the real lock the pins will stop matching the
    // board — that's the moment a player notices the mapping is bad.
    await d.click('goto-solve');
    await page.waitForSelector('.ap-side .ap-card');
    let diverged = false;
    for (let i = 0; i < 30; i++) {
      if (await page.$('.success')) break;
      const side = (await d.text('.ap-side')) || '';
      if (side.includes('No solution found')) { diverged = true; break; }
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) break;
      d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R'); // blocked or not, the lock does what it does
      await d.click('did-it');
      const board = await d.boardPositions();
      if (board && board.join(',') !== d.game.positions.join(',')) { diverged = true; break; }
    }
    if (!diverged && d.game.isSolved()) {
      d.observe('wrong mapping happened to still solve the lock — recovery path untested in this run');
      return;
    }
    if (!diverged) {
      // The app believes the lock is open; the real pins disagree. The player's
      // only cue is the physical lock, and the success screen has no "it didn't
      // open" affordance — they must know to use the rail to return to mapping.
      d.observe('app showed "Lock open!" on a mis-mapped lock (unavoidable — the data was wrong), but the success screen offers no "lock didn\'t open" path back to mapping; the player must find the rail link themselves');
    }
    await d.shot('diverged');

    // Recover the way the README prescribes: back to mapping, fix the bad row,
    // then correct the pin positions to match the real lock, and re-solve.
    const backBtn = await page.$('[data-action="back-to-map"]');
    if (backBtn) await backBtn.click();
    else await page.click('[data-action="goto-stage"][data-stage="discovery"]');
    await page.waitForSelector('.map-wrap');
    await d.selectPlate(1);
    // Re-press P2 in the real lock and record it truthfully this time.
    const positions = await d.boardPositions();
    const dir = positions[1] > 4 ? 'R' : 'L';
    const r = d.game.press(1, dir);
    if (r.blocked) { d.issue('deadend', 'unexpected block while re-recording P2'); return; }
    if (!(await d.recordProbe(1, dir, r.deltas, positions))) return;

    // The board may still disagree with the real lock (the lie corrupted the
    // tracked positions) — fix it via Solve's "Edit positions".
    await d.click('goto-solve');
    await page.waitForSelector('.ap-side .ap-card');
    let board = await d.boardPositions();
    if (board.join(',') !== d.game.positions.join(',')) {
      await d.click('edit-positions');
      for (let i = 0; i < d.lock.n; i++) await d.dragSlideTo(i, d.game.positions[i]);
      await d.click('apply-edit');
      await d.expectBoardMatchesGame('after Edit positions correction');

      // The reset point must survive the edit: on a pick break the physical lock
      // snaps to its ORIGINAL positions, so R must take the board there too.
      await page.keyboard.press('r');
      d.game.reset();
      await d.expectBoardMatchesGame('after R following Edit positions');
    }

    // From here the plan must be real: follow it and the lock must open.
    for (let i = 0; i < 40 && !(await page.$('.success')); i++) {
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) { d.issue('ui', 'no readable next move during recovery solve'); return; }
      const r2 = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
      if (r2.blocked) { d.issue('solver', 'plan move blocked during recovery solve'); return; }
      await d.click('did-it');
    }
    if (!d.game.isSolved()) d.issue('ui', `recovery solve ended with the lock at [${d.game.positions}]`);
    await d.shot('recovered');
  });

  // 5 · Regression: pressing R mid-mapping (pick broke) must re-base the
  // in-progress recording, exactly like the Reset button does.
  await scenario(browser, 'mapping-r-reset', { width: 1280, height: 800 }, async (d, page) => {
    d.lock = LOCKS[0]; // easy, initial [3,6,2]
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({});
    await d.click('start-mapping');
    await page.waitForSelector('.map-wrap');

    // Map one plate so positions move off the reset point.
    const hint = (await d.text('.map-instruction')) || '';
    const m = hint.match(/Slide\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
    if (!m) { d.issue('deadend', 'no suggestion in R-reset scenario'); return; }
    const plate = +m[1] - 1;
    const dir = m[2] === 'Left' ? 'L' : 'R';
    const positions = await d.boardPositions();
    const r = d.game.press(plate, dir);
    if (r.blocked) { d.issue('deadend', 'unexpected block in R-reset scenario'); return; }
    await d.recordProbe(plate, dir, r.deltas, positions);

    // Pick "breaks": press R; the game snaps back; the board must match.
    await page.keyboard.press('r');
    d.game.reset();
    await d.expectBoardMatchesGame('after R during mapping');
    await d.shot('after-mapping-r');
  });

  // 6 · Import a fully-mapped real lock by share code, then solve its 68-move
  // plan with the run-grouped "Did all N" buttons — far fewer advances than
  // one click per press, with the board verified against the lock throughout.
  await scenario(browser, 'import-run-groups', { width: 1280, height: 800 }, async (d, page) => {
    const gomez = EXPLORE_LOCKS.find((l) => l.id === 'gomez');
    d.lock = gomez;
    d.game = new (d.game.constructor)(gomez);
    await d.gotoFreshApp(BASE_URL);

    const payload = {
      format: 'g1r-locks',
      version: 1,
      exportedAt: '2026-06-09T00:00:00.000Z',
      locks: [{
        id: 'lock-gomez-e2e',
        name: 'Old Camp Castle · Chest · Gomez e2e',
        location: 'Old Camp Castle',
        kind: 'Chest',
        description: 'Gomez e2e',
        n: gomez.n,
        initial: gomez.initial,
        coupling: gomez.coupling,
        status: Array(gomez.n).fill('done'),
        contents: [],
        notes: '',
        updatedAt: 1781038069717,
      }],
    };
    const code = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    // Paste-to-import: pasting the code on the Lock page must land directly on
    // the import results screen (no clicking through Import).
    const pasted = await page.evaluate((c) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', c);
      return document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, code).then(() => page.waitForSelector('.import-col', { timeout: 2000 }).then(() => true).catch(() => false));
    if (pasted) {
      const resTxt = (await d.text('.import-col')) || '';
      if (!/1 new imported|already present/.test(resTxt)) {
        d.issue('ui', `paste-to-import did not reach the results screen: "${resTxt.slice(0, 60)}"`);
      }
    } else {
      d.issue('ui', 'pasting a share code on the Lock page did not open import results');
      // fall back to the manual flow so the rest of the scenario still runs
      await d.click('import-open');
      await page.fill('[data-action="import-text"]', code);
      await d.click('import-parse');
    }
    await d.click('import-done');
    await page.click('[data-action="load-lock"][data-id="lock-gomez-e2e"]');
    await page.waitForSelector('.ap-nm');
    await d.shot('run-group-card');

    let advances = 0;
    for (let guard = 0; guard < 40 && !(await page.$('.success')); guard++) {
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)(?:\s*×(\d+))?/);
      if (!m) { d.issue('ui', `unreadable next move "${nm}"`); return; }
      const count = m[3] ? +m[3] : 1;
      for (let k = 0; k < count; k++) {
        const r = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
        if (r.blocked) { d.issue('solver', 'a move inside a suggested run blocked the lock'); return; }
      }
      await page.click(count > 1 ? '[data-action="did-run"]' : '[data-action="did-it"]');
      advances++;
      await d.expectBoardMatchesGame(`after grouped advance ${advances}`);
    }
    if (!(await page.$('.success'))) { d.issue('ui', 'run-grouped solve never reached Lock open'); return; }
    if (!d.game.isSolved()) { d.issue('drift', `app shows open but the lock is at [${d.game.positions}]`); return; }
    d.observe(`68-press plan executed in ${advances} grouped advances`);
    await d.shot('run-groups-done');
  });

  // 7 · Reviewing a mapped plate must not simulate its move: the board stays at
  // the committed positions until the player edits, and even then an illegal
  // preview pins slides at the edge (styled as a jam) instead of drawing them
  // off the grid. Reproduces a user report on the Gomez lock: reviewing P3 from
  // the start positions previewed P5→8 and P4/P2→0, drawing broken trays.
  await scenario(browser, 'review-mapped', { width: 1280, height: 900 }, async (d, page) => {
    const gomez = EXPLORE_LOCKS.find((l) => l.id === 'gomez');
    d.lock = gomez;
    d.game = new (d.game.constructor)(gomez);
    const session = {
      stage: 'discovery', n: gomez.n, positions: gomez.initial.slice(), initial: gomez.initial.slice(),
      mapping: { n: gomez.n, coupling: gomez.coupling, status: Array(gomez.n).fill('done') },
      location: '', kind: 'Chest', description: '', contents: [], lockLoaded: true,
    };
    await page.addInitScript((s) => localStorage.setItem('g1r.session', JSON.stringify(s)), session);
    await page.goto(BASE_URL);
    await page.waitForSelector('.map-wrap');

    await d.selectPlate(2); // review P3 — its links push P5 past 7 and P2/P4 past 1 from here
    const labels = await page.$$eval('.tp-2dlabel', (els) => els.map((e) => e.textContent));
    if (labels.some((t) => t.includes('→'))) {
      d.issue('ui', `reviewing a mapped plate previews its move: labels ${JSON.stringify(labels)}`);
    }
    await d.expectBoardMatchesGame('while reviewing a mapped plate');
    if (await page.$('.tp-tray.jam')) d.issue('ui', 'jam-styled tray shown before any edit during review');
    await d.shot('review-passive');

    // Start editing: re-tag P1 — the preview turns on and must clamp, not break.
    await d.click('set-rel', '[data-plate="0"][data-rel="with"]');
    const geom = await page.evaluate(() => {
      // The tray bezel intentionally bleeds 5px past its holes (margin: 1px -5px),
      // so allow that much; anything more means a slide drawn off the grid.
      const BLEED = 7;
      const out = { jams: document.querySelectorAll('.tp-tray.jam').length, outside: 0 };
      for (const row of document.querySelectorAll('.tp-2drow')) {
        const f = row.querySelector('.tp-field').getBoundingClientRect();
        const t = row.querySelector('.tp-tray:not(.ghost)').getBoundingClientRect();
        if (t.left < f.left - BLEED || t.right > f.right + BLEED) out.outside++;
      }
      return out;
    });
    if (geom.outside) d.issue('layout', `${geom.outside} tray(s) drawn outside the field during an illegal preview`);
    if (!geom.jams) d.issue('ui', 'illegal preview shows no jam-styled tray — the would-be jam is invisible');
    await d.checkOverflow('illegal preview during review');
    await d.shot('review-editing-jam-preview');

    // The edit was an accident: Cancel must discard it and restore the passive
    // review — committed board, saved links, no jam styling.
    const cancel = await page.$('[data-action="cancel-rerecord"]');
    if (!cancel) { d.issue('ui', 'no Cancel control while re-recording a mapped plate'); return; }
    await cancel.click();
    await d.expectBoardMatchesGame('after cancelling a re-record');
    const after = await page.$$eval('.tp-2dlabel', (els) => els.map((e) => e.textContent));
    if (after.some((t) => t.includes('→'))) d.issue('ui', 'Cancel left a previewed move on the board');
    if (await page.$('.tp-tray.jam')) d.issue('ui', 'Cancel left jam styling on the board');
    const tagRestored = await page.$('[data-action="set-rel"][data-plate="0"][data-rel="opposite"].on-opp');
    if (!tagRestored) d.issue('ui', 'Cancel did not restore the saved tag (P1 should be back to opposite)');
    await d.shot('review-cancelled');

    // The quiet escape hatch: forget ONE slide's mapping from its review state.
    // P3's row goes back to unstarted; every other row and the positions stay.
    const del = await page.$('[data-action="delete-plate"]');
    if (!del) { d.issue('ui', 'no forget-this-slide control while reviewing a mapped plate'); return; }
    page.once('dialog', (dlg) => dlg.accept());
    await del.click();
    const headTxt = (await d.text('.map-wrap .ap-card')) || '';
    if (!headTxt.includes(`4 of ${gomez.n} mapped`)) {
      d.issue('ui', `forgetting one slide should leave the others: "${headTxt.slice(0, 60)}"`);
    }
    const doneNow = await d.donePlates();
    if (doneNow.has(2)) d.issue('ui', "P3 still shows as mapped after forgetting its row");
    if (doneNow.size !== 4) d.issue('ui', `expected the other 4 rows to survive, got ${doneNow.size}`);
    await d.expectBoardMatchesGame('after forgetting one slide (positions must be untouched)');
    await d.shot('plate-forgotten');
  });

  // 8 · Oops keeps pick durability in sync: a stray in-game jam costs a
  // mistake; the second breaks the pick and the board auto-resets — in both
  // mapping and solve.
  await scenario(browser, 'oops-pick-sync', { width: 1280, height: 900 }, async (d, page) => {
    d.lock = LOCKS[0]; // easy
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({});
    await d.click('start-mapping');
    await page.waitForSelector('.map-wrap');

    // Move off the reset point so an auto-reset is observable.
    const hint = (await d.text('.map-instruction')) || '';
    const m = hint.match(/Slide\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
    if (!m) { d.issue('deadend', 'no suggestion in oops scenario'); return; }
    const r = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
    if (r.blocked) { d.issue('deadend', 'unexpected block in oops scenario'); return; }
    await d.prepareProbe(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R', d.lock.initial);
    if (!(await d.tagAndSave(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R', r.deltas))) return;

    // First stray jam: counted, nothing moves.
    await d.click('oops');
    const after1 = (await d.text('.map-wrap')) || '';
    if (!after1.includes('pick: ⚠ 1 mistake')) d.issue('ui', 'first Oops did not surface the pick damage');
    await d.expectBoardMatchesGame('after first Oops (nothing moved)');

    // Second stray jam: pick breaks, slides snap back, board must follow.
    await d.click('oops');
    d.game.reset(); // the physical lock snapped back
    await d.expectBoardMatchesGame('after second Oops (auto-reset)');
    const after2 = (await d.text('.map-wrap')) || '';
    if (!after2.includes('picks broken: 1')) d.issue('ui', 'pick break via Oops not counted');
    await d.shot('oops-break-reset');

    // Same in Solve: finish mapping, then two strays restart the plan from the top.
    if (!(await d.mapLock({ enter: false }))) return;
    await d.click('goto-solve');
    await page.waitForSelector('.ap-nm');
    await d.click('oops');
    const solveTxt = (await d.text('.ap-nm-label')) || '';
    if (!solveTxt.includes('pick: ⚠ 1 mistake')) d.issue('ui', 'solve card does not show pick damage after Oops');
    await d.click('oops');
    d.game.reset();
    await d.expectBoardMatchesGame('after Oops break during solve');
    if (!(await page.$('.ap-nm'))) d.issue('ui', 'no plan after an Oops break in solve (should replan from the start)');
    // Finish the lock from the reset point so the scenario proves play continues.
    if (!(await d.solveLock({ enter: false }))) d.issue('ui', 'could not finish the solve after an Oops break');
  });

  // 9 · Drift diagnosis: a solution that fails in-game (one recorded row lies).
  // The player follows the plan until the lock visibly disagrees, enters the
  // REAL positions via Edit positions, and the app must name the lying row.
  await scenario(browser, 'drift-diagnosis', { width: 1280, height: 900 }, async (d, page) => {
    // Real lock: P1 moves only itself. Recorded mapping lies: claims P1 drags
    // P3 with it. P2/P3 rows are recorded truthfully.
    const real = { id: 'driftcase', n: 3, coupling: [[1, 0, 0], [0, 1, 1], [0, -1, 1]], initial: [2, 4, 4] };
    const recorded = [[1, 0, 1], [0, 1, 1], [0, -1, 1]];
    d.lock = real;
    d.game = new (d.game.constructor)(real);
    const session = {
      stage: 'solve', n: real.n, positions: real.initial.slice(), initial: real.initial.slice(),
      mapping: { n: real.n, coupling: recorded, status: Array(real.n).fill('done') },
      location: '', kind: 'Chest', description: '', contents: [], lockLoaded: true,
    };
    await page.addInitScript((s) => localStorage.setItem('g1r.session', JSON.stringify(s)), session);
    await page.goto(BASE_URL);
    await page.waitForSelector('.ap-nm');

    // Follow the plan in the real lock until the board stops matching it.
    let diverged = false;
    for (let i = 0; i < 30 && !(await page.$('.success')); i++) {
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) break;
      d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R'); // blocked or not — the lock does what it does
      await d.click('did-it');
      const board = await d.boardPositions();
      if (board && board.join(',') !== d.game.positions.join(',')) { diverged = true; break; }
    }
    if (!diverged) { d.issue('deadend', 'drift scenario never diverged — fixture no longer lies?'); return; }

    // Tell the app where the lock REALLY is.
    await d.click('edit-positions');
    for (let i = 0; i < real.n; i++) await d.dragSlideTo(i, d.game.positions[i]);
    await d.click('apply-edit');

    // The diagnosis must finger P1 (the lying row) with a one-tap review.
    const reviewP1 = await page.$('[data-action="drift-review"][data-plate="0"]');
    if (!reviewP1) {
      const side = (await d.text('.ap-side')) || '';
      d.issue('ui', `drift diagnosis did not name P1: "${side.slice(0, 120)}"`);
      await d.shot('drift-not-diagnosed');
      return;
    }
    await d.shot('drift-diagnosed');
    await reviewP1.click();
    const instr = (await d.text('.map-instruction')) || '';
    if (!instr.includes('Reviewing P1')) d.issue('ui', `Review P1 did not land on P1's review: "${instr.slice(0, 80)}"`);
  });

  // 10 · A planned solve move that JAMS (nothing moves, so there's nothing to
  // edit): "It jammed" on the solve card must mark that row as provably wrong
  // and drop into the mapping jam flow; Reset re-syncs, re-recording fixes the
  // row, and the lock then opens for real.
  await scenario(browser, 'solve-jam', { width: 1280, height: 900 }, async (d, page) => {
    // Real lock: sliding P1 drags P3 with it. Recorded mapping: P1 moves only
    // itself. The plan opens P1R ×3; the real lock jams on the third press
    // (P3 has been dragged to pin 1 by then — unbeknownst to the board).
    const real = { id: 'solvejam', n: 3, coupling: [[1, 0, 1], [0, 1, 0], [0, 0, 1]], initial: [7, 4, 3] };
    const recorded = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    d.lock = real;
    d.game = new (d.game.constructor)(real);
    const session = {
      stage: 'solve', n: real.n, positions: real.initial.slice(), initial: real.initial.slice(),
      mapping: { n: real.n, coupling: recorded, status: Array(real.n).fill('done') },
      location: '', kind: 'Chest', description: '', contents: [], lockLoaded: true,
    };
    await page.addInitScript((s) => localStorage.setItem('g1r.session', JSON.stringify(s)), session);
    await page.goto(BASE_URL);
    await page.waitForSelector('.ap-nm');

    // Follow the plan; the board may silently drift (the hidden link) — the
    // observable failure is the jam.
    let jammed = false;
    for (let i = 0; i < 10 && !(await page.$('.success')); i++) {
      const nm = await d.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) break;
      const r = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
      if (r.blocked) {
        await d.click('solve-jammed');
        jammed = true;
        break;
      }
      await d.click('did-it');
    }
    if (!jammed) { d.issue('deadend', 'solve-jam fixture never jammed'); return; }

    // Landed in the mapping jam flow with the row marked for re-recording.
    await page.waitForSelector('.map-wrap');
    const head = (await d.text('.map-wrap .ap-card')) || '';
    if (!head.includes('2 of 3 mapped')) d.issue('ui', `jammed row not marked for re-recording: "${head.slice(0, 60)}"`);
    const lh = (await d.text('.ledger-head')) || '';
    if (!lh.includes('wiggled?')) d.issue('ui', 'solve jam did not open the wiggle capture');
    // The player saw P3 twitch: record the link (sign unknown — positions drifted).
    await d.click('jam-wiggle', '[data-plate="2"]');
    if (!(await page.$('[data-action="jam-wiggle"][data-plate="2"].on-wig'))) {
      d.issue('ui', 'wiggle tap did not register from the solve-jam flow');
    }
    await d.shot('solve-jam-capture');
    await d.click('jam-done');

    // Recover: snap lock and board to the start, re-record the bad row, solve.
    await d.click('reset-pins');
    d.game.reset();
    await d.expectBoardMatchesGame('after reset following a solve jam');
    if (!(await d.mapLock({ enter: false }))) return;
    if (!(await d.solveLock({}))) {
      d.issue('ui', 'could not open the lock after re-recording the jammed row');
      return;
    }
    await d.shot('solve-jam-recovered');
  });

  // 11 · "Lock doesn't match?": repositioning through a lying mapped row drifts
  // the board over several steps; the rewind walks backwards (one physical undo
  // per step) until lock and board agree — the first agreeing state names the
  // step that lied, re-syncs by construction, and re-opens that row.
  await scenario(browser, 'walkback', { width: 1280, height: 900 }, async (d, page) => {
    // Real lock: sliding P1 drags P3 with it. Recorded: P1 moves only itself.
    const real = { id: 'walkback', n: 3, coupling: [[1, 0, 1], [0, 1, 0], [0, 0, 1]], initial: [3, 4, 3] };
    d.lock = real;
    d.game = new (d.game.constructor)(real);
    const session = {
      stage: 'discovery', n: real.n, positions: real.initial.slice(), initial: real.initial.slice(),
      mapping: { n: real.n, coupling: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], status: ['done', 'unstarted', 'done'] },
      location: '', kind: 'Chest', description: '', contents: [], lockLoaded: false,
    };
    await page.addInitScript((s) => localStorage.setItem('g1r.session', JSON.stringify(s)), session);
    await page.goto(BASE_URL);
    await page.waitForSelector('.map-wrap');

    // Reposition with mapped arrows, mirroring the real lock. The middle move
    // uses the lying row — the board silently drifts from there on.
    for (const [p, dir] of [[2, 'L'], [0, 'L'], [2, 'L']]) {
      const r = d.game.press(p, dir);
      if (r.blocked) { d.issue('deadend', 'walkback fixture jammed unexpectedly'); return; }
      await d.click('apply-move', `[data-plate="${p}"][data-dir="${dir}"]`);
    }

    await d.click('walkback-start');
    let found = false;
    for (let i = 0; i < 5; i++) {
      const txt = (await d.text('.map-wrap .ap-card')) || '';
      const m = txt.match(/slide\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) { d.issue('ui', `no undo instruction while rewinding: "${txt.slice(0, 80)}"`); return; }
      d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R'); // physical undo — always legal
      const board = await d.boardPositions();
      if (board && board.join(',') === d.game.positions.join(',')) {
        await d.click('walkback-match');
        found = true;
        break;
      }
      await d.click('walkback-more');
    }
    if (!found) { d.issue('ui', 'rewind never reached an agreeing state'); return; }

    await d.expectBoardMatchesGame('after walkback resolution');
    const note = (await d.text('.map-wrap')) || '';
    if (!note.includes('began with a P1')) d.issue('ui', 'walkback did not name P1 as the culprit');
    await d.shot('walkback-found');

    // Finish: re-record the re-opened P1 (and P2) truthfully, then open the lock.
    if (!(await d.mapLock({ enter: false }))) return;
    if (!(await d.solveLock({}))) d.issue('ui', 'could not open the lock after the walkback fix');
  });

  // 12 · Save / Start over / load roundtrip.
  await scenario(browser, 'save-load', { width: 1280, height: 800 }, async (d, page) => {
    d.lock = LOCKS[0];
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({ name: { location: 'New Camp', description: 'roundtrip chest' } });
    if (!(await d.mapLock())) return;
    if (!(await d.solveLock({}))) return;

    // The success screen carries the share code; it must decode back to this
    // very lock (the harness mapped it truthfully, so coupling == ground truth).
    const code = await page.$eval('.share-code[data-live-share]', (el) => el.value).catch(() => null);
    if (!code) {
      d.issue('ui', 'no share code on the Lock open! screen');
    } else {
      try {
        const env = JSON.parse(Buffer.from(code, 'base64').toString('utf8'));
        const shared = env.locks?.[0];
        if (env.format !== 'g1r-locks' || !shared) d.issue('ui', 'success-screen share code has the wrong envelope');
        else if (JSON.stringify(shared.coupling) !== JSON.stringify(d.lock.coupling)) {
          d.issue('ui', 'success-screen share code does not carry the mapped coupling');
        }
      } catch {
        d.issue('ui', 'success-screen share code is not decodable');
      }
    }
    if (!(await page.$('.share-panel [data-action="copy-share"]'))) {
      d.issue('ui', 'no Copy button next to the success-screen share code');
    }

    await d.click('start-over');
    await page.waitForSelector('.lock-col');
    const list = (await d.text('.lock-col')) || '';
    if (!list.includes('roundtrip chest')) {
      d.issue('state', 'saved lock missing from the list after Start over');
      await d.shot('missing-saved-lock');
      return;
    }
    const readStamp = () =>
      page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('g1r.locks')).find((l) => l.description === 'roundtrip chest')?.updatedAt ?? null;
        } catch {
          return null;
        }
      });
    const stampBefore = await readStamp();
    await d.click('load-lock', `[data-id]`);
    await page.waitForSelector('.ap-side .ap-card, .map-wrap');
    const side = (await d.text('.ap-side')) || '';
    if (!(await page.$('.ap-nm')) && !side.includes('Lock open')) {
      d.issue('state', 'loading a fully-mapped lock did not land on a usable Solve view');
    }
    // It reloads at the lock's reset point; solve it again from there.
    d.game.reset();
    const nm = await d.text('.ap-nm');
    if (nm) {
      for (let i = 0; i < 50 && !(await page.$('.success')); i++) {
        const cur = await d.text('.ap-nm');
        const m = cur && cur.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
        if (!m) break;
        const r = d.game.press(+m[1] - 1, m[2] === 'Left' ? 'L' : 'R');
        if (r.blocked) { d.issue('solver', 'plan move blocked after load'); return; }
        await d.click('did-it');
      }
      if (!d.game.isSolved()) d.issue('state', `re-solve after load ended at [${d.game.positions}]`);
    }
    // Viewing and re-solving change nothing in the record — its timestamp (and
    // place in Recent) must not move.
    const stampAfter = await readStamp();
    if (stampAfter !== stampBefore) {
      d.issue('state', `viewing/solving the lock bumped updatedAt (${stampBefore} → ${stampAfter})`);
    }
    await d.shot('after-load');
  });

  await browser.close();
} finally {
  server.kill();
}

let failed = false;
for (const r of results) {
  console.log(`\n=== explore/${r.name} ===`);
  if (!r.issues.length) console.log('  no issues recorded');
  for (const i of r.issues) { failed = true; console.log(`  [${i.kind}] ${i.detail}`); }
  for (const o of r.observations) console.log(`  (friction) ${o.detail}`);
}
process.exit(failed ? 1 : 0);
