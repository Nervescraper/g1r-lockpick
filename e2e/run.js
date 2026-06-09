// End-to-end runner: serve the site, then map and solve each fixture lock
// through the real UI. Prints every issue found and exits non-zero on failure.
//
//   node e2e/run.js [easy|medium|hard ...]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChromium } from './browser.js';
import { Driver } from './harness.js';
import { LOCKS, EXPLORE_LOCKS } from './locks.js';

const PORT = 8123;
const BASE_URL = `http://localhost:${PORT}/`;
const ARTIFACTS = new URL('./artifacts/', import.meta.url).pathname;

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('dev server did not come up');
}

async function runLock(browser, lock, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const driver = new Driver(page, lock, {
    artifactsDir: `${ARTIFACTS}${lock.id}${opts.suffix || ''}`,
  });
  let ok = false;
  try {
    await driver.gotoFreshApp(BASE_URL);
    await driver.setupLock({ name: opts.name });
    const mapped = await driver.mapLock();
    if (mapped) ok = await driver.solveLock({ resetFirst: !!opts.resetFirst });
  } catch (err) {
    driver.issue('exception', `${err.message}\n${err.stack?.split('\n')[1] || ''}`);
    await driver.shot('exception');
  }
  await context.close();
  return {
    ok,
    issues: driver.issues,
    observations: driver.observations || [],
    mistakes: driver.game.totalMistakes,
    breaks: driver.game.breaks,
    wiggles: `${driver.wigglesSeen} seen / ${driver.wigglesMissed} missed`,
  };
}

const ALL = [...LOCKS, ...EXPLORE_LOCKS];
const wanted = process.argv.slice(2);
const locks = wanted.length ? ALL.filter((l) => wanted.includes(l.id)) : ALL;

const server = spawn('python3', ['scripts/serve.py', String(PORT)], { stdio: 'ignore' });
let failed = false;
try {
  await waitForServer(BASE_URL);
  const browser = await launchChromium();

  for (const lock of locks) {
    const opts = {
      easy: {},
      medium: { name: { location: 'Old Camp', description: 'e2e medium chest' }, resetFirst: true },
      hard: { resetFirst: true },
    }[lock.id] || {};
    const res = await runLock(browser, lock, opts);
    if (!res.ok || res.issues.length) failed = true;
    console.log(`\n=== ${lock.id}: ${res.ok ? 'SOLVED through the UI' : 'DID NOT SOLVE'} (mistakes: ${res.mistakes}, breaks: ${res.breaks}, wiggles: ${res.wiggles}) ===`);
    for (const i of res.issues) console.log(`  [${i.kind}] ${i.detail}`);
    if (!res.issues.length) console.log('  no issues recorded');
    for (const o of res.observations) console.log(`  (friction) ${o.detail}`);
  }

  await browser.close();
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
