/**
 * lib/observer/sessionProbe.ts
 *
 * Answer "does this cookie set carry a usable ppomppu login?" by loading the
 * board once and reading the header (getBoardDiagnostics().sessionState).
 * Never touches the login form, so it cannot trip Turnstile (KE-004).
 */

import type { Cookie } from 'playwright';
import { ENV } from '../../config/env.js';
import { createBrowserContext } from '../browser/index.js';
import { getBoardDiagnostics, type SessionState } from './boardDiagnostics.js';
import { loadObserverPolicy } from './policyLoader.js';

export type SessionProbeResult = { sessionState: SessionState; url: string };

export async function probeSession(cookies: Cookie[]): Promise<SessionProbeResult> {
  const { boardUrl } = await loadObserverPolicy();
  const context = await createBrowserContext();
  try {
    await context.addCookies(cookies);
    const page = await context.newPage();
    const response = await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: ENV.BOT_NAV_TIMEOUT_MS });
    const diagnostics = await getBoardDiagnostics(page, response?.status() ?? 0);
    return { sessionState: diagnostics.sessionState, url: diagnostics.url };
  } finally {
    await context.close().catch(() => null);
  }
}
