/**
 * lib/analytics/schedulerDiagnostics.ts
 *
 * Calibration view over the scheduler signal timeline: how often the
 * opportunity multiplier lands on its bounds, and whether those bounds should
 * move. Reads publisher history through the loader it is handed, so the caller
 * decides where history comes from and nothing here touches Express.
 *
 * Behind GET /api/scheduler-signals and embedded in GET /api/trend-insights.
 */

import type { PublisherHistoryEntry, SchedulerSignalDiagnostics } from '../../contracts/models.js';
import {
  OPPORTUNITY_MULTIPLIER_MAX,
  OPPORTUNITY_MULTIPLIER_MIN,
  buildSchedulerAdaptationWindows,
  buildSchedulerSignalTimeline,
  summarizeSchedulerSignals,
} from './schedulerSignals.js';

export interface SchedulerDiagnosticsOptions {
  windowDays: number;
  windowSize: number;
  historyLimit: number;
  nowMs?: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedP = Math.max(0, Math.min(1, p));
  const idx = (sorted.length - 1) * clampedP;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return Number(sorted[lower].toFixed(3));
  const blended = sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  return Number(blended.toFixed(3));
}

function buildCalibrationSummary(
  isolatedMultipliers: number[]
): SchedulerSignalDiagnostics['calibration'] {
  const safe = isolatedMultipliers.length > 0 ? isolatedMultipliers : [1];
  const minObserved = Number(Math.min(...safe).toFixed(3));
  const maxObserved = Number(Math.max(...safe).toFixed(3));
  const lowerBoundHits = safe.filter((value) => value <= OPPORTUNITY_MULTIPLIER_MIN + Number.EPSILON).length;
  const upperBoundHits = safe.filter((value) => value >= OPPORTUNITY_MULTIPLIER_MAX - Number.EPSILON).length;
  const boundHits = lowerBoundHits + upperBoundHits;
  const boundHitRate = Number((boundHits / safe.length).toFixed(3));
  const lowerBoundHitRate = Number((lowerBoundHits / safe.length).toFixed(3));
  const upperBoundHitRate = Number((upperBoundHits / safe.length).toFixed(3));

  const p10 = percentile(safe, 0.1);
  const p50 = percentile(safe, 0.5);
  const p90 = percentile(safe, 0.9);

  const candidateMin = Number(Math.max(0.75, p10 - 0.02).toFixed(2));
  const candidateMax = Number(Math.min(1.25, p90 + 0.02).toFixed(2));

  let suggestedMinBound = OPPORTUNITY_MULTIPLIER_MIN;
  let suggestedMaxBound = OPPORTUNITY_MULTIPLIER_MAX;

  if (lowerBoundHitRate >= 0.12 || upperBoundHitRate >= 0.12) {
    suggestedMinBound = lowerBoundHitRate >= 0.12 ? candidateMin : OPPORTUNITY_MULTIPLIER_MIN;
    suggestedMaxBound = upperBoundHitRate >= 0.12 ? candidateMax : OPPORTUNITY_MULTIPLIER_MAX;
  } else if (
    boundHitRate === 0 &&
    candidateMin > OPPORTUNITY_MULTIPLIER_MIN &&
    candidateMax < OPPORTUNITY_MULTIPLIER_MAX
  ) {
    suggestedMinBound = candidateMin;
    suggestedMaxBound = candidateMax;
  }

  const recommendation: SchedulerSignalDiagnostics['calibration']['recommendation'] =
    lowerBoundHitRate >= 0.12 || upperBoundHitRate >= 0.12
      ? 'widen_bounds'
      : boundHitRate === 0 && candidateMin > OPPORTUNITY_MULTIPLIER_MIN && candidateMax < OPPORTUNITY_MULTIPLIER_MAX
        ? 'tighten_bounds'
        : 'hold_bounds';

  return {
    isolatedMultiplierP10: p10,
    isolatedMultiplierP50: p50,
    isolatedMultiplierP90: p90,
    isolatedMultiplierMin: minObserved,
    isolatedMultiplierMax: maxObserved,
    isolatedBoundHitRate: boundHitRate,
    suggestedMinBound,
    suggestedMaxBound,
    recommendation,
  };
}

export async function buildSchedulerSignalDiagnostics(
  getPublisherHistory: (limit: number) => Promise<PublisherHistoryEntry[]>,
  options: SchedulerDiagnosticsOptions
): Promise<SchedulerSignalDiagnostics> {
  const nowMs = options.nowMs ?? Date.now();
  const history = await getPublisherHistory(options.historyLimit);
  const timeline = buildSchedulerSignalTimeline(history, {
    windowDays: options.windowDays,
    nowMs,
  });
  const windows = buildSchedulerAdaptationWindows(timeline, options.windowSize);
  const summary = summarizeSchedulerSignals(history, {
    windowDays: options.windowDays,
    nowMs,
  });

  const isolatedForCalibration =
    windows.length > 0 ? windows.map((window) => window.isolatedMultiplier) : [summary.isolatedMultiplier];

  const latestWindow = windows.length > 0 ? windows[windows.length - 1] : null;

  return {
    sampledAt: new Date(nowMs).toISOString(),
    windowDays: options.windowDays,
    windowSize: options.windowSize,
    historyLimit: options.historyLimit,
    inputEventCount: history.length,
    timelineEventCount: timeline.length,
    adaptationWindowCount: windows.length,
    summary,
    latestWindow: latestWindow
      ? {
          windowIndex: latestWindow.windowIndex,
          startAt: latestWindow.startAt,
          endAt: latestWindow.endAt,
          deltaFromBaseline: latestWindow.deltaFromBaseline,
          isolatedMultiplier: latestWindow.isolatedMultiplier,
          baselineMultiplier: latestWindow.baselineMultiplier,
          opportunityScore: latestWindow.opportunityScore,
          reason: latestWindow.reason,
        }
      : null,
    calibration: buildCalibrationSummary(isolatedForCalibration),
  };
}
