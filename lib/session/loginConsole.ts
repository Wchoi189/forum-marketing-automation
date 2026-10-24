/**
 * lib/session/loginConsole.ts
 *
 * Remote login console: restore an expired ppomppu session from any device,
 * without a desktop browser and without automating the challenge.
 *
 * The bot cannot log itself in. The login form is guarded by Cloudflare
 * Turnstile plus a nonce/probe wrapper (KE-004). So the server's own Chromium
 * opens login.php, fills the ID and password from env and ticks 자동로그인, and
 * streams the page (CDP screencast) to a token-protected web page. A person
 * taps the Turnstile check and 로그인 on that page, from a phone if need be.
 * The session cookies are then captured inside the server's own browser, so
 * they carry the server's IP and user agent (cf_clearance stays consistent),
 * and are saved only once the board header shows a logged-in session.
 *
 * One console at a time. It closes itself on success, failure, or after
 * CONSOLE_TTL_MS.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { BrowserContext, CDPSession, Dialog, Page } from 'playwright';
import { ENV } from '../../config/env.js';
import { logger, LOG_EVENT } from '../logging/index.js';
import { sendSlackNotification } from '../notifications.js';
import { createBrowserContext, keepSessionCookies, saveStorageState } from '../browser/index.js';
import { getBoardDiagnostics, loadObserverPolicy } from '../observer/index.js';

const PPOMPPU_LOGIN_URL = 'https://www.ppomppu.co.kr/zboard/login.php';
export const CONSOLE_TTL_MS = 15 * 60_000;
/** An automatic console (publisher found the session dead) is offered at most this often. */
export const AUTO_CONSOLE_INTERVAL_MS = 3 * 60 * 60_000;
const SUCCESS_POLL_MS = 2000;
const VIEWPORT = { width: 412, height: 860 };

export type ConsoleState = 'starting' | 'ready' | 'succeeded' | 'failed' | 'expired' | 'closed';

export type ConsoleEvent =
  | { type: 'frame'; data: string }
  | { type: 'state'; state: ConsoleState; detail: string | null };

export type ConsoleInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: 'Enter' | 'Backspace' | 'Tab' }
  | { type: 'reload' };

export type ConsoleSummary = { token: string; url: string; expiresAt: string; reason: string };

class LoginConsole {
  readonly token = randomBytes(24).toString('base64url');
  readonly expiresAt = Date.now() + CONSOLE_TTL_MS;
  state: ConsoleState = 'starting';
  detail: string | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private lastFrame: string | null = null;
  private readonly listeners = new Set<(event: ConsoleEvent) => void>();
  private timers: NodeJS.Timeout[] = [];
  private checking = false;

  constructor(readonly reason: string) {}

  get open(): boolean {
    return this.state === 'starting' || this.state === 'ready';
  }

  subscribe(listener: (event: ConsoleEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'state', state: this.state, detail: this.detail });
    if (this.lastFrame) listener({ type: 'frame', data: this.lastFrame });
    return () => this.listeners.delete(listener);
  }

  private emit(event: ConsoleEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setState(state: ConsoleState, detail: string | null = null): void {
    this.state = state;
    this.detail = detail;
    this.emit({ type: 'state', state, detail });
  }

  async start(): Promise<void> {
    // Saved state supplies the server's own cf_clearance; the dead login
    // cookies in it are replaced by the new login.
    this.context = await createBrowserContext({ loadSavedStorageState: true });
    this.context.setDefaultTimeout(15_000);
    this.page = await this.context.newPage();
    await this.page.setViewportSize(VIEWPORT);
    this.page.on('dialog', (dialog: Dialog) => {
      // ppomppu reports a rejected login (failed security check, bad password) as an alert.
      this.detail = dialog.message();
      this.emit({ type: 'state', state: this.state, detail: this.detail });
      dialog.dismiss().catch(() => null);
    });

    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      this.lastFrame = data;
      this.emit({ type: 'frame', data });
      this.cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => null);
    });

    await this.loadLoginForm();
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
    });

    this.timers.push(setInterval(() => void this.checkLoggedIn(), SUCCESS_POLL_MS));
    this.timers.push(setTimeout(() => void this.close('expired', 'Console expired before a login completed.'), CONSOLE_TTL_MS));
    this.setState('ready');
  }

  private async loadLoginForm(): Promise<void> {
    const page = this.page!;
    const { boardUrl } = await loadObserverPolicy();
    const target = new URL(boardUrl);
    await page.goto(`${PPOMPPU_LOGIN_URL}?s_url=${encodeURIComponent(target.pathname + target.search)}`, {
      waitUntil: 'domcontentloaded',
      timeout: ENV.BOT_NAV_TIMEOUT_MS,
    });
    // Fill only. Submitting is the person's action, after they pass Turnstile.
    await page.locator('input[name="user_id"]').first().fill(ENV.PPOMPPU_USER_ID).catch(() => null);
    await page.locator('input[name="password"]').first().fill(ENV.PPOMPPU_USER_PW).catch(() => null);
    await page.evaluate(() => {
      const box = document.querySelector('input[name="auto_login"]') as HTMLInputElement | null;
      if (box && !box.checked) box.checked = true;
    }).catch(() => null);
  }

  private async checkLoggedIn(): Promise<void> {
    const page = this.page;
    if (!page || !this.open || this.checking || new URL(page.url()).pathname.endsWith('/login.php')) return;
    this.checking = true;
    try {
      await this.saveIfLoggedIn(page);
    } finally {
      this.checking = false;
    }
  }

  private async saveIfLoggedIn(page: Page): Promise<void> {
    const diagnostics = await getBoardDiagnostics(page).catch(() => null);
    if (diagnostics?.sessionState !== 'logged_in') return;

    await saveStorageState(this.context!);
    // Names and expiry dates only, never values: tells whether 자동로그인 issued
    // a long-lived cookie that lets the session renew without another login.
    const persistent = keepSessionCookies(await this.context!.cookies().catch(() => []))
      .filter((c) => c.expires > 0 && c.name !== 'cf_clearance')
      .map((c) => `${c.name}:${new Date(c.expires * 1000).toISOString().slice(0, 10)}`);
    logger.info(
      { event: LOG_EVENT.sessionImported, source: 'login_console', reason: this.reason, persistentCookies: persistent },
      '[LoginConsole] Session restored and saved',
    );
    void sendSlackNotification(`🔑 *ppomppu session restored* via login console\n> Saved from the server's browser; the next publisher run uses it.`, 'info');
    await this.close('succeeded', 'Logged in. Session saved; this page can be closed.');
  }

  async input(input: ConsoleInput): Promise<void> {
    const page = this.page;
    if (!page || !this.open) throw new Error('console_closed');
    switch (input.type) {
      case 'click':
        await page.mouse.click(input.x, input.y);
        break;
      case 'text':
        await page.keyboard.insertText(input.text);
        break;
      case 'key':
        await page.keyboard.press(input.key);
        break;
      case 'reload':
        this.detail = null;
        await this.loadLoginForm();
        break;
    }
  }

  async close(state: Exclude<ConsoleState, 'starting' | 'ready'> = 'closed', detail: string | null = null): Promise<void> {
    if (!this.open) return;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.setState(state, detail);
    if (state !== 'succeeded') {
      logger.warn({ event: LOG_EVENT.sessionImportRejected, source: 'login_console', reason: state, detail }, `[LoginConsole] Closed: ${state}`);
    }
    await this.cdp?.send('Page.stopScreencast').catch(() => null);
    await this.context?.close().catch(() => null);
    this.context = null;
    this.page = null;
    this.cdp = null;
  }
}

let current: LoginConsole | null = null;
let lastAutoConsoleAt = 0;

function consoleUrl(token: string): string {
  return `${ENV.PUBLIC_BASE_URL.replace(/\/$/, '')}/session/console/${token}`;
}

function summary(instance: LoginConsole): ConsoleSummary {
  return {
    token: instance.token,
    url: consoleUrl(instance.token),
    expiresAt: new Date(instance.expiresAt).toISOString(),
    reason: instance.reason,
  };
}

/**
 * Open a login console, or return the one already open, and post its link to
 * Slack. `auto` consoles (the publisher found the session dead) are offered at
 * most every AUTO_CONSOLE_INTERVAL_MS so an hourly scheduler does not hold a
 * browser context and a fresh Slack link open around the clock.
 */
export async function openLoginConsole(
  reason: string,
  opts: { auto?: boolean; renotify?: boolean } = {},
): Promise<ConsoleSummary | null> {
  if (current?.open) {
    if (opts.renotify) postLink(summary(current), reason);
    return summary(current);
  }
  if (opts.auto && Date.now() - lastAutoConsoleAt < AUTO_CONSOLE_INTERVAL_MS) return null;
  if (opts.auto) lastAutoConsoleAt = Date.now();

  const instance = new LoginConsole(reason);
  current = instance;
  try {
    await instance.start();
  } catch (err) {
    await instance.close('failed', err instanceof Error ? err.message : String(err));
    throw err;
  }
  const info = summary(instance);
  postLink(info, reason);
  return info;
}

function postLink(info: ConsoleSummary, reason: string): void {
  void sendSlackNotification(
    `🔐 *ppomppu login needed* (${reason})\n> Open on any device on the tailnet, tap the security check and 로그인: ${info.url}\n> Link expires ${info.expiresAt}.`,
    'warn',
  );
}

/** The open console whose token matches, compared in constant time. */
export function findLoginConsole(token: string): LoginConsole | null {
  if (!current) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(current.token);
  return a.length === b.length && timingSafeEqual(a, b) ? current : null;
}

export type { LoginConsole };
