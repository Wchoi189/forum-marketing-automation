/**
 * lib/controls.ts
 *
 * In-memory runtime controls for the observer and publisher.
 *
 * These are read/written during runtime via the control panel API. They are
 * intentionally kept as simple mutable objects (no class, no store) so they
 * can be imported anywhere without circular dependency risk.
 */

import { ENV } from '../config/env.js';
import { clampInt } from './utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObserverControls = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
};

/** Observer pacing plus resolved gap policy (for control panel / API). */
export type ObserverControlsWithGap = ObserverControls & {
  gapThresholdMin: number;
  gapPersistedOverride: number | null;
  gapThresholdSpecBaseline: number;
  gapUsesEnvOverride: boolean;
  /** Which source is currently supplying the effective gap threshold. */
  gapSource: 'file' | 'env' | 'spec';
  /**
   * Explicit source pin set by the user.
   * 'env'  = always use env var (skip file override).
   * 'spec' = always use spec baseline.
   * null   = default precedence: file → env → spec.
   */
  gapSourcePin: 'env' | 'spec' | null;
};

export type PublisherControls = {
  /** 1-based saved-draft item row (alternating item / preview rows use offset automatically). */
  draftItemIndex: number;
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const observerControls: ObserverControls = {
  enabled: true,
  minPreVisitDelayMs: 1500,
  maxPreVisitDelayMs: 4000,
  minIntervalBetweenRunsMs: 0
};

const publisherControls: PublisherControls = {
  draftItemIndex: ENV.PUBLISHER_DRAFT_ITEM_INDEX
};

// ---------------------------------------------------------------------------
// Observer controls
// ---------------------------------------------------------------------------

export function getObserverControls(): ObserverControls {
  return { ...observerControls };
}

export function setObserverControls(next: Partial<ObserverControls>): ObserverControls {
  if (typeof next.enabled === 'boolean') {
    observerControls.enabled = next.enabled;
  }

  const minDelay = clampInt(next.minPreVisitDelayMs, observerControls.minPreVisitDelayMs, 0, 120000);
  const maxDelay = clampInt(next.maxPreVisitDelayMs, observerControls.maxPreVisitDelayMs, 0, 120000);
  observerControls.minPreVisitDelayMs = Math.min(minDelay, maxDelay);
  observerControls.maxPreVisitDelayMs = Math.max(minDelay, maxDelay);
  observerControls.minIntervalBetweenRunsMs = clampInt(
    next.minIntervalBetweenRunsMs,
    observerControls.minIntervalBetweenRunsMs,
    0,
    3600000
  );

  return getObserverControls();
}

// ---------------------------------------------------------------------------
// Publisher controls
// ---------------------------------------------------------------------------

export function getPublisherControls(): PublisherControls {
  return { ...publisherControls };
}

export function setPublisherControls(next: Partial<PublisherControls>): PublisherControls {
  publisherControls.draftItemIndex = clampInt(
    next.draftItemIndex,
    publisherControls.draftItemIndex,
    1,
    50
  );
  return getPublisherControls();
}
