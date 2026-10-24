/**
 * lib/session/importSession.ts
 *
 * Adopt ppomppu login cookies that a person's browser obtained: the cookie
 * push endpoint (POST /api/session/import) and the login console both land
 * here.
 *
 * Fail-closed: the merged cookies are written only after a probe in the bot's
 * own browser sees the board logged in, so a stale or logged-out set can never
 * replace a working session. The bot's own cf_clearance wins over the
 * incoming one (mergeCookies), because Cloudflare binds it to the bot's IP and
 * user agent.
 */

import fs from 'node:fs';
import type { Cookie } from 'playwright';
import { logger, LOG_EVENT } from '../logging/index.js';
import { sendSlackNotification } from '../notifications.js';
import {
  STORAGE_STATE_PATH,
  keepSessionCookies,
  mergeCookies,
  readSavedCookies,
  sessionFingerprint,
  writeSavedCookies,
} from '../browser/index.js';
import { probeSession, type SessionProbeResult } from '../observer/index.js';
import { getPublisherStatus } from '../publisher/index.js';
import { markSessionImported } from '../state/index.js';

export type ImportOutcome =
  | { status: 'imported'; sessionState: string; cookieCount: number }
  | { status: 'unchanged' }
  | { status: 'rejected'; sessionState: string }
  | { status: 'no_session_cookie' }
  | { status: 'busy'; reason: 'publisher_running' | 'import_in_progress' }
  | { status: 'probe_failed' };

export type ImportOptions = {
  /** Replaced in tests; the default loads the board in the shared browser. */
  probe?: (cookies: Cookie[]) => Promise<SessionProbeResult>;
  /** No Slack alert on rejection; the caller shows the outcome itself. */
  quietRejection?: boolean;
};

let importInFlight = false;

export async function importSession(cookies: Cookie[], source: string, opts: ImportOptions = {}): Promise<ImportOutcome> {
  const probe = opts.probe ?? probeSession;
  const incoming = keepSessionCookies(cookies);
  const incomingFingerprint = sessionFingerprint(incoming);
  if (!incomingFingerprint) return { status: 'no_session_cookie' };

  // A run that started on the old cookies saves them when it ends, which
  // would overwrite this import. The caller retries.
  if (getPublisherStatus().running) return { status: 'busy', reason: 'publisher_running' };
  if (importInFlight) return { status: 'busy', reason: 'import_in_progress' };

  const base = readSavedCookies();
  if (sessionFingerprint(base) === incomingFingerprint) return { status: 'unchanged' };

  importInFlight = true;
  try {
    const merged = keepSessionCookies(mergeCookies(base, incoming));

    let result: SessionProbeResult;
    try {
      result = await probe(merged);
    } catch (err) {
      logger.warn({ event: LOG_EVENT.sessionImportRejected, source, reason: 'probe_failed', err }, '[Session] Import probe failed');
      return { status: 'probe_failed' };
    }

    if (result.sessionState !== 'logged_in') {
      logger.warn(
        { event: LOG_EVENT.sessionImportRejected, source, reason: 'not_logged_in', sessionState: result.sessionState },
        '[Session] Imported cookies do not carry a login; saved state left unchanged',
      );
      if (!opts.quietRejection) {
        void sendSlackNotification(
          `⚠️ *ppomppu session push rejected* (${source})\n> The pushed cookies are not logged in (session=${result.sessionState}). Log in to ppomppu in the browser.`,
          'warn',
        );
      }
      return { status: 'rejected', sessionState: result.sessionState };
    }

    if (fs.existsSync(STORAGE_STATE_PATH)) {
      fs.copyFileSync(STORAGE_STATE_PATH, `${STORAGE_STATE_PATH}.bak`);
      fs.chmodSync(`${STORAGE_STATE_PATH}.bak`, 0o600);
    }
    writeSavedCookies(merged);
    // Marks the session healthy, which un-parks the scheduler (SL-002).
    await markSessionImported().catch((err) => logger.warn({ event: LOG_EVENT.sessionImported, source, err }, '[Session] Session record not updated'));

    logger.info(
      { event: LOG_EVENT.sessionImported, source, baseCount: base.length, importedCount: incoming.length, mergedCount: merged.length },
      '[Session] Session imported and verified',
    );
    void sendSlackNotification(`🔑 *ppomppu session refreshed* (${source})\n> Verified logged in; the next publisher run uses it.`, 'info');
    return { status: 'imported', sessionState: result.sessionState, cookieCount: merged.length };
  } finally {
    importInFlight = false;
  }
}
