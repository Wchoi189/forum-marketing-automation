/**
 * lib/browser/sessionImport.ts
 *
 * Turn a cookie export from a real browser into Playwright storage-state
 * cookies and merge them over the bot's saved state. This is the recovery path
 * when the ppomppu session expires: the login form sits behind Cloudflare
 * Turnstile, so the bot cannot log itself back in (KE-004).
 *
 * Pure functions only; scripts/import-session-cookies.ts does the file I/O.
 */

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
