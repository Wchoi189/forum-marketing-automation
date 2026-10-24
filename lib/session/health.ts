/**
 * lib/session/health.ts
 *
 * Keep the operator ahead of a dying ppomppu session (SL-004, SL-005): a cheap
 * probe of the saved session for ticks that launch no browser, one Slack
 * message when the session enters 'expiring', and one when it dies. The
 * scheduler calls in through BotDeps.session; the publisher calls
 * announceSessionLost when a run finds the session gone.
 */

import { ENV } from '../../config/env.js';
import { logger, LOG_EVENT } from '../logging/index.js';
import { sendSlackNotification } from '../notifications.js';
import { readSavedCookies } from '../browser/index.js';
import { probeSession, type SessionState } from '../observer/index.js';
import {
  deriveSessionStatus,
  getSessionRecord,
  markSessionLost,
  markSessionVerified,
  sessionView,
} from '../state/index.js';
import { openLoginConsole, type ConsoleSummary } from './loginConsole.js';

const CONSOLE_PATH = '/session/console';

/** importedAt of the session the expiry warning was last sent for. In memory: a restart may repeat it once. */
let expiryAlertedFor: string | null = null;

function ageHours(fromIso: string | null, now: number): number | null {
  return fromIso ? Math.round((now - Date.parse(fromIso)) / 3_600_000) : null;
}

/**
 * Send the expiry warning once per imported session. Cheap and browser-free, so
 * the scheduler runs it on every timer firing, enabled or not.
 */
export async function checkSessionExpiry(now: number = Date.now()): Promise<boolean> {
  const record = getSessionRecord();
  if (deriveSessionStatus(record, now) !== 'expiring' || !record.importedAt) return false;
  if (expiryAlertedFor === record.importedAt) return false;
  expiryAlertedFor = record.importedAt;

  const { expectedEndAt } = sessionView(record, now);
  const age = ageHours(record.importedAt, now);
  logger.warn(
    { event: LOG_EVENT.sessionExpiring, importedAt: record.importedAt, ageHours: age, expectedEndAt },
    '[Session] ppomppu session is near its expected end',
  );
  await sendSlackNotification(
    `⏳ *ppomppu session expiring*\n> Logged in ${age} h ago; expected to end around ${expectedEndAt}.` +
      `\n> A fresh login now keeps posting uninterrupted: ${ENV.PUBLIC_BASE_URL}${CONSOLE_PATH}`,
    'warn',
  );
  return true;
}

/**
 * The session was found dead. A login console link to Slack is the alert; when
 * none can be offered (rate limit, or it failed to start) a transition still
 * gets a plain message, so every death is announced exactly once.
 */
export async function announceSessionLost(reason: string, transitioned: boolean): Promise<void> {
  if (transitioned) {
    const record = getSessionRecord();
    logger.warn(
      { event: LOG_EVENT.sessionLost, reason, importedAt: record.importedAt, ageHours: ageHours(record.importedAt, Date.now()) },
      '[Session] ppomppu session lost; scheduler parked',
    );
  }

  let consoleInfo: ConsoleSummary | null = null;
  try {
    consoleInfo = await openLoginConsole(`session dead: ${reason}`, { auto: true, renotify: transitioned });
  } catch (err) {
    logger.warn({ event: LOG_EVENT.sessionImportRejected, reason: 'console_failed', err }, '[Session] login console failed to open');
  }
  if (consoleInfo || !transitioned) return;

  await sendSlackNotification(
    `💀 *ppomppu session dead* (${reason})\n> The scheduler is parked; nothing posts until someone logs in.` +
      `\n> Request a login console: ${ENV.PUBLIC_BASE_URL}${CONSOLE_PATH}`,
    'error',
  );
}

export type SessionProbeOptions = {
  /** Replaced in tests; the default loads the board in the shared browser. */
  probe?: typeof probeSession;
  /** Replaced in tests; the default opens a login console. */
  announce?: typeof announceSessionLost;
};

/**
 * Load the board once with the saved cookies and record what the header says.
 * Only logged_out marks the session dead; 'unknown' (WAF page, odd markup) changes
 * nothing. A result is dropped if an import or a run rewrote the record meanwhile.
 */
export async function probeSavedSession(opts: SessionProbeOptions = {}): Promise<SessionState> {
  const probe = opts.probe ?? probeSession;
  const before = getSessionRecord();
  const startedAt = Date.now();
  const { sessionState } = await probe(readSavedCookies());

  const after = getSessionRecord();
  const stale = after.importedAt !== before.importedAt || after.status !== before.status;
  logger.info(
    { event: LOG_EVENT.sessionProbed, sessionState, stale, durationMs: Date.now() - startedAt },
    `[Session] Probe: ${sessionState}${stale ? ' (discarded, record changed meanwhile)' : ''}`,
  );
  if (stale) return sessionState;

  if (sessionState === 'logged_in') {
    await markSessionVerified();
  } else if (sessionState === 'logged_out') {
    const transitioned = (await markSessionLost('probe_logged_out')) !== null;
    await (opts.announce ?? announceSessionLost)('probe_logged_out', transitioned);
  }
  return sessionState;
}
