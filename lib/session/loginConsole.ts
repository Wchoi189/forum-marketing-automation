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
 * The console reads the browser's cookies from its profile on disk
 * (consoleCookies.ts) and, whenever the login cookies change, hands them to
 * importSession(), which probes them in the bot's own browser and saves them
 * only if the board shows a logged-in session. Then the console closes.
 *
 * One console at a time. It closes itself on success, failure, or after
 * CONSOLE_TTL_MS.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type net from 'node:net';
import { ENV } from '../../config/env.js';
import { logger, LOG_EVENT } from '../logging/index.js';
import { sendSlackNotification } from '../notifications.js';
import { keepSessionCookies, readSavedCookies, sessionFingerprint } from '../browser/index.js';
import { loadObserverPolicy } from '../observer/index.js';
import { readProfileCookies } from './consoleCookies.js';
import { ConsoleDesktop } from './consoleDesktop.js';
import { importSession } from './importSession.js';

const PPOMPPU_LOGIN_URL = 'https://www.ppomppu.co.kr/zboard/login.php';
export const CONSOLE_TTL_MS = 15 * 60_000;
/** An automatic console (publisher found the session dead) is offered at most this often. */
export const AUTO_CONSOLE_INTERVAL_MS = 3 * 60 * 60_000;
/** `source` in the import log lines. */
export const CONSOLE_IMPORT_SOURCE = 'login-console';
const COOKIE_POLL_MS = 3000;
/** Set by ppomppu only for a member session; guests get PHPSESSID alone. */
const MEMBER_COOKIE = 'pmn';

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
  /** Fingerprint of the console cookies last handed to importSession. */
  private tried: string | null = null;
  private checking = false;

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
    const { boardUrl } = await loadObserverPolicy();
    const target = new URL(boardUrl);
    this.desktop.onExit((what) => void this.close('failed', `The console ${what} stopped.`));
    await this.desktop.start({
      url: `${PPOMPPU_LOGIN_URL}?s_url=${encodeURIComponent(target.pathname + target.search)}`,
      userId: ENV.PPOMPPU_USER_ID,
      password: ENV.PPOMPPU_USER_PW,
    });

    this.timers.push(setInterval(() => void this.checkCookies(), COOKIE_POLL_MS));
    this.timers.push(setTimeout(() => void this.close('expired', 'Console expired before a login completed.'), CONSOLE_TTL_MS));
    this.setState('ready');
  }

  /** Hand new login cookies from the console browser to importSession(). */
  private async checkCookies(): Promise<void> {
    const profileDir = this.desktop.profileDir;
    if (!this.open || this.checking || !profileDir) return;
    const cookies = keepSessionCookies(readProfileCookies(profileDir));
    const fingerprint = sessionFingerprint(cookies);
    if (!fingerprint || fingerprint === this.tried) return;

    this.checking = true;
    try {
      this.tried = fingerprint;
      const outcome = await importSession(cookies, CONSOLE_IMPORT_SOURCE, { quietRejection: true });
      if (!this.open) return;
      switch (outcome.status) {
        case 'imported':
        case 'unchanged':
          this.succeeded();
          return;
        case 'rejected':
          // Guests carry a session cookie too, so a rejection is expected until
          // the login; with the member cookie it means the bot cannot use it.
          if (cookies.some((c) => c.name === MEMBER_COOKIE)) {
            this.setState(this.state, 'Logged in here, but the bot could not confirm the session. Try 로그인 again; if it repeats, check the logs.');
          }
          return;
        case 'busy':
        case 'probe_failed':
          this.tried = null; // retry on the next poll
          return;
      }
    } finally {
      this.checking = false;
    }
  }

  private succeeded(): void {
    // Names and expiry dates only, never values: tells whether 자동로그인 issued
    // a long-lived cookie that lets the session renew without another login.
    const persistent = readSavedCookies()
      .filter((c) => c.expires > 0 && c.name !== 'cf_clearance')
      .map((c) => `${c.name}:${new Date(c.expires * 1000).toISOString().slice(0, 10)}`);
    logger.info(
      { event: LOG_EVENT.sessionImported, source: CONSOLE_IMPORT_SOURCE, reason: this.reason, persistentCookies: persistent },
      '[LoginConsole] Session restored and saved',
    );
    void this.close('succeeded', 'Logged in. Session saved; this page can be closed.');
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

export type { LoginConsole };
