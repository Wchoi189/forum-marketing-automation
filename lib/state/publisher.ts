/**
 * lib/state/publisher.ts
 *
 * Unified publisher state management.
 * Combines in-memory controls with persistence layer.
 */

import { ENV } from '../../config/env.js';
import { clampInt } from '../utils.js';
import type { PublisherControls, StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const defaultPublisherControls: PublisherControls = {
  draftItemIndex: ENV.PUBLISHER_DRAFT_ITEM_INDEX,
  publishBlockedUntil: null,
};

let publisherControls: PublisherControls = { ...defaultPublisherControls };

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getPublisherControls(): PublisherControls {
  return { ...publisherControls };
}

export function getDefaultPublisherControls(): PublisherControls {
  return { ...defaultPublisherControls };
}

// ---------------------------------------------------------------------------
// Setters (in-memory)
// ---------------------------------------------------------------------------

export function setPublisherControls(next: Partial<PublisherControls>): PublisherControls {
  publisherControls.draftItemIndex = clampInt(
    next.draftItemIndex,
    publisherControls.draftItemIndex,
    1,
    50
  );
  if (typeof next.publishBlockedUntil === 'string' || next.publishBlockedUntil === null) {
    publisherControls.publishBlockedUntil = next.publishBlockedUntil;
  }
  return getPublisherControls();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load persisted publisher controls into in-memory state.
 * Call at server startup to restore previous session state.
 */
export async function loadPersistedPublisherControls(): Promise<void> {
  const persisted = await readPersistedState();
  if (persisted.publisherDraftItemIndex !== undefined) {
    publisherControls.draftItemIndex = clampInt(persisted.publisherDraftItemIndex, 1, 1, 50);
  }
  if (persisted.publishBlockedUntil !== undefined) {
    if (typeof persisted.publishBlockedUntil === 'string') {
      const t = Date.parse(persisted.publishBlockedUntil);
      if (Number.isFinite(t)) {
        publisherControls.publishBlockedUntil = persisted.publishBlockedUntil;
      }
    } else if (persisted.publishBlockedUntil === null) {
      publisherControls.publishBlockedUntil = null;
    }
  }
}

/**
 * Read persisted publisher controls without touching in-memory state.
 * Returns only the keys actually present on disk.
 */
export async function readPersistedPublisherControls(): Promise<Partial<PublisherControls>> {
  const data = await readPersistedState();
  const result: Partial<PublisherControls> = {};
  if (typeof data.publisherDraftItemIndex === 'number') result.draftItemIndex = data.publisherDraftItemIndex;
  if (typeof data.publishBlockedUntil === 'string' || data.publishBlockedUntil === null) {
    result.publishBlockedUntil = data.publishBlockedUntil;
  }
  return result;
}

/**
 * Persist current publisher controls to disk.
 */
export async function persistPublisherControls(expectedVersion?: number): Promise<StateMeta> {
  return persistState({
    publisherDraftItemIndex: publisherControls.draftItemIndex,
    publishBlockedUntil: publisherControls.publishBlockedUntil,
  }, expectedVersion);
}

/**
 * Persist rate limit backoff timestamp.
 */
export async function persistPublishBlockedUntil(value: string | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ publishBlockedUntil: value }, expectedVersion);
}

// Re-export type for convenience
export type { PublisherControls };