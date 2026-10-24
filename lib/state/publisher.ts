/**
 * lib/state/publisher.ts
 *
 * Unified publisher state management.
 * Delegates to the authoritative reactive RuntimeStateStore.
 */

import { ENV } from '../../config/env.js';
import type { PublisherControls, StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';
import { getRuntimeStateStore } from './store.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaultPublisherControls: PublisherControls = {
  draftItemIndex: Math.max(1, Math.min(50, Math.floor(ENV.PUBLISHER_DRAFT_ITEM_INDEX ?? 1))),
  publishBlockedUntil: null,
  maintenanceBlockedUntil: null,
};

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getPublisherControls(): PublisherControls {
  return getRuntimeStateStore().getPublisherControls();
}

export function getDefaultPublisherControls(): PublisherControls {
  return { ...defaultPublisherControls };
}

// ---------------------------------------------------------------------------
// Setters (in-memory)
// ---------------------------------------------------------------------------

export function setPublisherControls(next: Partial<PublisherControls>): PublisherControls {
  return getRuntimeStateStore().setPublisherControlsInMemory(next);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load persisted publisher controls into in-memory state.
 * Call at server startup to restore previous session state.
 */
export async function loadPersistedPublisherControls(): Promise<void> {
  await getRuntimeStateStore().init();
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
  if (typeof data.maintenanceBlockedUntil === 'string' || data.maintenanceBlockedUntil === null) {
    result.maintenanceBlockedUntil = data.maintenanceBlockedUntil;
  }
  return result;
}

/**
 * Persist current publisher controls to disk.
 */
export async function persistPublisherControls(expectedVersion?: number): Promise<StateMeta> {
  const current = getPublisherControls();
  return persistState({
    publisherDraftItemIndex: current.draftItemIndex,
    publishBlockedUntil: current.publishBlockedUntil,
    maintenanceBlockedUntil: current.maintenanceBlockedUntil,
  }, expectedVersion);
}

/**
 * Persist rate limit backoff timestamp.
 */
export async function persistPublishBlockedUntil(value: string | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ publishBlockedUntil: value }, expectedVersion);
}

/**
 * Persist platform maintenance blocked timestamp.
 */
export async function persistMaintenanceBlockedUntil(value: string | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ maintenanceBlockedUntil: value }, expectedVersion);
}

// Re-export type for convenience
export type { PublisherControls };