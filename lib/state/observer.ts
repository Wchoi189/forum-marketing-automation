/**
 * lib/state/observer.ts
 *
 * Unified observer state management.
 * Combines in-memory controls with persistence layer.
 */

import { ENV } from '../../config/env.js';
import { clampInt } from '../utils.js';
import type { ObserverControls, ObserverControlsWithGap, StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const defaultObserverControls: ObserverControls = {
  enabled: true,
  minPreVisitDelayMs: 1500,
  maxPreVisitDelayMs: 4000,
  minIntervalBetweenRunsMs: 0,
};

let observerControls: ObserverControls = { ...defaultObserverControls };

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getObserverControls(): ObserverControls {
  return { ...observerControls };
}

export function getDefaultObserverControls(): ObserverControls {
  return { ...defaultObserverControls };
}

// ---------------------------------------------------------------------------
// Setters (in-memory)
// ---------------------------------------------------------------------------

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
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load persisted observer controls into in-memory state.
 * Call at server startup to restore previous session state.
 */
export async function loadPersistedObserverControls(): Promise<void> {
  const persisted = await readPersistedState();
  if (persisted.observerEnabled !== undefined) {
    observerControls.enabled = persisted.observerEnabled;
  }
  if (persisted.observerMinPreVisitDelayMs !== undefined) {
    observerControls.minPreVisitDelayMs = clampInt(persisted.observerMinPreVisitDelayMs, 1500, 0, 120000);
  }
  if (persisted.observerMaxPreVisitDelayMs !== undefined) {
    observerControls.maxPreVisitDelayMs = clampInt(persisted.observerMaxPreVisitDelayMs, 4000, 0, 120000);
  }
  if (persisted.observerMinIntervalBetweenRunsMs !== undefined) {
    observerControls.minIntervalBetweenRunsMs = clampInt(persisted.observerMinIntervalBetweenRunsMs, 0, 0, 3600000);
  }
}

/**
 * Read persisted observer controls without touching in-memory state.
 * Returns only the keys actually present on disk, so callers can distinguish
 * "never persisted" from "persisted as default".
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
  return persistState({
    observerEnabled: observerControls.enabled,
    observerMinPreVisitDelayMs: observerControls.minPreVisitDelayMs,
    observerMaxPreVisitDelayMs: observerControls.maxPreVisitDelayMs,
    observerMinIntervalBetweenRunsMs: observerControls.minIntervalBetweenRunsMs,
  }, expectedVersion);
}

// ---------------------------------------------------------------------------
// Gap threshold helpers
// ---------------------------------------------------------------------------

/**
 * Read persisted gap override from disk.
 */
export async function readGapPersistedOverride(): Promise<number | null> {
  const data = await readPersistedState();
  const v = data.observerGapThresholdMin;
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  return Math.max(1, Math.min(50, Math.round(v)));
}

/**
 * Persist gap threshold override.
 */
export async function persistGapOverride(value: number | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ observerGapThresholdMin: value }, expectedVersion);
}

/**
 * Read persisted gap source pin.
 */
export async function readGapSourcePin(): Promise<'env' | 'spec' | null> {
  const data = await readPersistedState();
  if (data.gapSourcePin === 'env' || data.gapSourcePin === 'spec') return data.gapSourcePin;
  return null;
}

/**
 * Persist gap source pin.
 */
export async function persistGapSourcePin(value: 'env' | 'spec' | null, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ gapSourcePin: value }, expectedVersion);
}

// Re-export type for convenience
export type { ObserverControls, ObserverControlsWithGap };