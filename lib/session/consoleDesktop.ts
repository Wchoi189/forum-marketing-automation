/**
 * lib/session/consoleDesktop.ts
 *
 * The browser a person uses in the login console: a plain headed Chromium on
 * its own Xvnc display, with no automation attached. No CDP, no Playwright, no
 * user-agent override, so the page sees an ordinary Linux Chromium
 * (`navigator.webdriver` false because nothing drives it, not because it is
 * hidden). Cloudflare Turnstile stalled on the old Playwright console, whose
 * headless browser claimed Windows Chrome 146 while reporting Linux.
 *
 * The person drives it over VNC (X-level pointer and keys, see vncBridge.ts).
 * A generated extension does the two things automation used to:
 *  - a content script fills the ID and password and ticks 자동로그인 on
 *    login.php, the way a password manager would;
 *  - tools/session-sync-extension's worker pushes the login cookies to
 *    POST /api/session/import, which probes and saves them fail-closed.
 *
 * Each desktop gets a private 0700 temp directory (profile, extension with the
 * credentials, VNC socket) that is removed on close.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ENV } from '../../config/env.js';

/** Phone-shaped, so the viewer is readable on the device most likely to open it. */
export const DESKTOP_SIZE = { width: 430, height: 932 };

const SYNC_EXTENSION_DIR = path.join(ENV.PROJECT_ROOT, 'tools', 'session-sync-extension');
const START_TIMEOUT_MS = 15_000;

export type DesktopOptions = {
  /** Page Chromium opens first. */
  url: string;
  /** Where the extension pushes cookies; the bot's own import endpoint. */
  importEndpoint: string;
  importSecret: string;
  /** `source` the import endpoint sees, so it can report back to the console. */
  importSource: string;
  userId: string;
  password: string;
};

function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, ms);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

/** Xvnc writes its display number to -displayfd once it accepts clients. */
function readDisplayNumber(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('Xvnc did not start')), START_TIMEOUT_MS);
    child.stdio[3]!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/^(\d+)\n/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Xvnc exited (${code})`)); });
  });
}

function writeExtension(dir: string, opts: DesktopOptions): void {
  fs.mkdirSync(dir, { mode: 0o700 });
  const manifest = JSON.parse(fs.readFileSync(path.join(SYNC_EXTENSION_DIR, 'manifest.json'), 'utf-8'));
  manifest.name = 'ppomppu login console';
  manifest.content_scripts = [{
    matches: ['https://www.ppomppu.co.kr/zboard/login.php*'],
    js: ['fill.js'],
    run_at: 'document_idle',
  }];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(SYNC_EXTENSION_DIR, 'background.js'), path.join(dir, 'background.js'));
  fs.writeFileSync(
    path.join(dir, 'config.local.json'),
    JSON.stringify({ endpoint: opts.importEndpoint, secret: opts.importSecret, source: opts.importSource }),
    { mode: 0o600 },
  );
  // Fill only. Submitting is the person's action, after they pass Turnstile.
  fs.writeFileSync(
    path.join(dir, 'fill.js'),
    `(() => {
  const fill = (selector, value) => {
    const field = document.querySelector(selector);
    if (!field || field.value) return;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  fill('input[name="user_id"]', ${JSON.stringify(opts.userId)});
  fill('input[name="password"]', ${JSON.stringify(opts.password)});
  const box = document.querySelector('input[name="auto_login"]');
  if (box && !box.checked) box.click();
})();
`,
    { mode: 0o600 },
  );
}

export class ConsoleDesktop {
  private dir: string | null = null;
  private xvnc: ChildProcess | null = null;
  private browser: ChildProcess | null = null;
  private exitListeners = new Set<(what: string) => void>();
  private closing = false;

  get socketPath(): string | null {
    return this.dir ? path.join(this.dir, 'vnc.sock') : null;
  }

  /** Called if Xvnc or Chromium dies on its own (e.g. the person closed the window). */
  onExit(listener: (what: string) => void): void {
    this.exitListeners.add(listener);
  }

  async start(opts: DesktopOptions): Promise<void> {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-console-'));
    fs.chmodSync(this.dir, 0o700);
    writeExtension(path.join(this.dir, 'extension'), opts);

    // TCP disabled; the only way in is the 0600 unix socket, bridged by
    // vncBridge.ts behind the console token.
    this.xvnc = spawn('Xvnc', [
      '-displayfd', '3',
      '-geometry', `${DESKTOP_SIZE.width}x${DESKTOP_SIZE.height}`,
      '-depth', '24',
      '-SecurityTypes', 'None',
      '-rfbport', '-1',
      '-rfbunixpath', this.socketPath!,
      '-rfbunixmode', '0600',
      '-AlwaysShared',
      '-nolisten', 'tcp',
      '-desktop', 'ppomppu login',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    this.xvnc.once('exit', () => this.exited('xvnc'));
    const display = await readDisplayNumber(this.xvnc);

    this.browser = spawn(chromium.executablePath(), [
      `--user-data-dir=${path.join(this.dir, 'profile')}`,
      `--load-extension=${path.join(this.dir, 'extension')}`,
      // Chromium 137+ ignores --load-extension unless this is set.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
      // No keyring daemon in the container; without this the network stack
      // waits on D-Bus and pages never load.
      '--password-store=basic',
      '--lang=ko-KR',
      '--accept-lang=ko-KR,ko,en-US,en',
      '--window-position=0,0',
      `--window-size=${DESKTOP_SIZE.width},${DESKTOP_SIZE.height}`,
      // No GPU on the server: software WebGL, as on any GPU-less desktop.
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      // The container has no user namespaces for Chromium's sandbox; the
      // bot's Playwright browser runs unsandboxed for the same reason.
      '--no-sandbox',
      opts.url,
    ], {
      stdio: 'ignore',
      env: { ...process.env, DISPLAY: `:${display}`, TZ: 'Asia/Seoul', LANGUAGE: 'ko' },
    });
    this.browser.once('exit', () => this.exited('browser'));

    await this.waitForSocket();
  }

  private async waitForSocket(): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.socketPath && fs.existsSync(this.socketPath)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('VNC socket did not appear');
  }

  private exited(what: string): void {
    if (this.closing) return;
    for (const listener of this.exitListeners) listener(what);
  }

  /** A fresh RFB connection to this desktop's display. */
  connect(): net.Socket {
    if (!this.socketPath) throw new Error('desktop_closed');
    return net.connect(this.socketPath);
  }

  async close(): Promise<void> {
    this.closing = true;
    const children = [this.browser, this.xvnc].filter((child): child is ChildProcess => child !== null);
    for (const child of children) child.kill('SIGTERM');
    await Promise.all(children.map((child) => waitForExit(child, 5000)));
    if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
    this.browser = null;
    this.xvnc = null;
    this.dir = null;
  }
}
