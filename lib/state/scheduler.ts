/**
 * lib/state/scheduler.ts
 *
 * Unified scheduler state management.
 * Handles persistence of scheduler controls and presets.
 */

import type { SchedulerControls, StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';

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
 * Read persisted scheduler controls.
 */
export async function readPersistedSchedulerControls(): Promise<Partial<SchedulerControls>> {
  const data = await readPersistedState();
  const result: Partial<SchedulerControls> = {};

  if (typeof data.schedulerEnabled === 'boolean') result.enabled = data.schedulerEnabled;
  if (typeof data.schedulerBaseIntervalMinutes === 'number') result.baseIntervalMinutes = Math.max(1, Math.min(1440, data.schedulerBaseIntervalMinutes));
  if (typeof data.schedulerQuietHoursStart === 'number') result.quietHoursStart = Math.max(0, Math.min(23, data.schedulerQuietHoursStart));
  if (typeof data.schedulerQuietHoursEnd === 'number') result.quietHoursEnd = Math.max(0, Math.min(23, data.schedulerQuietHoursEnd));
  if (typeof data.schedulerQuietHoursMultiplier === 'number') result.quietHoursMultiplier = Math.max(0.2, Math.min(5, data.schedulerQuietHoursMultiplier));
  if (typeof data.schedulerActiveHoursStart === 'number') result.activeHoursStart = Math.max(0, Math.min(23, data.schedulerActiveHoursStart));
  if (typeof data.schedulerActiveHoursEnd === 'number') result.activeHoursEnd = Math.max(0, Math.min(23, data.schedulerActiveHoursEnd));
  if (typeof data.schedulerActiveHoursMultiplier === 'number') result.activeHoursMultiplier = Math.max(0.2, Math.min(5, data.schedulerActiveHoursMultiplier));
  if (typeof data.schedulerTrendAdaptiveEnabled === 'boolean') result.trendAdaptiveEnabled = data.schedulerTrendAdaptiveEnabled;
  if (typeof data.schedulerTrendWindowDays === 'number') result.trendWindowDays = Math.max(1, Math.min(60, data.schedulerTrendWindowDays));
  if (typeof data.schedulerTrendRecalibrationDays === 'number') result.trendRecalibrationDays = Math.max(1, Math.min(30, data.schedulerTrendRecalibrationDays));
  if (typeof data.schedulerJitterPercent === 'number') result.scheduleJitterPercent = Math.max(0, Math.min(50, data.schedulerJitterPercent));
  if (typeof data.schedulerJitterMode === 'string') result.scheduleJitterMode = data.schedulerJitterMode === 'none' ? 'none' : 'uniform';
  if (typeof data.schedulerTargetPublishIntervalMinutes === 'number') result.targetPublishIntervalMinutes = Math.max(0, Math.min(1440, data.schedulerTargetPublishIntervalMinutes));
  if (typeof data.schedulerGapRecheckIntervalMinutes === 'number') result.gapRecheckIntervalMinutes = Math.max(1, Math.min(60, data.schedulerGapRecheckIntervalMinutes));
  if (typeof data.preset === 'string') result.preset = data.preset;

  return result;
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