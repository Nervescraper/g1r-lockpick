// End-to-end check for the lock-photos feature: attach a photo on the success
// screen, confirm it survives a full page reload (IndexedDB-backed), open and
// dismiss the lightbox, and verify the share code stays photo-free.
//
//   node e2e/photos.js
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChromium } from './browser.js';
import { Driver } from './harness.js';
import { LOCKS } from './locks.js';

const PORT = 8124;
const BASE_URL = `http://localhost:${PORT}/`;
const ARTIFACTS = new URL('./artifacts/', import.meta.url).pathname;

// A minimal valid 1x1 PNG, decoded from base64 into an in-memory buffer.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_BUFFER = Buffer.from(PNG_B64, 'base64');

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

const lock = LOCKS.find((l) => l.id === 'easy');
const server = spawn('python3', ['scripts/serve.py', String(PORT)], { stdio: 'ignore' });

try {
  await waitForServer(BASE_URL);
  const browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const driver = new Driver(page, lock, { artifactsDir: `${ARTIFACTS}${lock.id}-photos` });

  // 1. Map and solve the easy lock to reach the "Lock open!" success screen.
  await driver.gotoFreshApp(BASE_URL);
  await driver.setupLock({ name: { location: 'Old Camp', description: 'e2e photos chest' } });
  const mapped = await driver.mapLock();
  check(mapped, 'easy lock did not map');
  const solved = mapped && (await driver.solveLock());
  check(solved, 'easy lock did not reach the success screen');

  await page.waitForSelector('.success', { timeout: 5000 });

  // The picker must be enabled (the lock is named, so state.lockId is set).
  const pickerEnabled = await page.$('.photos-editor:not(.disabled)');
  check(!!pickerEnabled, 'photo picker is disabled on the named success screen');

  // 2. Attach a photo via the hidden file input.
  await page.setInputFiles('input[data-action="photo-file"]', {
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: PNG_BUFFER,
  });

  // 3. Wait for the thumbnail to render.
  let thumbOk = true;
  try {
    await page.waitForSelector('img.photo-thumb', { timeout: 5000 });
  } catch {
    thumbOk = false;
  }
  check(thumbOk, 'no img.photo-thumb appeared after attaching a photo');
  await driver.shot('photo-attached');

  // 5. Open the lightbox from the editor thumbnail, then dismiss it with Escape.
  if (thumbOk) {
    await page.click('img.photo-thumb');
    let lightboxOk = true;
    try {
      await page.waitForSelector('.photo-lightbox img', { timeout: 5000 });
    } catch {
      lightboxOk = false;
    }
    check(lightboxOk, 'lightbox did not open when a thumbnail was clicked');
    await driver.shot('lightbox-open');

    await page.keyboard.press('Escape');
    let lightboxGone = true;
    try {
      await page.waitForSelector('.photo-lightbox', { state: 'detached', timeout: 5000 });
    } catch {
      lightboxGone = false;
    }
    check(lightboxGone, 'lightbox did not close on Escape');
  }

  // 6. The success-screen live share code must exclude the photo payload.
  const liveShare = await page.$eval(
    'textarea.share-code[data-live-share]',
    (ta) => ta.value
  ).catch(() => '');
  check(
    liveShare.length > 0 && liveShare.length < 2000,
    `live share code length ${liveShare.length} (expected >0 and <2000; photos would balloon it)`
  );

  // 4. Reload the whole app. The lock auto-saved to localStorage and the photo
  //    to IndexedDB; only the in-progress session is cleared, so the app starts
  //    fresh on the Lock step with the saved lock no longer the active one. Its
  //    list-row thumbnail (hydrated from IndexedDB) proves the photo persisted.
  await page.evaluate(() => localStorage.removeItem('g1r.session'));
  await driver.gotoFreshApp(BASE_URL);
  let rowThumbOk = true;
  try {
    await page.waitForSelector('img.lock-row-thumb', { timeout: 5000 });
    // The <img> renders without a src; hydrateListThumbs fills it async from IDB.
    await page.waitForSelector('img.lock-row-thumb[src]', { timeout: 5000 });
  } catch {
    rowThumbOk = false;
  }
  check(rowThumbOk, 'saved-lock list thumbnail did not persist across a reload');
  await driver.shot('reloaded-list');

  // Surface any console/page errors the Driver recorded along the way.
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
  console.log(`\nphotos e2e: ${failures.length} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('photos e2e: OK');
  process.exitCode = 0;
}
