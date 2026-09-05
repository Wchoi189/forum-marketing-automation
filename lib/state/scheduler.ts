/**
 * lib/state/scheduler.ts
 *
 * Unified scheduler state management.
 * Delegates to the authoritative reactive RuntimeStateStore.
 */

import type { SchedulerControls, StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';
import { getRuntimeStateStore } from './store.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SCHEDULER_CONTROLS: SchedulerControls = {
  enabled: true,
  baseIntervalMinutes: 60,
  quietHoursStart: 0,
  quietHoursEnd: 6,
  quietHoursMultiplier: 2.0,
  activeHoursStart: 9,
  activeHoursEnd: 22,
  activeHoursMultiplier: 1.0,
  trendAdaptiveEnabled: true,
  trendWindowDays: 7,
  trendRecalibrationDays: 3,
  scheduleJitterPercent: 10,
  scheduleJitterMode: 'uniform',
  targetPublishIntervalMinutes: 120,
  gapRecheckIntervalMinutes: 3,
  preset: 'balanced',
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Read scheduler controls from store authority.
 */
export async function readPersistedSchedulerControls(): Promise<Partial<SchedulerControls>> {
  const store = getRuntimeStateStore();
  await store.ensureInitialized();
  return store.getSchedulerControls();
}

/**
 * Persist scheduler controls.
 */
export async function persistSchedulerControls(controls: Partial<SchedulerControls>, expectedVersion?: number): Promise<StateMeta> {
  return persistState({
    schedulerEnabled: controls.enabled,
    schedulerBaseIntervalMinutes: controls.baseIntervalMinutes,
    schedulerQuietHoursStart: controls.quietHoursStart,
    schedulerQuietHoursEnd: controls.quietHoursEnd,
    schedulerQuietHoursMultiplier: controls.quietHoursMultiplier,
    schedulerActiveHoursStart: controls.activeHoursStart,
    schedulerActiveHoursEnd: controls.activeHoursEnd,
    schedulerActiveHoursMultiplier: controls.activeHoursMultiplier,
    schedulerTrendAdaptiveEnabled: controls.trendAdaptiveEnabled,
    schedulerTrendWindowDays: controls.trendWindowDays,
    schedulerTrendRecalibrationDays: controls.trendRecalibrationDays,
    schedulerJitterPercent: controls.scheduleJitterPercent,
    schedulerJitterMode: controls.scheduleJitterMode,
    schedulerTargetPublishIntervalMinutes: controls.targetPublishIntervalMinutes,
    schedulerGapRecheckIntervalMinutes: controls.gapRecheckIntervalMinutes,
    preset: controls.preset,
  }, expectedVersion);
}

// Re-export type for convenience
export type { SchedulerControls };