// End-to-end check for the add-item (contents editor) autocomplete: seed two saved
// locks, open the editor for the empty one, and confirm item names from across the
// saved locks are suggested as you type, pickable by mouse and keyboard, persisted,
// and that an item already added to the lock is not suggested again.
//
//   node e2e/add-item-autocomplete.js
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChromium } from './browser.js';
import { Driver } from './harness.js';
import { LOCKS } from './locks.js';

const PORT = 8126;
const BASE_URL = `http://localhost:${PORT}/`;
const ARTIFACTS = new URL('./artifacts/', import.meta.url).pathname;

// Two saved locks: A supplies the suggestion pool, B is the (empty) lock we edit.
const SEED_LOCKS = [
  {
    id: 'seed-a',
    name: 'Old Camp — Chest',
    n: 5,
    location: 'Old Camp',
    kind: 'Chest',
    description: '',
    updatedAt: 2000,
    photoCount: 0,
    contents: [
      { item: 'Gold ingot', qty: 2 },
      { item: 'Silver ore', qty: 1 },
    ],
  },
  {
    id: 'seed-b',
    name: 'Old Camp — Crate',
    n: 5,
    location: 'Old Camp',
    kind: 'Chest',
    description: '',
    updatedAt: 1000,
    photoCount: 0,
    contents: [],
  },
];

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

const failures = [];
function check(cond, msg) {
  if (cond) return true;
  failures.push(msg);
  console.log(`  [FAIL] ${msg}`);
  return false;
}

// The visible suggestion texts in a given row's dropdown.
async function optsFor(page, rowIndex) {
  return page.$$eval(`#ct-suggest-${rowIndex} .ls-opt`, (els) =>
    els.map((e) => e.textContent.trim())
  );
}

// Focus a row's item input and type a value character by character (real input events).
async function typeItem(page, rowIndex, text) {
  const sel = `.ct-item[data-i="${rowIndex}"]`;
  await page.click(sel);
  await page.fill(sel, '');
  await page.type(sel, text, { delay: 10 });
}

const lock = LOCKS.find((l) => l.id === 'easy');
const server = spawn('python3', ['scripts/serve.py', String(PORT)], { stdio: 'ignore' });

try {
  await waitForServer(BASE_URL);
  const browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const driver = new Driver(page, lock, { artifactsDir: `${ARTIFACTS}add-item-autocomplete` });

  // 1. Open the app (establishes the origin), seed saved locks, reload to the list.
  await driver.gotoFreshApp(BASE_URL);
  await page.evaluate((locks) => {
    localStorage.setItem('g1r.locks', JSON.stringify(locks));
    localStorage.removeItem('g1r.session');
  }, SEED_LOCKS);
  await driver.gotoFreshApp(BASE_URL);

  // 2. Open the editor for the empty lock B.
  await page.click('[data-action="edit-contents"][data-id="seed-b"]');
  await page.waitForSelector('.contents-editor', { timeout: 5000 });

  // 3. Add a row and type a prefix that matches an item from lock A.
  await page.click('[data-action="content-add"]');
  await page.waitForSelector('.ct-item[data-i="0"]', { timeout: 5000 });
  await typeItem(page, 0, 'gold');
  await page.waitForSelector('#ct-suggest-0 .ls-opt', { timeout: 5000 }).catch(() => {});
  const opts0 = await optsFor(page, 0);
  check(opts0.includes('Gold ingot'), `row 0 dropdown should suggest "Gold ingot", got ${JSON.stringify(opts0)}`);
  await driver.shot('suggest-shown');

  // 4. Pick it with the mouse (mousedown fires before blur closes the dropdown).
  await page.click('#ct-suggest-0 .ls-opt:has-text("Gold ingot")');
  const val0 = await page.$eval('.ct-item[data-i="0"]', (el) => el.value);
  check(val0 === 'Gold ingot', `row 0 should be filled with "Gold ingot", got "${val0}"`);

  // 5. It persisted to the saved lock's contents.
  const persisted = await page.evaluate(() => {
    const locks = JSON.parse(localStorage.getItem('g1r.locks') || '[]');
    const b = locks.find((l) => l.id === 'seed-b');
    return b && b.contents && b.contents[0] ? b.contents[0].item : null;
  });
  check(persisted === 'Gold ingot', `seed-b contents[0].item should persist as "Gold ingot", got ${JSON.stringify(persisted)}`);

  // 6. Keyboard path: add a second row, type, ArrowDown + Enter to accept.
  await page.click('[data-action="content-add"]');
  await page.waitForSelector('.ct-item[data-i="1"]', { timeout: 5000 });
  await typeItem(page, 1, 'silver');
  await page.waitForSelector('#ct-suggest-1 .ls-opt', { timeout: 5000 }).catch(() => {});
  const opts1 = await optsFor(page, 1);
  check(opts1.includes('Silver ore'), `row 1 dropdown should suggest "Silver ore", got ${JSON.stringify(opts1)}`);
  await page.focus('.ct-item[data-i="1"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const val1 = await page.$eval('.ct-item[data-i="1"]', (el) => el.value);
  check(val1 === 'Silver ore', `row 1 should be filled via keyboard with "Silver ore", got "${val1}"`);

  // 7. Exclusion: a third row typing a now-already-added name must not suggest it.
  await page.click('[data-action="content-add"]');
  await page.waitForSelector('.ct-item[data-i="2"]', { timeout: 5000 });
  await typeItem(page, 2, 'ingot');
  await sleep(150); // let the synchronous dropdown refresh settle
  const opts2 = await optsFor(page, 2);
  check(!opts2.includes('Gold ingot'), `row 2 must NOT suggest already-added "Gold ingot", got ${JSON.stringify(opts2)}`);

  // Surface any console/page errors the Driver recorded.
  for (const i of driver.issues) {
    failures.push(`driver issue [${i.kind}]: ${i.detail}`);
    console.log(`  [FAIL] driver issue [${i.kind}]: ${i.detail}`);
  }

  await context.close();
  await browser.close();
} catch (err) {
  failures.push(`exception: ${err.message}\n${err.stack}`);
  console.log(`  [FAIL] exception: ${err.message}\n${err.stack}`);
} finally {
  server.kill();
}

if (failures.length) {
  console.log(`\nadd-item-autocomplete e2e: ${failures.length} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('add-item-autocomplete e2e: OK');
  process.exitCode = 0;
}
