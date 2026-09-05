/**
 * lib/publisher/cooldownGate.ts
 *
 * The publisher's rate-limit pre-flight. Purely local: it reads in-memory
 * publisher controls and the publisher history file, and never touches the
 * network or a browser. That is the point — RTG-001 requires this gate to run
 * before `runObserver()` launches Chromium, so the platform's one-post-per-hour
 * ceiling is enforced from what we already know rather than rediscovered by
 * browsing the board.
 */

import { logger, LOG_EVENT } from '../logging/index.js';
import { getPublisherControls, setPublisherControls, persistPublishBlockedUntil } from '../state/index.js';
import { PUBLISH_COOLDOWN_WINDOW_MS } from './constants.js';
import { getLastSuccessfulPublish } from './history.js';

export type PublishCooldownBlock = {
  /** Operator-facing reason, used verbatim as the run message. */
  message: string;
  /** Whole minutes remaining until publishing is allowed again. */
  remainingMinutes: number;
};

/**
 * Returns a block descriptor when publishing is still inside the cooldown
 * window, or `null` when the publisher may proceed.
 *
 * Two sources, checked in order:
 *  1. `publishBlockedUntil` in runtime state — set by a previous rate-limit hit.
 *  2. The last verified publish in publisher history (STAB-001) — survives a
 *     restart that cleared or never loaded the in-memory deadline, and
 *     back-fills `publishBlockedUntil` when it fires.
 */
export async function evaluatePublishCooldown(runId: string): Promise<PublishCooldownBlock | null> {
  const controls = getPublisherControls();
  if (controls.publishBlockedUntil) {
    const blockedUntilMs = new Date(controls.publishBlockedUntil).getTime();
    if (Number.isFinite(blockedUntilMs) && blockedUntilMs > Date.now()) {
      const remainingMinutes = Math.ceil((blockedUntilMs - Date.now()) / 60000);
      logger.info(
        {
          event: LOG_EVENT.publisherRunSkipped,
          runId,
          decision: 'rate_limited',
          blockedUntil: controls.publishBlockedUntil,
          remainingMin: remainingMinutes,
        },
        '[Publisher] rate_limited skip — backoff active'
      );
      return {
        message: `[Publisher] Rate limited — ${remainingMinutes} minutes remaining until ${controls.publishBlockedUntil}`,
        remainingMinutes,
      };
    }
  }

  const lastPublish = await getLastSuccessfulPublish(50).catch(() => null);
  if (!lastPublish?.at) return null;

  const lastPublishMs = new Date(lastPublish.at).getTime();
  if (!Number.isFinite(lastPublishMs)) return null;

  const elapsedMs = Date.now() - lastPublishMs;
  if (elapsedMs < 0 || elapsedMs >= PUBLISH_COOLDOWN_WINDOW_MS) return null;

  const remainingMs = PUBLISH_COOLDOWN_WINDOW_MS - elapsedMs;
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const blockedUntil = new Date(Date.now() + remainingMs).toISOString();
  setPublisherControls({ publishBlockedUntil: blockedUntil });
  await persistPublishBlockedUntil(blockedUntil).catch(() => null);

  logger.info(
    {
      event: LOG_EVENT.publisherRunSkipped,
      runId,
      decision: 'rate_limited',
      lastPublishAt: lastPublish.at,
      elapsedMs,
      remainingMin: remainingMinutes,
      publishBlockedUntil: blockedUntil,
    },
    '[Publisher] rate_limited skip — 60-minute cooldown active from last publish'
  );

  return {
    message: `[Publisher] Rate limited — 60-minute cooldown active (${remainingMinutes} minutes remaining from last publish at ${lastPublish.at})`,
    remainingMinutes,
  };
}
