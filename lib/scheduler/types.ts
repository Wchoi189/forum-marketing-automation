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
 * The pacing fields a preset governs.
 *
 * Total, not partial: a preset used to omit `gapRecheckIntervalMinutes`, so switching
 * presets inherited whatever the previous one happened to leave behind. Requiring
 * every field makes preset selection deterministic.
 *
 * `enabled` is excluded on purpose - it is the operator's kill-switch, and choosing a
 * pacing profile must never restart a scheduler the operator stopped.
 */
export type PresetAutoPublisherControls = Required<Omit<AutoPublisherControls, 'enabled'>>;

/**
 * Preset configuration for observer and publisher controls.
 */
export type PresetConfig = {
  observer: ObserverPacingPatch;
  autoPublisher: PresetAutoPublisherControls;
};
/**
 * Result of one scheduler tick. This is the sole input `nextAttemptAt` reads about
 * what just happened, so every publisher decision must map onto exactly one variant.
 */
export type SchedulerTickOutcome =
  | { type: 'rate_limited'; remainingMinutes: number }
  | { type: 'system_maintenance'; remainingMinutes: number }
  | { type: 'gap_skip'; gapInfo?: { currentGap: number; requiredGap: number } }
  | { type: 'success'; cooldownApplies: boolean; gapInfo?: { currentGap: number; requiredGap: number } }
  | { type: 'already_running' }
  | { type: 'unexpected_error'; consecutiveFailures: number }
  | { type: 'normal' };
