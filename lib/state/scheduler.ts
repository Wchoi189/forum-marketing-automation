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

/**
 * Re-exported from the single source in lib/scheduler so the store seeds a first
 * boot with exactly the values a running scheduler falls back to. Declaring a
 * second literal here is what let the two drift; tests/unit/schedulerDefaults.test.ts
 * fails if one reappears.
 */
export { DEFAULT_SCHEDULER_CONTROLS } from '../scheduler/index.js';

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