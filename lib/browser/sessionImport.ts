/**
 * lib/browser/sessionImport.ts
 *
 * Turn a cookie export from a real browser into Playwright storage-state
 * cookies and merge them over the bot's saved state. This is the recovery path
 * when the ppomppu session expires: the login form sits behind Cloudflare
 * Turnstile, so the bot cannot log itself back in (KE-004).
 *
 * Pure functions only; scripts/import-session-cookies.ts and
 * POST /api/session/import (routes/api/session.ts) do the I/O.
 */

import { createHash } from 'node:crypto';
import type { Cookie } from 'playwright';

type SameSite = Cookie['sameSite'];

/** Cookie-Editor / EditThisCookie spell sameSite in Chrome's extension vocabulary. */
const EXTENSION_SAME_SITE: Record<string, SameSite> = {
  no_restriction: 'None',
  none: 'None',
  lax: 'Lax',
  strict: 'Strict',
};

function toSameSite(value: unknown): SameSite {
  if (value === 'None' || value === 'Lax' || value === 'Strict') return value;
  // 'unspecified' and missing: Chromium treats both as Lax.
  return EXTENSION_SAME_SITE[String(value ?? '').toLowerCase()] ?? 'Lax';
}

function toExpires(raw: Record<string, unknown>): number {
  if (raw.session === true) return -1;
  const value = raw.expirationDate ?? raw.expires;
  return typeof value === 'number' && value > 0 ? value : -1;
}

/**
 * Accept either a browser-extension export (`expirationDate`, `session`,
 * lowercase sameSite) or Playwright cookies, bare or wrapped in `{ cookies }`.
 */
export function convertExportedCookies(raw: unknown): Cookie[] {
  const list = Array.isArray(raw) ? raw : (raw as { cookies?: unknown })?.cookies;
  if (!Array.isArray(list)) {
    throw new Error('Cookie export must be an array of cookies or an object with a "cookies" array');
  }
  return list.map((entry, index) => {
    const c = entry as Record<string, unknown>;
    if (typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string') {
      throw new Error(`Cookie #${index} is missing a string name, value, or domain`);
    }
    return {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: typeof c.path === 'string' ? c.path : '/',
      expires: toExpires(c),
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: toSameSite(c.sameSite),
    };
  });
}

const cookieKey = (c: Cookie) => `${c.name}\u0000${c.domain}\u0000${c.path}`;

/**
 * Cloudflare binds these to the IP and user agent that solved the challenge, so
 * the bot's own copy is the one that works, not the exporter's.
 */
const BASE_WINS = new Set(['cf_clearance']);

/**
 * Overlay `incoming` on `base`, keyed the way browsers key cookies
 * (name, domain, path), and drop anything already expired. Cookies only the
 * base has are kept, and for BASE_WINS names the base copy beats the import.
 */
export function mergeCookies(base: Cookie[], incoming: Cookie[], nowSeconds = Date.now() / 1000): Cookie[] {
  const merged = new Map<string, Cookie>();
  for (const cookie of base) merged.set(cookieKey(cookie), cookie);
  for (const cookie of incoming) {
    const key = cookieKey(cookie);
    if (BASE_WINS.has(cookie.name) && merged.has(key)) continue;
    merged.set(key, cookie);
  }
  return [...merged.values()].filter((c) => c.expires <= 0 || c.expires > nowSeconds);
}

/** The cookies that carry the ppomppu login. A changed value means a new session. */
export const SESSION_COOKIE_NAMES = ['PHPSESSID', 'pmn'] as const;

/**
 * Ad and analytics cookies ppomppu's pages set on its own domain. They make up
 * most of the saved state (444 cookies on 2026-10-24, 71 of them first-party)
 * and play no part in the login. Unknown names are kept.
 */
const TRACKING_COOKIE_PATTERNS = [
  /^m_gad_pos/, /^__gads$/, /^__gpi$/, /^__eoi$/, /^__qca$/, /^cto_/, /^_ga/,
  /^_pubcid/, /^_sharedID/, /^_cc_id$/, /^adfit_sdk_id$/, /^FCCDCF$/, /^FCNEC$/,
];

const isPpomppuDomain = (domain: string) => {
  const host = domain.replace(/^\./, '');
  return host === 'ppomppu.co.kr' || host.endsWith('.ppomppu.co.kr');
};

/** First-party ppomppu cookies minus known trackers: everything a logged-in page load needs. */
export function keepSessionCookies(cookies: Cookie[]): Cookie[] {
  return cookies.filter(
    (c) => isPpomppuDomain(c.domain) && !TRACKING_COOKIE_PATTERNS.some((pattern) => pattern.test(c.name)),
  );
}

/**
 * A hash of the session cookie values, or null when no session cookie is
 * present. Two cookie sets with the same fingerprint carry the same login, so
 * a repeated import of an unchanged session can be skipped without a probe.
 */
export function sessionFingerprint(cookies: Cookie[]): string | null {
  const parts = SESSION_COOKIE_NAMES.map((name) => {
    const cookie = cookies.find((c) => c.name === name && isPpomppuDomain(c.domain));
    return cookie ? `${name}=${cookie.value}` : null;
  });
  if (parts.every((part) => part === null)) return null;
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
