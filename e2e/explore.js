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
      const hint = (await d.text('.map-wrap')) || '';
      const m = hint.match(/Suggested move: press\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
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
      const hint = (await d.text('.map-wrap')) || '';
      const m = hint.match(/Suggested move: press\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
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
    const hint = (await d.text('.map-wrap')) || '';
    const m = hint.match(/Suggested move: press\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
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

  // 6 · Save / Start over / load roundtrip.
  await scenario(browser, 'save-load', { width: 1280, height: 800 }, async (d, page) => {
    d.lock = LOCKS[0];
    d.game = new (d.game.constructor)(d.lock);
    await d.gotoFreshApp(BASE_URL);
    await d.setupLock({ name: { location: 'New Camp', description: 'roundtrip chest' } });
    if (!(await d.mapLock())) return;
    if (!(await d.solveLock({}))) return;

    await d.click('start-over');
    await page.waitForSelector('.lock-col');
    const list = (await d.text('.lock-col')) || '';
    if (!list.includes('roundtrip chest')) {
      d.issue('state', 'saved lock missing from the list after Start over');
      await d.shot('missing-saved-lock');
      return;
    }
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
