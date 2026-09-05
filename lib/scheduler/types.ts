/**
 * lib/scheduler/types.ts
 *
 * Type definitions for the scheduler module.
 */

import type { ActivityLog, PublisherHistoryEntry } from '../../contracts/models.js';
import type { PublisherRunResult } from '../publisher/index.js';
import type { ScheduleJitterMode } from '../scheduleJitter.js';

/**
 * Dependencies injected into the scheduler for observer/publisher runs.
 */
export type BotDeps = {
  runObserver: () => Promise<ActivityLog>;
  runPublisher: (force?: boolean) => Promise<PublisherRunResult>;
  getLogs: () => Promise<ActivityLog[]>;
  getPublisherHistory?: (limit: number) => Promise<PublisherHistoryEntry[]>;
};

/**
 * Available scheduler presets.
 */
export type ControlPanelPreset = 'balanced' | 'night-safe' | 'day-aggressive';

/**
 * Scheduler controls for automated publishing.
 */
export type AutoPublisherControls = {
  enabled: boolean;
  baseIntervalMinutes: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  quietHoursMultiplier: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  activeHoursMultiplier: number;
  trendAdaptiveEnabled: boolean;
  trendWindowDays: number;
  trendRecalibrationDays: number;
  scheduleJitterPercent: number;
  scheduleJitterMode: ScheduleJitterMode;
  targetPublishIntervalMinutes: number;
  gapRecheckIntervalMinutes: number;
};

/**
 * Observer pacing subset used by presets.
 */
export type ObserverPacingPatch = {
  enabled?: boolean;
  minPreVisitDelayMs?: number;
  maxPreVisitDelayMs?: number;
  minIntervalBetweenRunsMs?: number;
};

/**
 * Preset configuration for observer and publisher controls.
 */
export type PresetConfig = {
  observer: ObserverPacingPatch;
  autoPublisher: Partial<AutoPublisherControls>;
};