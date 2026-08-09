/**
 * lib/state/controlPanel.ts
 *
 * Whole-panel persistence. The control panel saves every section in one
 * optimistic-concurrency write so a partial failure cannot leave scheduler,
 * observer, and publisher state disagreeing on disk.
 */

import type { StateMeta } from './types.js';
import { persistState } from './persistence.js';

export type ControlPanelPersistInput = {
  expectedVersion?: number;
  gapPersistedOverride?: number | null;
  gapSourcePin?: 'env' | 'spec' | null;
  nlWebhookEnabled?: boolean;
  customParserEnabled?: boolean;
  browserRequestLogging?: boolean;
  logLevel?: string;
  parserDetailedLogging?: boolean;
  schedulerEnabled: boolean;
  schedulerControls: {
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
    scheduleJitterMode: string;
    targetPublishIntervalMinutes: number;
    gapRecheckIntervalMinutes: number;
  };
  preset: string;
  observerControls: {
    enabled: boolean;
    minPreVisitDelayMs: number;
    maxPreVisitDelayMs: number;
    minIntervalBetweenRunsMs: number;
  };
  publisherControls: {
    draftItemIndex: number;
  };
};

/**
 * Persist every control panel section in a single versioned write.
 * Throws StateVersionConflictError when `expectedVersion` does not match disk.
 */
export async function persistAllControlPanelSettings(opts: ControlPanelPersistInput): Promise<StateMeta> {
  return persistState({
    schedulerEnabled: opts.schedulerEnabled,
    schedulerBaseIntervalMinutes: opts.schedulerControls.baseIntervalMinutes,
    schedulerQuietHoursStart: opts.schedulerControls.quietHoursStart,
    schedulerQuietHoursEnd: opts.schedulerControls.quietHoursEnd,
    schedulerQuietHoursMultiplier: opts.schedulerControls.quietHoursMultiplier,
    schedulerActiveHoursStart: opts.schedulerControls.activeHoursStart,
    schedulerActiveHoursEnd: opts.schedulerControls.activeHoursEnd,
    schedulerActiveHoursMultiplier: opts.schedulerControls.activeHoursMultiplier,
    schedulerTrendAdaptiveEnabled: opts.schedulerControls.trendAdaptiveEnabled,
    schedulerTrendWindowDays: opts.schedulerControls.trendWindowDays,
    schedulerTrendRecalibrationDays: opts.schedulerControls.trendRecalibrationDays,
    schedulerJitterPercent: opts.schedulerControls.scheduleJitterPercent,
    schedulerJitterMode: opts.schedulerControls.scheduleJitterMode,
    schedulerTargetPublishIntervalMinutes: opts.schedulerControls.targetPublishIntervalMinutes,
    schedulerGapRecheckIntervalMinutes: opts.schedulerControls.gapRecheckIntervalMinutes,
    preset: opts.preset,
    observerEnabled: opts.observerControls.enabled,
    observerMinPreVisitDelayMs: opts.observerControls.minPreVisitDelayMs,
    observerMaxPreVisitDelayMs: opts.observerControls.maxPreVisitDelayMs,
    observerMinIntervalBetweenRunsMs: opts.observerControls.minIntervalBetweenRunsMs,
    publisherDraftItemIndex: opts.publisherControls.draftItemIndex,
    observerGapThresholdMin: opts.gapPersistedOverride ?? undefined,
    gapSourcePin: opts.gapSourcePin ?? undefined,
    nlWebhookEnabled: opts.nlWebhookEnabled,
    customParserEnabled: opts.customParserEnabled,
    browserRequestLogging: opts.browserRequestLogging,
    logLevel: opts.logLevel,
    parserDetailedLogging: opts.parserDetailedLogging,
  }, opts.expectedVersion);
}
