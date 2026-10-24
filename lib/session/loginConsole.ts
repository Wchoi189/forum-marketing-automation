/**
 * lib/session/loginConsole.ts
 *
 * Remote login console: restore an expired ppomppu session from any device,
 * without a desktop PC and without automating the challenge.
 *
 * The bot cannot log itself in. The login form is guarded by Cloudflare
 * Turnstile plus a nonce/probe wrapper (KE-004). So the server opens a plain
 * Chromium on login.php in a private VNC desktop (consoleDesktop.ts), with the
 * ID and password filled in and 자동로그인 ticked, and a token-protected web
 * page shows that desktop (vncBridge.ts). A person taps the Turnstile check and
 * 로그인 there, from a phone if need be.
 *
 * The console browser's extension pushes the new login cookies to
 * POST /api/session/import, which probes them in the bot's own browser and
 * saves them only if the board shows a logged-in session. The console sees the
 * saved session change and closes.
 *
 * One console at a time. It closes itself on success, failure, or after
 * CONSOLE_TTL_MS.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type net from 'node:net';
import { ENV } from '../../config/env.js';
import { logger, LOG_EVENT } from '../logging/index.js';
import { sendSlackNotification } from '../notifications.js';
import { readSavedCookies, sessionFingerprint } from '../browser/index.js';
import { loadObserverPolicy } from '../observer/index.js';
import { ConsoleDesktop } from './consoleDesktop.js';

const PPOMPPU_LOGIN_URL = 'https://www.ppomppu.co.kr/zboard/login.php';
export const CONSOLE_TTL_MS = 15 * 60_000;
/** An automatic console (publisher found the session dead) is offered at most this often. */
export const AUTO_CONSOLE_INTERVAL_MS = 3 * 60 * 60_000;
/** The `source` the console browser's extension sends with its cookie pushes. */
export const CONSOLE_IMPORT_SOURCE = 'login-console';
const SUCCESS_POLL_MS = 2000;

export type ConsoleState = 'starting' | 'ready' | 'succeeded' | 'failed' | 'expired' | 'closed';

export type ConsoleEvent = { type: 'state'; state: ConsoleState; detail: string | null };

export type ConsoleSummary = { token: string; url: string; expiresAt: string; reason: string };

class LoginConsole {
  readonly token = randomBytes(24).toString('base64url');
  readonly expiresAt = Date.now() + CONSOLE_TTL_MS;
  state: ConsoleState = 'starting';
  detail: string | null = null;
  private readonly desktop = new ConsoleDesktop();
  private readonly listeners = new Set<(event: ConsoleEvent) => void>();
  private timers: NodeJS.Timeout[] = [];
  private baseline: string | null = null;

  constructor(readonly reason: string) {}

  get open(): boolean {
    return this.state === 'starting' || this.state === 'ready';
  }

  subscribe(listener: (event: ConsoleEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'state', state: this.state, detail: this.detail });
    return () => this.listeners.delete(listener);
  }

  private setState(state: ConsoleState, detail: string | null = null): void {
    this.state = state;
    this.detail = detail;
    for (const listener of this.listeners) listener({ type: 'state', state, detail });
  }

  async start(): Promise<void> {
    const secret = ENV.SESSION_IMPORT_SECRET;
    if (!secret) throw new Error('session_import_disabled: SESSION_IMPORT_SECRET is not set');
    this.baseline = sessionFingerprint(readSavedCookies());

    const { boardUrl } = await loadObserverPolicy();
    const target = new URL(boardUrl);
    this.desktop.onExit((what) => void this.close('failed', `The console ${what} stopped.`));
    await this.desktop.start({
      url: `${PPOMPPU_LOGIN_URL}?s_url=${encodeURIComponent(target.pathname + target.search)}`,
      importEndpoint: `http://127.0.0.1:${ENV.PORT}/api/session/import`,
      importSecret: secret,
      importSource: CONSOLE_IMPORT_SOURCE,
      userId: ENV.PPOMPPU_USER_ID,
      password: ENV.PPOMPPU_USER_PW,
    });

    this.timers.push(setInterval(() => this.checkSaved(), SUCCESS_POLL_MS));
    this.timers.push(setTimeout(() => void this.close('expired', 'Console expired before a login completed.'), CONSOLE_TTL_MS));
    this.setState('ready');
  }

  /** The import endpoint saved a new session: the login went through. */
  private checkSaved(): void {
    if (!this.open) return;
    const saved = readSavedCookies();
    if (sessionFingerprint(saved) === this.baseline) return;
    // Names and expiry dates only, never values: tells whether 자동로그인 issued
    // a long-lived cookie that lets the session renew without another login.
    const persistent = saved
      .filter((c) => c.expires > 0 && c.name !== 'cf_clearance')
      .map((c) => `${c.name}:${new Date(c.expires * 1000).toISOString().slice(0, 10)}`);
    logger.info(
      { event: LOG_EVENT.sessionImported, source: CONSOLE_IMPORT_SOURCE, reason: this.reason, persistentCookies: persistent },
      '[LoginConsole] Session restored and saved',
    );
    void this.close('succeeded', 'Logged in. Session saved; this page can be closed.');
  }

  /** Called by the import endpoint for pushes from this console's browser. */
  noteImport(status: 'imported' | 'unchanged' | 'rejected'): void {
    if (!this.open) return;
    if (status === 'rejected') {
      this.setState(this.state, 'Not logged in yet. Tap the security check, then 로그인.');
    } else {
      this.checkSaved();
    }
  }

  /** A fresh VNC connection to the console desktop. */
  connectVnc(): net.Socket {
    if (!this.open) throw new Error('console_closed');
    return this.desktop.connect();
  }

  async close(state: Exclude<ConsoleState, 'starting' | 'ready'> = 'closed', detail: string | null = null): Promise<void> {
    if (!this.open) return;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.setState(state, detail);
    if (state !== 'succeeded') {
      logger.warn({ event: LOG_EVENT.sessionImportRejected, source: CONSOLE_IMPORT_SOURCE, reason: state, detail }, `[LoginConsole] Closed: ${state}`);
    }
    await this.desktop.close().catch((err) => logger.warn({ err }, '[LoginConsole] Desktop did not close cleanly'));
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
 * browser and a fresh Slack link open around the clock.
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

/** The console currently open, if any; the import endpoint reports pushes to it. */
export function currentLoginConsole(): LoginConsole | null {
  return current?.open ? current : null;
}

export type { LoginConsole };
