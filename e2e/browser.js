// Launch Playwright's bundled Chromium without a system Chrome install: load
// playwright-core from the npx cache and point it at the cached browser binary
// explicitly (which also sidesteps library/browser version-skew checks).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function firstGlob(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8' }).trim();
    return out.split('\n').filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

export async function launchChromium() {
  const home = os.homedir();
  const corePath = firstGlob(`find ${home}/.npm/_npx -maxdepth 3 -type d -name playwright-core 2>/dev/null`);
  if (!corePath) throw new Error('playwright-core not found in npx cache');
  const { default: pw } = await import(path.join(corePath, 'index.js'));

  const shell = firstGlob(
    `ls -d ${home}/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell 2>/dev/null`
  );
  const full = firstGlob(
    `ls -d "${home}/Library/Caches/ms-playwright/"chromium-*/chrome-mac-arm64/*.app/Contents/MacOS/* 2>/dev/null`
  );
  const executablePath = shell || full;
  if (!executablePath || !existsSync(executablePath)) throw new Error('no cached Chromium binary found');

  return pw.chromium.launch({ executablePath, headless: true });
}
