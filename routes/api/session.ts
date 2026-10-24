/**
 * routes/api/session.ts
 *
 * ppomppu session import:
 *   POST /api/session/import
 *
 * The bot cannot log itself in (KE-004), so a logged-in browser pushes its
 * ppomppu cookies here: tools/session-sync-extension does it on every login
 * cookie change, and the body is a plain cookie export, so curl works too.
 *
 * Fail-closed throughout: no secret configured means 503, and the merged
 * cookies are written only after a probe sees the board logged in, so a stale
 * or logged-out push can never replace a working session.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Cookie } from 'playwright';
import { ENV } from '../../config/env.js';
import { logger, LOG_EVENT } from '../../lib/logging/index.js';
import { sendSlackNotification } from '../../lib/notifications.js';
import {
  STORAGE_STATE_PATH,
  convertExportedCookies,
  keepSessionCookies,
  mergeCookies,
  readSavedCookies,
  sessionFingerprint,
  writeSavedCookies,
} from '../../lib/browser/index.js';
import { probeSession, type SessionProbeResult } from '../../lib/observer/index.js';
import { getPublisherStatus } from '../../lib/publisher/index.js';

const NOOP = (_req: unknown, _res: unknown, next: () => void) => next();
const isProduction = process.env.NODE_ENV === 'production';
const importLimiter = isProduction ? rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }) : NOOP;

export type SessionRouterDeps = {
  /** Replaced in tests; the default loads the board in the shared browser. */
  probe?: (cookies: Cookie[]) => Promise<SessionProbeResult>;
};

const digest = (value: string) => createHash('sha256').update(value).digest();

function isAuthorized(header: string | undefined, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}

export function createSessionRouter(deps: SessionRouterDeps = {}): Router {
  const probe = deps.probe ?? probeSession;
  const router = Router();
  let importInFlight = false;

  router.post('/api/session/import', importLimiter, async (req, res) => {
    const secret = ENV.SESSION_IMPORT_SECRET;
    if (!secret) { res.status(503).json({ error: 'session_import_disabled' }); return; }
    if (!isAuthorized(req.headers['authorization'], secret)) { res.status(401).json({ error: 'unauthorized' }); return; }

    const body = (req.body ?? {}) as { cookies?: unknown; source?: unknown };
    const source = typeof body.source === 'string' ? body.source.slice(0, 64) : 'unknown';

    let incoming: Cookie[];
    try {
      incoming = keepSessionCookies(convertExportedCookies(body.cookies));
    } catch (err) {
      res.status(400).json({ error: 'invalid_cookies', detail: err instanceof Error ? err.message : String(err) });
      return;
    }
    const incomingFingerprint = sessionFingerprint(incoming);
    if (!incomingFingerprint) { res.status(400).json({ error: 'no_session_cookie' }); return; }

    // A run that started on the old cookies saves them when it ends, which
    // would overwrite this import. The sender retries.
    if (getPublisherStatus().running) { res.status(409).json({ error: 'publisher_running' }); return; }
    if (importInFlight) { res.status(409).json({ error: 'import_in_progress' }); return; }

    const base = readSavedCookies();
    if (sessionFingerprint(base) === incomingFingerprint) {
      res.json({ status: 'unchanged' });
      return;
    }

    importInFlight = true;
    try {
      const merged = keepSessionCookies(mergeCookies(base, incoming));

      let result: SessionProbeResult;
      try {
        result = await probe(merged);
      } catch (err) {
        logger.warn({ event: LOG_EVENT.sessionImportRejected, source, reason: 'probe_failed', err }, '[Session] Import probe failed');
        res.status(502).json({ error: 'probe_failed' });
        return;
      }

      if (result.sessionState !== 'logged_in') {
        logger.warn(
          { event: LOG_EVENT.sessionImportRejected, source, reason: 'not_logged_in', sessionState: result.sessionState },
          '[Session] Imported cookies do not carry a login; saved state left unchanged',
        );
        void sendSlackNotification(
          `⚠️ *ppomppu session push rejected* (${source})\n> The pushed cookies are not logged in (session=${result.sessionState}). Log in to ppomppu in the browser.`,
          'warn',
        );
        res.status(422).json({ status: 'rejected', sessionState: result.sessionState });
        return;
      }

      if (fs.existsSync(STORAGE_STATE_PATH)) {
        fs.copyFileSync(STORAGE_STATE_PATH, `${STORAGE_STATE_PATH}.bak`);
        fs.chmodSync(`${STORAGE_STATE_PATH}.bak`, 0o600);
      }
      writeSavedCookies(merged);

      logger.info(
        { event: LOG_EVENT.sessionImported, source, baseCount: base.length, importedCount: incoming.length, mergedCount: merged.length },
        '[Session] Session imported and verified',
      );
      void sendSlackNotification(`🔑 *ppomppu session refreshed* (${source})\n> Verified logged in; the next publisher run uses it.`, 'info');
      res.json({ status: 'imported', sessionState: result.sessionState, cookieCount: merged.length });
    } finally {
      importInFlight = false;
    }
  });

  return router;
}
