/**
 * lib/browserDebug.ts
 *
 * Shared browser debug logging setup.
 *
 * Registers request, response, and cookie logging on a Playwright page when
 * BROWSER_REQUEST_LOGGING is enabled. Centralised here so observer and
 * publisher share the same debug handler registration logic.
 */

import { ENV } from '../config/env.js';
import { logger } from './logger.js';

/** Enable request/response/cookie logging if BROWSER_REQUEST_LOGGING is enabled. */
export function registerBrowserDebugHandlers(page: import('playwright').Page, label: string): void {
  if (!ENV.BROWSER_REQUEST_LOGGING) return;

  page.on('request', request => {
    if (ENV.LOG_LEVEL === 'debug') {
      logger.debug({
        event: 'browser_request',
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
      }, `[${label}] Browser request`);
    }
  });

  page.on('response', response => {
    if (ENV.LOG_LEVEL === 'debug') {
      logger.debug({
        event: 'browser_response',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
      }, `[${label}] Browser response`);
    }
  });

  if (ENV.LOG_LEVEL === 'debug') {
    page.context().cookies().then(cookies => {
      logger.debug({
        event: 'browser_cookies_initial',
        cookieCount: cookies.length,
        cookies: cookies.map(cookie => ({
          name: cookie.name,
          domain: cookie.domain,
          expires: cookie.expires
        }))
      }, `[${label}] Initial browser cookies`);
    }).catch(() => null);
  }
}
