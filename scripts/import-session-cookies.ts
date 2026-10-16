/**
 * Import a ppomppu login session exported from a real browser.
 *
 * The bot cannot log itself back in once its session expires: the login form
 * sits behind Cloudflare Turnstile (KE-004). Log in by hand, export the
 * ppomppu.co.kr cookies (Cookie-Editor JSON or Playwright format), then run:
 *
 *   npm run session:import -- <export.json> [--state <path>] [--verify]
 *
 * --state   storage-state file to merge into (default: BOT_PROFILE_DIR/browser-storage-state.json)
 * --verify  open the board with the merged cookies and report the session state
 *
 * The previous state file is kept as <state>.bak-<timestamp>. Run it while the
 * publisher is idle: a run that ends after the import saves its own cookies.
 * For the Docker deployment see .agent/OPERATIONS.md ("Restoring the ppomppu session").
 */

import fs from 'node:fs';
import { chromium } from 'playwright';

import {
  STORAGE_STATE_PATH,
  sharedBrowserContextOptions,
  convertExportedCookies,
  mergeCookies,
} from '../lib/browser/index.js';
import { getBoardDiagnostics, loadObserverPolicy } from '../lib/observer/index.js';

function parseArgs(argv: string[]) {
  const args = { exportPath: '', statePath: STORAGE_STATE_PATH, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verify') args.verify = true;
    else if (arg === '--state') args.statePath = argv[++i] ?? '';
    else if (!args.exportPath) args.exportPath = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.exportPath || !args.statePath) {
    throw new Error('Usage: npm run session:import -- <export.json> [--state <path>] [--verify]');
  }
  return args;
}

function readBaseCookies(statePath: string) {
  if (!fs.existsSync(statePath)) return [];
  return convertExportedCookies(JSON.parse(fs.readFileSync(statePath, 'utf-8')));
}

async function verify(statePath: string): Promise<boolean> {
  const { cookies } = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const { boardUrl } = await loadObserverPolicy();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ...sharedBrowserContextOptions(),
      storageState: { cookies, origins: [] },
    });
    const page = await context.newPage();
    await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const diagnostics = await getBoardDiagnostics(page);
    console.log(`verify: session=${diagnostics.sessionState} writeButtons=${diagnostics.writeButtonCount} url=${diagnostics.url}`);
    return diagnostics.sessionState === 'logged_in';
  } finally {
    await browser.close();
  }
}

async function main() {
  const { exportPath, statePath, verify: shouldVerify } = parseArgs(process.argv.slice(2));

  const incoming = convertExportedCookies(JSON.parse(fs.readFileSync(exportPath, 'utf-8')));
  const base = readBaseCookies(statePath);
  const merged = mergeCookies(base, incoming);

  if (fs.existsSync(statePath)) {
    const backupPath = `${statePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(statePath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    console.log(`backup: ${backupPath}`);
  }
  fs.writeFileSync(statePath, JSON.stringify({ cookies: merged }, null, 2), { encoding: 'utf-8', mode: 0o600 });
  console.log(`wrote ${statePath}: base=${base.length} imported=${incoming.length} merged=${merged.length}`);

  if (shouldVerify && !(await verify(statePath))) {
    console.error('verify: not logged in with the merged cookies — re-export after a fresh login');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
