/**
 * lib/scheduler/presets.ts
 *
 * Preset configurations for scheduler behavior.
 */

import { ENV } from '../../config/env.js';
import type { ControlPanelPreset, PresetConfig, AutoPublisherControls } from './types.js';

/**
 * Preset configurations for different operating modes.
 */
export const PRESET_CONFIG: Record<ControlPanelPreset, PresetConfig> = {
  balanced: {
    observer: {
      enabled: true,
      minPreVisitDelayMs: 2000,
      maxPreVisitDelayMs: 7000,
      minIntervalBetweenRunsMs: 30000,
    },
    autoPublisher: {
      baseIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
      quietHoursStart: 3,
      quietHoursEnd: 5,
      quietHoursMultiplier: 1.8,
      activeHoursStart: 8,
      activeHoursEnd: 23,
      activeHoursMultiplier: 0.8,
      trendAdaptiveEnabled: true,
      trendWindowDays: 7,
      trendRecalibrationDays: 7,
      scheduleJitterPercent: ENV.SCHEDULER_JITTER_PERCENT,
      scheduleJitterMode: ENV.SCHEDULER_JITTER_MODE,
      targetPublishIntervalMinutes: 0,
    },
  },
  'night-safe': {
    observer: {
      enabled: true,
      minPreVisitDelayMs: 5000,
      maxPreVisitDelayMs: 12000,
      minIntervalBetweenRunsMs: 60000,
    },
    autoPublisher: {
      baseIntervalMinutes: Math.max(45, ENV.RUN_INTERVAL_MINUTES),
      quietHoursStart: 2,
      quietHoursEnd: 6,
      quietHoursMultiplier: 2.2,
      activeHoursStart: 9,
      activeHoursEnd: 22,
      activeHoursMultiplier: 0.9,
      trendAdaptiveEnabled: true,
      trendWindowDays: 14,
      trendRecalibrationDays: 14,
      scheduleJitterPercent: ENV.SCHEDULER_JITTER_PERCENT,
      scheduleJitterMode: ENV.SCHEDULER_JITTER_MODE,
      targetPublishIntervalMinutes: 0,
    },
  },
  'day-aggressive': {
    observer: {
      enabled: true,
      minPreVisitDelayMs: 1000,
      maxPreVisitDelayMs: 4000,
      minIntervalBetweenRunsMs: 15000,
    },
    autoPublisher: {
      baseIntervalMinutes: Math.max(20, Math.round(ENV.RUN_INTERVAL_MINUTES * 0.7)),
      quietHoursStart: 3,
      quietHoursEnd: 5,
      quietHoursMultiplier: 1.6,
      activeHoursStart: 9,
      activeHoursEnd: 23,
      activeHoursMultiplier: 0.6,
      trendAdaptiveEnabled: true,
      trendWindowDays: 7,
      trendRecalibrationDays: 7,
      scheduleJitterPercent: ENV.SCHEDULER_JITTER_PERCENT,
      scheduleJitterMode: ENV.SCHEDULER_JITTER_MODE,
      targetPublishIntervalMinutes: 0,
    },
  },
};

/**
 * Check if hour falls within a time range (handles wraparound).
 */
export function isHourInRange(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Clamp a float value to a range.
 */
export function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}

/**
 * Normalize and validate auto publisher controls.
 */
export function normalizeAutoPublisherControls(
  base: AutoPublisherControls,
  patch?: Partial<AutoPublisherControls>
): AutoPublisherControls {
  const { clamp } = { clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)) };
  const merged = { ...base, ...(patch ?? {}) };
  return {
    enabled: Boolean(merged.enabled),
    baseIntervalMinutes: clamp(merged.baseIntervalMinutes, 1, 1440),
    quietHoursStart: clamp(merged.quietHoursStart, 0, 23),
    quietHoursEnd: clamp(merged.quietHoursEnd, 0, 23),
    quietHoursMultiplier: clampFloat(merged.quietHoursMultiplier, 0.2, 5),
    activeHoursStart: clamp(merged.activeHoursStart, 0, 23),
    activeHoursEnd: clamp(merged.activeHoursEnd, 0, 23),
    activeHoursMultiplier: clampFloat(merged.activeHoursMultiplier, 0.2, 5),
    trendAdaptiveEnabled: Boolean(merged.trendAdaptiveEnabled),
    trendWindowDays: clamp(merged.trendWindowDays, 1, 60),
    trendRecalibrationDays: clamp(merged.trendRecalibrationDays, 1, 30),
    scheduleJitterPercent: clamp(
      typeof merged.scheduleJitterPercent === 'number' ? merged.scheduleJitterPercent : base.scheduleJitterPercent,
      0,
      50
    ),
    scheduleJitterMode: merged.scheduleJitterMode === 'none' ? 'none' : 'uniform',
    targetPublishIntervalMinutes: clamp(
      typeof merged.targetPublishIntervalMinutes === 'number'
        ? merged.targetPublishIntervalMinutes
        : base.targetPublishIntervalMinutes,
      0,
      1440
    ),
    gapRecheckIntervalMinutes: clamp(
      typeof merged.gapRecheckIntervalMinutes === 'number'
        ? merged.gapRecheckIntervalMinutes
        : base.gapRecheckIntervalMinutes,
      1,
      60
    ),
  };
}