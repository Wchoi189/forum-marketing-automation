/**
 * lib/state/observer.ts
 *
 * Unified observer state management.
 * Delegates to the authoritative reactive RuntimeStateStore.
 */

import type { ObserverControls, ObserverControlsWithGap, StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';
import { getRuntimeStateStore } from './store.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaultObserverControls: ObserverControls = {
  enabled: true,
  minPreVisitDelayMs: 1500,
  maxPreVisitDelayMs: 4000,
  minIntervalBetweenRunsMs: 0,
};

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getObserverControls(): ObserverControls {
  return getRuntimeStateStore().getObserverControls();
}

export function getDefaultObserverControls(): ObserverControls {
  return { ...defaultObserverControls };
}

// ---------------------------------------------------------------------------
// Setters (in-memory)
// ---------------------------------------------------------------------------

export function setObserverControls(next: Partial<ObserverControls>): ObserverControls {
  return getRuntimeStateStore().setObserverControlsInMemory(next);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load persisted observer controls into in-memory state.
 * Call at server startup to restore previous session state.
 */
export async function loadPersistedObserverControls(): Promise<void> {
  await getRuntimeStateStore().init();
}

/**
 * Read persisted observer controls without touching in-memory state.
 * Returns only the keys actually present on disk.
 */
export async function readPersistedObserverControls(): Promise<Partial<ObserverControls>> {
  const data = await readPersistedState();
  const result: Partial<ObserverControls> = {};
  if (typeof data.observerEnabled === 'boolean') result.enabled = data.observerEnabled;
  if (typeof data.observerMinPreVisitDelayMs === 'number') result.minPreVisitDelayMs = data.observerMinPreVisitDelayMs;
  if (typeof data.observerMaxPreVisitDelayMs === 'number') result.maxPreVisitDelayMs = data.observerMaxPreVisitDelayMs;
  if (typeof data.observerMinIntervalBetweenRunsMs === 'number') result.minIntervalBetweenRunsMs = data.observerMinIntervalBetweenRunsMs;
  return result;
}

/**
 * Persist current observer controls to disk.
 */
export async function persistObserverControls(expectedVersion?: number): Promise<StateMeta> {
  const current = getObserverControls();
  return persistState({
    observerEnabled: current.enabled,
    observerMinPreVisitDelayMs: current.minPreVisitDelayMs,
    observerMaxPreVisitDelayMs: current.maxPreVisitDelayMs,
    observerMinIntervalBetweenRunsMs: current.minIntervalBetweenRunsMs,
  }, expectedVersion);
}

// ---------------------------------------------------------------------------
// Gap threshold helpers
// ---------------------------------------------------------------------------

/**
 * Read persisted gap override from store authority.
 */
export async function readGapPersistedOverride(): Promise<number | null> {
  const store = getRuntimeStateStore();
  await store.ensureInitialized();
  return store.getGapPersistedOverride();
}

/**
 * Persist gap threshold override.
 */
export async function persistGapOverride(value: number | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ observerGapThresholdMin: value }, expectedVersion);
}

/**
 * Read persisted gap source pin from store authority.
 */
export async function readGapSourcePin(): Promise<'env' | 'spec' | null> {
  const store = getRuntimeStateStore();
  await store.ensureInitialized();
  return store.getGapSourcePin();
}

/**
 * Persist gap source pin.
 */
export async function persistGapSourcePin(value: 'env' | 'spec' | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ gapSourcePin: value ?? undefined }, expectedVersion);
}

// Re-export type for convenience
export type { ObserverControls, ObserverControlsWithGap };