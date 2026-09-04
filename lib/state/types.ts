/**
 * lib/state/types.ts
 *
 * Shared type definitions for runtime state.
 * Single source of truth for state shapes used across in-memory and persistence layers.
 */

/**
 * Observer pacing controls.
 * Controls the delay and interval behavior for board observation runs.
 */
export type ObserverControls = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
};

/**
 * Observer controls with resolved gap policy metadata.
 * Used by control panel API to show current gap threshold state.
 */
export type ObserverControlsWithGap = ObserverControls & {
  gapThresholdMin: number;
  gapPersistedOverride: number | null;
  gapThresholdSpecBaseline: number;
  gapUsesEnvOverride: boolean;
  gapSource: 'file' | 'env' | 'spec';
  gapSourcePin: 'env' | 'spec' | null;
};

/**
 * Publisher runtime controls.
 * Controls draft selection and rate limit backoff state.
 */
export type PublisherControls = {
  /** 1-based saved-draft item row. */
  draftItemIndex: number;
  /** ISO timestamp when publishing is allowed again after rate limit. */
  publishBlockedUntil: string | null;
  /** ISO timestamp when publishing is allowed again after platform maintenance. */
  maintenanceBlockedUntil: string | null;
};

/**
 * Scheduler controls for automated publishing.
 * Controls interval timing, quiet hours, and adaptive behavior.
 */
export type SchedulerControls = {
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
  scheduleJitterMode: 'uniform' | 'none';
  targetPublishIntervalMinutes: number;
  gapRecheckIntervalMinutes: number;
  preset: string;
};

/**
 * State version metadata for optimistic concurrency control.
 */
export type StateMeta = {
  stateVersion: number;
  persistedAt: string | null;
};

/**
 * Error thrown when state version conflicts during optimistic update.
 */
export class StateVersionConflictError extends Error {
  readonly code = 'STATE_VERSION_CONFLICT';
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(expectedVersion: number, currentVersion: number) {
    super(`Expected state version ${expectedVersion}, found ${currentVersion}`);
    this.name = 'StateVersionConflictError';
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}