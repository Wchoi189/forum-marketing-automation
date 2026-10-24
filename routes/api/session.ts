/**
 * routes/api/session.ts
 *
 * ppomppu session recovery:
 *   POST /api/session/import                      cookie push from a logged-in browser
 *   POST /api/session/console                     open a login console (lib/session); returns its URL
 *   GET  /session/console                         entry page: open a console here (secret) or link to Slack
 *   POST /api/session/console/request             open a console, link to Slack only
 *   GET  /session/console/:token                  console viewer page
 *   GET  /api/session/console/:token/events       console state (SSE)
 *   WS   /api/session/console/:token/vnc          the console desktop (lib/session/vncBridge.ts)
 *   GET  /session/novnc/rfb.js                    noVNC client for the viewer
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
import {
  CONSOLE_IMPORT_SOURCE,
  currentLoginConsole,
  findLoginConsole,
  loadNovncBundle,
  openLoginConsole,
  renderConsolePage,
  renderConsoleRequestPage,
  type ConsoleEvent,
} from '../../lib/session/index.js';

const NOOP = (_req: unknown, _res: unknown, next: () => void) => next();
const isProduction = process.env.NODE_ENV === 'production';
const importLimiter = isProduction ? rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }) : NOOP;

export type SessionRouterDeps = {
  /** Replaced in tests; the default loads the board in the shared browser. */
  probe?: (cookies: Cookie[]) => Promise<SessionProbeResult>;
  /** Replaced in tests; the default launches a login console in the shared browser. */
  openConsole?: typeof openLoginConsole;
};

const SSE_HEARTBEAT_MS = 20_000;

const digest = (value: string) => createHash('sha256').update(value).digest();

function isAuthorized(header: string | undefined, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}

export function createSessionRouter(deps: SessionRouterDeps = {}): Router {
  const probe = deps.probe ?? probeSession;
  const openConsole = deps.openConsole ?? openLoginConsole;
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

    // The login console's own browser pushes here too; it shows the outcome on
    // its page, and its guest-session pushes are expected rejections, not alerts.
    const fromConsole = source === CONSOLE_IMPORT_SOURCE ? currentLoginConsole() : null;

    const base = readSavedCookies();
    if (sessionFingerprint(base) === incomingFingerprint) {
      fromConsole?.noteImport('unchanged');
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
        if (fromConsole) {
          fromConsole.noteImport('rejected');
        } else {
          void sendSlackNotification(
            `⚠️ *ppomppu session push rejected* (${source})\n> The pushed cookies are not logged in (session=${result.sessionState}). Log in to ppomppu in the browser.`,
            'warn',
          );
        }
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
      fromConsole?.noteImport('imported');
      res.json({ status: 'imported', sessionState: result.sessionState, cookieCount: merged.length });
    } finally {
      importInFlight = false;
    }
  });

  // ── Login console ─────────────────────────────────────────────────────────
  // Opening one needs the secret. The console's own pages are authorized by its
  // unguessable, short-lived token, which is what the Slack link carries and
  // what the entry page navigates to after opening one with the secret.

  router.post('/api/session/console', importLimiter, async (req, res) => {
    const secret = ENV.SESSION_IMPORT_SECRET;
    if (!secret) { res.status(503).json({ error: 'session_import_disabled' }); return; }
    if (!isAuthorized(req.headers['authorization'], secret)) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      res.json(await openConsole('manual'));
    } catch (err) {
      res.status(502).json({ error: 'console_failed', detail: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/session/console', (_req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(renderConsoleRequestPage());
  });

  // No auth: the response never carries the token; the link goes to Slack only.
  router.post('/api/session/console/request', importLimiter, async (_req, res) => {
    try {
      const info = await openConsole('requested', { renotify: true });
      res.json({ status: 'link_sent_to_slack', expiresAt: info?.expiresAt ?? null });
    } catch (err) {
      res.status(502).json({ error: 'console_failed', detail: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/session/console/:token', (req, res) => {
    if (!findLoginConsole(req.params.token)) { res.status(404).type('text/plain').send('This login link has expired. Open /session/console for a new one.'); return; }
    res.set('Cache-Control', 'no-store').type('html').send(renderConsolePage(req.params.token));
  });

  router.get('/api/session/console/:token/events', (req, res) => {
    const loginConsole = findLoginConsole(req.params.token);
    if (!loginConsole) { res.status(404).end(); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const unsubscribe = loginConsole.subscribe((event: ConsoleEvent) => {
      res.write(`event: state\ndata: ${JSON.stringify({ state: event.state, detail: event.detail })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), SSE_HEARTBEAT_MS);
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });

  router.get('/session/novnc/rfb.js', async (_req, res) => {
    const bundle = await loadNovncBundle();
    if (!bundle) { res.status(503).type('text/plain').send('noVNC bundle unavailable'); return; }
    res.set('Cache-Control', 'public, max-age=86400').type('application/javascript').send(bundle);
  });

  return router;
}
