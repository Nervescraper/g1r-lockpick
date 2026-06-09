// Drives the site through a full map-and-solve of a simulated lock, the way a
// player would: it only reads what's on screen and only acts through clicks,
// keys, and drags. Everything it learns about the lock comes from SimulatedLock
// presses — including blocked presses (mistakes) and pick breaks, which snap
// the slides back to their starting positions.
//
// Along the way it records issues: site/game state drift, console errors,
// layout overflow, dead ends, and solver claims the game contradicts.
import { mkdirSync } from 'node:fs';
import { SimulatedLock } from './game.js';

const DIR_CODE = { Left: 'L', Right: 'R' };
const MIN = 1, MAX = 7;
const towardCenter = (pos) => (pos > 4 ? 'R' : 'L');

// Deterministic PRNG so "did the player notice that wiggle?" varies across jams
// but is identical run to run for a given lock.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Driver {
  constructor(page, lock, { artifactsDir, shotPrefix = '' } = {}) {
    this.page = page;
    this.lock = lock;
    this.game = new SimulatedLock(lock);
    this.issues = [];
    this.artifactsDir = artifactsDir;
    this.shotPrefix = shotPrefix;
    this.shotCount = 0;
    this.known = {}; // plate -> coupling row the player has recorded (their own notes)
    // Wiggles are easy to miss in the game; this player notices each one with
    // ~60% probability (seeded by lock id) so the incomplete-info path is
    // exercised: untapped chips must never corrupt the mapping.
    let seed = 0;
    for (const c of lock.id) seed = (seed * 31 + c.charCodeAt(0)) | 0;
    this.rng = mulberry32(seed || 1);
    this.wigglesSeen = 0;
    this.wigglesMissed = 0;
    if (artifactsDir) mkdirSync(artifactsDir, { recursive: true });

    page.on('console', (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return;
      // The GitHub star widget (buttons.github.io + api.github.com) is
      // third-party and rate-limits under repeated runs — not the app's doing.
      const src = msg.location()?.url || '';
      if (/github\.io|github\.com/.test(src)) return;
      this.issue('console', `${msg.type()}: ${msg.text()} (${src})`);
    });
    page.on('pageerror', (err) => this.issue('pageerror', String(err)));
    page.on('requestfailed', (req) => {
      // The GitHub buttons script is third-party and irrelevant to the app.
      if (!req.url().includes('buttons.github.io')) {
        this.issue('network', `request failed: ${req.url()} (${req.failure()?.errorText})`);
      }
    });
  }

  issue(kind, detail) {
    this.issues.push({ kind, detail, lock: this.lock.id });
  }

  // Softer channel: not a defect by itself, but something a real player would
  // feel — friction the harness had to navigate around.
  observe(detail) {
    (this.observations ??= []).push({ detail, lock: this.lock.id });
  }

  async shot(name) {
    if (!this.artifactsDir) return;
    const file = `${this.artifactsDir}/${this.shotPrefix}${String(++this.shotCount).padStart(2, '0')}-${name}.png`;
    await this.page.screenshot({ path: file, fullPage: true });
    return file;
  }

  async checkOverflow(where) {
    const overX = await this.page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    if (overX > 1) this.issue('layout', `horizontal overflow of ${overX}px at ${where}`);
  }

  // Board labels must stay on one line and inside their fixed-width box; a wrap
  // changes the row height and an overflow bleeds into the slide field.
  async checkLabels(where) {
    if (this.labelIssueReported) return;
    const bad = await this.page.$$eval('.tp-2dlabel', (els) =>
      els
        .map((el) => {
          const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
          if (el.offsetHeight > lh * 1.6) return `wrapped: "${el.textContent.trim()}"`;
          if (el.scrollWidth > el.clientWidth + 1) return `overflows its box: "${el.textContent.trim()}"`;
          return null;
        })
        .filter(Boolean)
    );
    if (bad.length) {
      this.labelIssueReported = true;
      this.issue('layout', `board label ${bad[0]} at ${where}`);
    }
  }

  // Committed pin positions as shown on the board, indexed by plate. A previewed
  // move renders "from → to"; the committed value is the "from" side.
  async boardPositions() {
    const rows = await this.page.$$eval('.tp-2dlabel', (els) =>
      els.map((e) => {
        const m = e.textContent.match(/P(\d+)\s*·\s*(\d+)(?:\s*→\s*(\d+))?/);
        return m ? { plate: +m[1], committed: +m[2] } : { raw: e.textContent };
      })
    );
    const out = [];
    for (const r of rows) {
      if (r.plate == null) {
        this.issue('ui', `unparseable board label: "${r.raw}"`);
        return null;
      }
      out[r.plate - 1] = r.committed;
    }
    return out;
  }

  // Which plates the board shows as mapped (green label).
  async donePlates() {
    const rows = await this.page.$$eval('.tp-2dlabel b', (els) =>
      els.map((b) => ({ plate: +b.textContent.replace(/\D/g, ''), done: b.classList.contains('done') }))
    );
    const done = new Set();
    for (const r of rows) if (r.done) done.add(r.plate - 1);
    return done;
  }

  async expectBoardMatchesGame(where) {
    const board = await this.boardPositions();
    if (!board) return;
    if (board.join(',') !== this.game.positions.join(',')) {
      this.issue('drift', `${where}: board shows [${board}] but the lock is at [${this.game.positions}]`);
    }
  }

  async text(selector) {
    const el = await this.page.$(selector);
    return el ? (await el.textContent()) ?? '' : null;
  }

  async click(action, extra = '') {
    await this.page.click(`[data-action="${action}"]${extra}`);
  }

  // Select plate `i` for recording by clicking its board label (the row is the
  // click target a player would use).
  async selectPlate(i) {
    const idx = this.lock.n - 1 - i; // rows render Pn (top) → P1 (bottom)
    await this.page.click(`.tp-2drow:nth-child(${idx + 1}) .tp-2dlabel`);
  }

  // Drag plate `i`'s solid slide so it lands on `targetPos`. Works in any
  // draggable board context (Setup, Solve-edit, or the mapping preview, where
  // the slide may be drawn at a previewed landing rather than the committed
  // position — geometry tells us where it actually is: startCol = 8 − pos).
  async dragSlideTo(plate, targetPos) {
    const idx = this.lock.n - 1 - plate;
    const row = await this.page.$(`.tp-2drow:nth-child(${idx + 1})`);
    const field = await row.$('.tp-field');
    const tray = await row.$('.tp-tray:not(.ghost)');
    const fieldBox = await field.boundingBox();
    const trayBox = await tray.boundingBox();
    const colW = fieldBox.width / 13;
    const startCol = Math.round((trayBox.x - fieldBox.x) / colW) + 1;
    const shownPos = 8 - startCol;
    const dxCols = shownPos - targetPos; // dragToPosition: next = startPos - dxCols
    if (dxCols === 0) return;
    const x = trayBox.x + trayBox.width / 2;
    const y = trayBox.y + trayBox.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dxCols * colW, y, { steps: 4 });
    await this.page.mouse.up();
  }

  // Set the recorded press direction by dragging the active slide one slot from
  // its baseline ('L' raises the position, 'R' lowers it).
  async dragActiveTo(plate, baseline, dirCode) {
    await this.dragSlideTo(plate, baseline + (dirCode === 'L' ? 1 : -1));
  }

  // ---------- stages ----------

  async gotoFreshApp(url) {
    await this.page.goto(url);
    await this.page.waitForSelector('#app .ap');
  }

  async setupLock({ name } = {}) {
    // Lock step → name (optional) → setup
    if (name?.location) await this.click('loc-fill', `[data-loc="${name.location}"]`);
    if (name?.description) await this.page.fill('[data-action="desc-input"]', name.description);
    await this.click('new-setup');
    await this.page.waitForSelector('[data-action="start-mapping"]');

    // Plate count via the +/− stepper
    for (let guard = 0; guard < 12; guard++) {
      const cur = parseInt(await this.text('.cnt .num'), 10);
      if (cur === this.lock.n) break;
      await this.click(cur < this.lock.n ? 'n-inc' : 'n-dec');
    }
    const finalN = parseInt(await this.text('.cnt .num'), 10);
    if (finalN !== this.lock.n) this.issue('ui', `could not set plate count to ${this.lock.n} (stuck at ${finalN})`);

    // Pin positions via the 1–7 keys (active plate auto-advances P1→Pn). On
    // narrow viewports the app disables keyboard shortcuts by design, so fall
    // back to dragging each slide — the path a phone player actually uses.
    for (const p of this.lock.initial) await this.page.keyboard.press(String(p));
    let board = await this.boardPositions();
    if (board && board.join(',') !== this.lock.initial.join(',')) {
      this.observe('1–7 keys did nothing here (narrow viewport disables shortcuts by design); setting pins by drag instead');
      for (let i = 0; i < this.lock.n; i++) await this.dragSlideTo(i, this.lock.initial[i]);
    }
    await this.expectBoardMatchesGame('after setup');
    await this.shot('setup');
    await this.checkOverflow('setup');
    await this.checkLabels('setup');
  }

  // Stage a probe in the UI before pressing in the lock: make sure the right
  // plate is being recorded and the press direction matches (a player decides,
  // then presses). Required so a jam can be reported against the right press.
  async prepareProbe(plate, dirCode, positionsBefore) {
    // The instruction line names the plate being recorded ("Press P3 … in the
    // lock" with suggestions on, "Recording P3 — …" without).
    const recordingTxt = (await this.text('.map-instruction')) || '';
    const recMatch = recordingTxt.match(/P(\d+)/);
    const active = recMatch ? +recMatch[1] - 1 : null;
    if (active !== plate) await this.selectPlate(plate);

    // The recording may have been seeded with either direction (the app honors
    // its suggestion's direction); drag to the intended landing regardless —
    // a no-op when the preview already sits there.
    await this.dragActiveTo(plate, positionsBefore[plate], dirCode);
  }

  // After a successful press: tag every other plate so the recording matches
  // what the lock did, and save. Tags may arrive pre-filled (links learned from
  // reported wiggles seed them), and the buttons TOGGLE — so read the current
  // state and only click where it differs from what was observed.
  async tagAndSave(plate, dirCode, deltas) {
    for (let j = 0; j < this.lock.n; j++) {
      if (j === plate) continue;
      const desired = deltas[j] === 0 ? null : deltas[j] === deltas[plate] ? 'with' : 'opposite';
      const current = await this.page.evaluate((jj) => {
        if (document.querySelector(`[data-action="set-rel"][data-plate="${jj}"][data-rel="with"].on-with`)) return 'with';
        if (document.querySelector(`[data-action="set-rel"][data-plate="${jj}"][data-rel="opposite"].on-opp`)) return 'opposite';
        return null;
      }, j);
      if (current === desired) continue;
      // Clicking the desired tag sets it (overwriting the other); with nothing
      // desired, clicking the lit one clears it.
      await this.click('set-rel', `[data-plate="${j}"][data-rel="${desired ?? current}"]`);
    }

    const saveBtn = await this.page.$('[data-action="save-next"]');
    const disabled = saveBtn && (await saveBtn.evaluate((el) => el.classList.contains('disabled')));
    if (!saveBtn || disabled) {
      this.issue('deadend', `Save plate is ${saveBtn ? 'disabled' : 'missing'} after truthfully recording P${plate + 1}`);
      await this.shot('save-blocked');
      return false;
    }
    await saveBtn.click();

    // Player notes: remember the row just recorded (deltas normalized to a Left press).
    const sign = dirCode === 'L' ? 1 : -1;
    this.known[plate] = deltas.map((d) => d * sign + 0);
    return true;
  }

  // Convenience for scenarios that already pressed the lock successfully.
  async recordProbe(plate, dirCode, deltas, positionsBefore) {
    await this.prepareProbe(plate, dirCode, positionsBefore);
    return this.tagAndSave(plate, dirCode, deltas);
  }

  // Apply a known (mapped) move via the "Move slides" panel, mirroring it in the game.
  async applyKnownMove(plate, dirCode) {
    const r = this.game.press(plate, dirCode);
    if (r.blocked) {
      this.issue('solver', `known move P${plate + 1} ${dirCode} blocked the lock — the app offered it as legal`);
      return false;
    }
    await this.click('apply-move', `[data-plate="${plate}"][data-dir="${dirCode}"]`);
    await this.expectBoardMatchesGame(`after Move slides P${plate + 1}${dirCode}`);
    return true;
  }

  // The player strategy, through the UI. Returns true when all plates are mapped.
  async mapLock({ maxRounds = 150 } = {}) {
    await this.click('start-mapping');
    await this.page.waitForSelector('.map-wrap');
    await this.shot('mapping-start');
    await this.checkOverflow('mapping');

    const blocked = new Set(); // `${positions}|${plate}${dir}` the player saw fail
    let brokeOnce = false;

    for (let round = 0; round < maxRounds; round++) {
      const head = (await this.text('.map-wrap .ap-card')) || '';
      if (head.includes('All plates mapped')) {
        await this.shot('mapping-done');
        return true;
      }

      const positions = await this.boardPositions();
      if (!positions) return false;
      await this.checkLabels(`mapping round ${round}`);
      const posKey = positions.join(',');
      const done = await this.donePlates();

      // Tier 2 guidance: an edge-clearing plan of known moves. Do it in the lock too.
      const planEl = await this.page.$('.plan-suggest');
      if (planEl) {
        const planText = await planEl.textContent();
        const moves = [...planText.matchAll(/P(\d+)\s*[◀▶]\s*(Left|Right)/g)];
        let bad = false;
        for (const m of moves) {
          const r = this.game.press(+m[1] - 1, DIR_CODE[m[2]]);
          if (r.blocked) {
            this.issue('solver', `edge-clear plan move P${m[1]} ${m[2]} blocked the lock — the app called it safe`);
            bad = true;
            break;
          }
        }
        if (bad) return false;
        await this.click('plan-done');
        await this.expectBoardMatchesGame('after edge-clear plan');
        continue;
      }

      // If the app recommends a different plate than the active one, follow it.
      const sel = await this.page.$('[data-action="select-plate"].ap-btn');
      if (sel) {
        await sel.click();
        continue;
      }

      // The app's suggested probe (the active recording's plate + direction).
      const hint = (await this.text('.map-instruction')) || '';
      const hm = hint.match(/Press\s*P(\d+)\s*[◀▶]\s*(Left|Right)/);
      let choice = null;
      if (hm && !blocked.has(`${posKey}|${+hm[1] - 1}${DIR_CODE[hm[2]]}`)) {
        choice = { plate: +hm[1] - 1, dir: DIR_CODE[hm[2]] };
      } else if (hm) {
        this.observe(
          `app still suggests "press P${hm[1]} ${hm[2]}" after that exact press just got blocked at [${posKey}] — no way to tell the app a probe failed, so the player must ignore the guidance and improvise`
        );
      }

      // Deviate: another unmapped plate/direction not yet seen to fail here.
      if (!choice) {
        const unmapped = [];
        for (let i = 0; i < this.lock.n; i++) if (!done.has(i)) unmapped.push(i);
        unmapped.sort((a, b) => {
          const ea = positions[a] <= MIN || positions[a] >= MAX ? 1 : 0;
          const eb = positions[b] <= MIN || positions[b] >= MAX ? 1 : 0;
          return ea - eb;
        });
        outer: for (const p of unmapped) {
          const toward = towardCenter(positions[p]);
          const away = toward === 'L' ? 'R' : 'L';
          for (const dir of [toward, away]) {
            if (dir === 'L' && positions[p] >= MAX) continue; // can't press into the wall
            if (dir === 'R' && positions[p] <= MIN) continue;
            if (!blocked.has(`${posKey}|${p}${dir}`)) { choice = { plate: p, dir }; break outer; }
          }
        }
      }

      // Everything probeable failed here: reposition with a mapped move that
      // frees up edges (predicted from the player's own recorded rows).
      if (!choice) {
        const options = await this.page.$$eval('[data-action="apply-move"]', (els) =>
          els.map((el) => ({ plate: +el.dataset.plate, dir: el.dataset.dir }))
        );
        let best = null;
        for (const opt of options) {
          const row = this.known[opt.plate];
          if (!row) continue;
          const s = opt.dir === 'L' ? 1 : -1;
          const np = positions.map((p, j) => p + s * row[j]);
          if (np.some((v) => v < MIN || v > MAX)) {
            this.issue('ui', `Move slides offers P${opt.plate + 1} ${opt.dir} which the mapped rows say is out of bounds`);
            continue;
          }
          const score = np.filter((v) => v <= MIN || v >= MAX).length;
          if (!best || score < best.score) best = { ...opt, score };
        }
        if (!best) {
          this.issue('deadend', `mapping round ${round}: nothing left to try — no probe, no plan, no reposition`);
          await this.shot('mapping-deadend');
          return false;
        }
        this.observe(
          `every probe at [${posKey}] is blocked; player repositions with Move slides (P${best.plate + 1} ${best.dir}) on their own — the app offered no plan here`
        );
        await this.shot('reposition');
        if (!(await this.applyKnownMove(best.plate, best.dir))) return false;
        continue;
      }

      // Stage the recording, then press the chosen plate in the lock.
      await this.prepareProbe(choice.plate, choice.dir, positions);
      const r = this.game.press(choice.plate, choice.dir);
      if (r.blocked) {
        blocked.add(`${posKey}|${choice.plate}${choice.dir}`);
        // Tell the app the press jammed, so its guidance moves on. The app counts
        // jams the way the game does: the 2nd one breaks the pick, and the app
        // must auto-reset the board to the start to match the snapped-back slides.
        const jamBtn = await this.page.$('[data-action="probe-jammed"]');
        if (jamBtn) await jamBtn.click();
        else this.issue('ui', 'press jammed but there is no control to tell the app');
        // The game wiggles the plates the press would have pushed out; report
        // the ones this player happened to notice through the optional chips
        // (every wiggler sits on an edge, so a chip must exist for each).
        for (const j of r.wiggle || []) {
          if (j === choice.plate) continue;
          if (this.rng() >= 0.6) { this.wigglesMissed++; continue; } // didn't catch it
          const chip = await this.page.$(`[data-action="jam-wiggle"][data-plate="${j}"]`);
          if (chip) { await chip.click(); this.wigglesSeen++; }
          else this.issue('ui', `the lock wiggled P${j + 1} on the jam but there is no chip to report it`);
        }
        if (r.broke && !brokeOnce) {
          await this.shot('after-first-break');
          brokeOnce = true;
        }
        await this.expectBoardMatchesGame(r.broke ? 'after the 2nd jam (auto-reset)' : 'after a reported jam');
        continue;
      }

      if (!(await this.tagAndSave(choice.plate, choice.dir, r.deltas))) return false;
      await this.expectBoardMatchesGame(`after saving P${choice.plate + 1}`);
    }
    this.issue('deadend', 'mapping did not finish within the round budget');
    return false;
  }

  async solveLock({ resetFirst = false, maxSteps = 100 } = {}) {
    await this.click('goto-solve');
    await this.page.waitForSelector('.ap-side .ap-card');
    if (resetFirst) {
      const btn = await this.page.$('[data-action="reset-pins"]');
      if (btn) {
        await btn.click();
        this.game.reset();
      }
    }
    await this.shot('solve-start');
    await this.checkOverflow('solve');

    for (let step = 0; step < maxSteps; step++) {
      if (await this.page.$('.success')) {
        await this.shot('solve-done');
        if (!this.game.isSolved()) {
          this.issue('solver', `app shows "Lock open!" but the lock is at [${this.game.positions}]`);
          return false;
        }
        return true;
      }
      const side = (await this.text('.ap-side')) || '';
      if (side.includes('No solution found')) {
        this.issue('solver', 'app reports no solution for a lock that is provably solvable');
        await this.shot('solve-nosolution');
        return false;
      }
      const nm = await this.text('.ap-nm');
      const m = nm && nm.match(/P(\d+)\s*[◀▶]\s*(Left|Right)/);
      if (!m) {
        this.issue('deadend', `solve step ${step}: no readable next move ("${nm}")`);
        return false;
      }
      const r = this.game.press(+m[1] - 1, DIR_CODE[m[2]]);
      if (r.blocked) {
        this.issue('solver', `plan move P${m[1]} ${m[2]} blocked the lock — the plan is supposed to be edge-free`);
        return false;
      }
      await this.click('did-it');
      await this.expectBoardMatchesGame(`solve after step ${step + 1}`);
    }
    this.issue('deadend', 'solve did not finish within the step budget');
    return false;
  }
}
