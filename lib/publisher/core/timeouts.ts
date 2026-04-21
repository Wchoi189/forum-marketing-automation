/**
 * Shared timeout policy values for publisher/observer runtime.
 *
 * Move-first extraction: keep numeric values and semantics identical to the
 * previously inlined constants in `bot.ts` and `lib/playbookRunner.ts`.
 */

/** Upper bound for in-page locator/URL waits in `bot.ts` (after navigation). */
export const BOT_MAX_WAIT_MS = 3000;

/** Upper bound for verify_text waits when not overridden at runtime. */
export const DEFAULT_VERIFY_TEXT_TIMEOUT_MS = 20_000;

/** Playwright locator/action timeout for draft modal + submit (avoid default 30s). */
export const PLAYBOOK_LOCATOR_TIMEOUT_MS = 3000;

/** Small retry buffer used inside post-submit URL verification. */
export const PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS = 400;

