/**
 * lib/scheduler/run.ts
 *
 * Main scheduler orchestration for automated publishing.
 * Import through lib/scheduler/index.ts, not directly.
 */

import { clamp } from '../utils.js';
import { applyScheduleJitter } from '../scheduleJitter.js';
import {
  computeTurnoverAnalysis,
  trendMultiplierFromAvgRate,
  computeShareOfVoice,
  shareOfVoiceMultiplierFromSoV,
  COMBINED_MULTIPLIER_MIN,
  COMBINED_MULTIPLIER_MAX,
} from '../trendInsights.js';
import { summarizeSchedulerSignals } from '../schedulerSignals.js';
import { logger, LOG_EVENT } from '../logging/index.js';
import { ENV } from '../../config/env.js';

import { PRESET_CONFIG, isHourInRange, normalizeAutoPublisherControls } from './presets.js';
import type { AutoPublisherControls, ControlPanelPreset, BotDeps } from './types.js';

export function startScheduler(
  deps: BotDeps,
  intervalMinutes: number = ENV.RUN_INTERVAL_MINUTES,
  persistedState?: Partial<AutoPublisherControls & { enabled: boolean; preset: string }>
) {
  const resolvedPreset =
    persistedState?.preset && PRESET_CONFIG[persistedState.preset as ControlPanelPreset]
      ? (persistedState.preset as ControlPanelPreset)
      : 'balanced';
  let preset: ControlPanelPreset = resolvedPreset;
  const baseDefaults: AutoPublisherControls = {
    enabled: persistedState?.enabled ?? true,
    baseIntervalMinutes: Math.max(1, persistedState?.baseIntervalMinutes ?? intervalMinutes),
    quietHoursStart: persistedState?.quietHoursStart ?? 3,
    quietHoursEnd: persistedState?.quietHoursEnd ?? 5,
    quietHoursMultiplier: persistedState?.quietHoursMultiplier ?? 1.8,
    activeHoursStart: persistedState?.activeHoursStart ?? 8,
    activeHoursEnd: persistedState?.activeHoursEnd ?? 23,
    activeHoursMultiplier: persistedState?.activeHoursMultiplier ?? 0.8,
    trendAdaptiveEnabled: persistedState?.trendAdaptiveEnabled ?? true,
    trendWindowDays: persistedState?.trendWindowDays ?? 7,
    trendRecalibrationDays: persistedState?.trendRecalibrationDays ?? 7,
    scheduleJitterPercent: persistedState?.scheduleJitterPercent ?? ENV.SCHEDULER_JITTER_PERCENT,
    scheduleJitterMode: persistedState?.scheduleJitterMode ?? ENV.SCHEDULER_JITTER_MODE,
    targetPublishIntervalMinutes: persistedState?.targetPublishIntervalMinutes ?? 0,
    gapRecheckIntervalMinutes: persistedState?.gapRecheckIntervalMinutes ?? 3,
  };
  let controls = normalizeAutoPublisherControls(baseDefaults);
  let timer: NodeJS.Timeout | null = null;
  let enabled = baseDefaults.enabled;
  let running = false;
  let nextTickEta: string | null = null;
  let lastTrendRecalculatedAt = 0;
  let trendFactor = 1;
  let lastObserverResult: { status: string; currentGap: number; requiredGap: number; checkedAt: string } | null = null;

  const recalcTrendFactor = async (): Promise<number> => {
    if (!controls.trendAdaptiveEnabled) {
      trendFactor = 1;
      return 1;
    }
    const now = Date.now();
    const minAgeMs = controls.trendRecalibrationDays * 24 * 60 * 60 * 1000;
    if (lastTrendRecalculatedAt > 0 && now - lastTrendRecalculatedAt < minAgeMs) {
      return trendFactor;
    }

    const logs = await deps.getLogs();
    const analysis = computeTurnoverAnalysis(logs, controls.trendWindowDays);

    if (analysis.recentSnapshotCount < 3 || analysis.pairSampleCount < 3) {
      trendFactor = 1;
      lastTrendRecalculatedAt = now;
      return trendFactor;
    }

    trendFactor = trendMultiplierFromAvgRate(analysis.avgNewPostsPerHour);

    let sovFactor = 1;
    try {
      const sovPercent = computeShareOfVoice(logs, controls.trendWindowDays, ENV.OUR_AUTHOR_SUBSTRING);
      sovFactor = shareOfVoiceMultiplierFromSoV(sovPercent);
    } catch (err) {
      logger.warn({ event: 'scheduler_sov_fallback', err }, '[Scheduler] SoV computation failed; using sovFactor=1');
    }
    trendFactor = Math.max(COMBINED_MULTIPLIER_MIN, Math.min(COMBINED_MULTIPLIER_MAX, trendFactor * sovFactor));

    if (deps.getPublisherHistory) {
      try {
        const historyLimit = Math.max(40, Math.min(200, controls.trendWindowDays * 24));
        const history = await deps.getPublisherHistory(historyLimit);
        const signalSummary = summarizeSchedulerSignals(history, {
          windowDays: controls.trendWindowDays,
          nowMs: now,
        });
        trendFactor = Math.max(
          COMBINED_MULTIPLIER_MIN,
          Math.min(COMBINED_MULTIPLIER_MAX, trendFactor * signalSummary.isolatedMultiplier)
        );
        logger.info(
          {
            event: 'scheduler_signal_isolation_applied',
            opportunityMultiplier: signalSummary.isolatedMultiplier,
            opportunityScore: signalSummary.opportunityScore,
            totalSignals: signalSummary.totalSignalCount,
            eligibleSignals: signalSummary.adaptationEligibleCount,
            gapRechecks: signalSummary.gapRecheckCount,
            publishAttempts: signalSummary.publishAttemptCount,
            publishSuccesses: signalSummary.publishSuccessCount,
            publishFailures: signalSummary.publishFailureCount,
            reason: signalSummary.reason,
          },
          '[Scheduler] Applied isolated opportunity signal multiplier'
        );
      } catch (err) {
        logger.warn(
          { event: 'scheduler_signal_isolation_fallback', err },
          '[Scheduler] Failed to load opportunity signals; using trend+SoV factors only'
        );
      }
    }

    lastTrendRecalculatedAt = now;
    return trendFactor;
  };

  const computeEffectiveIntervalMinutes = async (): Promise<number> => {
    const hour = new Date().getHours();
    let multiplier = 1;
    if (isHourInRange(hour, controls.quietHoursStart, controls.quietHoursEnd)) {
      multiplier *= controls.quietHoursMultiplier;
    }
    if (isHourInRange(hour, controls.activeHoursStart, controls.activeHoursEnd)) {
      multiplier *= controls.activeHoursMultiplier;
    }
    multiplier *= await recalcTrendFactor();
    let effective = clamp(controls.baseIntervalMinutes * multiplier, 1, 1440);
    if (controls.targetPublishIntervalMinutes > 0) {
      const t = controls.targetPublishIntervalMinutes;
      effective = clamp(Math.round(effective * 0.5 + t * 0.5), 1, 1440);
    }
    return effective;
  };

  // Dynamic gap recheck intervals based on how close the gap is to becoming safe
  const PUBLISHER_FAIL_RECHECK_INTERVAL = 5; // 5 minutes after a failed publish attempt when gap was safe

  const tick = async (): Promise<{ currentGap: number; requiredGap: number } | false | undefined> => {
    if (!enabled) {
      return false;
    }
    if (running) {
      logger.warn(
        { event: LOG_EVENT.schedulerTickSkipped, status: 'skip', reason: 'already_running' },
        '[Scheduler] Tick skipped because previous run is still active.'
      );
      return false;
    }

    running = true;
    const tickStartedAt = Date.now();
    let wasGapSkip = false;
    let wasSuccessPublish = false;
    let wasPublisherFailGapSafe = false;
    let gapInfo: { currentGap: number; requiredGap: number } | undefined = undefined;
    try {
      logger.info({ event: LOG_EVENT.schedulerTickStarted }, '[Scheduler] Tick started');
      const result = await deps.runPublisher(false);
      wasGapSkip = result.decision === 'gap_policy';
      if (wasGapSkip) {
        gapInfo = result.gapInfo;
      } else if (result.decision === 'published_verified' || result.decision === 'dry_run') {
        wasSuccessPublish = true;
        gapInfo = result.gapInfo; // { currentGap: 0, requiredGap: N }
      } else if (result.gapInfo) {
        // Publisher failed but the gap was already safe — retry sooner than the full interval
        wasPublisherFailGapSafe = true;
        gapInfo = result.gapInfo;
      }
      if (result.log) {
        lastObserverResult = {
          status: result.log.status,
          currentGap: result.log.current_gap_count,
          requiredGap: result.log.gap_threshold_min ?? gapInfo?.requiredGap ?? 0,
          checkedAt: result.log.timestamp,
        };
      }
    } catch (error: any) {
      logger.error(
        { event: LOG_EVENT.schedulerTickFailed, status: 'error', error: String(error?.message ?? error) },
        '[Scheduler] Tick failed'
      );
    } finally {
      logger.info(
        { event: LOG_EVENT.schedulerTickFinished, status: 'ok', durationMs: Date.now() - tickStartedAt },
        '[Scheduler] Tick finished'
      );
      running = false;
    }

    // After a successful publish, enter gap-recheck mode immediately so the gap
    // never grows unchecked for a full interval before the next post.
    if (wasGapSkip || wasSuccessPublish || wasPublisherFailGapSafe) {
      return gapInfo;
    }
    return false;
  };

  const scheduleNext = async (fromGapSkip: boolean | { currentGap: number; requiredGap: number } = false) => {
    if (timer) {
      clearTimeout(timer);
    }
    let nextMinutes: number;
    let baseMinutes: number;

    if (fromGapSkip && typeof fromGapSkip === 'object') {
      // Gap is not yet safe but we have gap information - use dynamic interval based on how close we are
      const gapDiff = fromGapSkip.requiredGap - fromGapSkip.currentGap;
      if (gapDiff <= 0) {
        // Gap was already safe but publish failed — retry in 5 minutes to avoid hammering on persistent errors
        baseMinutes = PUBLISHER_FAIL_RECHECK_INTERVAL;
        nextMinutes = PUBLISHER_FAIL_RECHECK_INTERVAL;
      } else {
        baseMinutes = controls.gapRecheckIntervalMinutes;
        nextMinutes = controls.gapRecheckIntervalMinutes;
      }
    } else if (fromGapSkip) {
      // Gap is not yet safe — re-check soon rather than waiting the full interval.
      baseMinutes = controls.gapRecheckIntervalMinutes;
      nextMinutes = controls.gapRecheckIntervalMinutes;
    } else {
      baseMinutes = await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes);
      nextMinutes = applyScheduleJitter(
        baseMinutes,
        controls.scheduleJitterPercent,
        controls.scheduleJitterMode,
        Math.random
      );
    }
    nextTickEta = new Date(Date.now() + nextMinutes * 60 * 1000).toISOString();
    logger.info(
      {
        event: LOG_EVENT.schedulerNextScheduled,
        nextMinutes,
        baseMinutes,
        jitterPercent: fromGapSkip ? 0 : controls.scheduleJitterPercent,
        jitterMode: fromGapSkip ? 'none' : controls.scheduleJitterMode,
        reason: fromGapSkip ? 'gap_recheck' : 'normal',
      },
      fromGapSkip
        ? `[Scheduler] Gap not safe — re-checking in ${nextMinutes} minute(s) (current=${typeof fromGapSkip === 'object' ? fromGapSkip.currentGap : 'unknown'}, required=${typeof fromGapSkip === 'object' ? fromGapSkip.requiredGap : 'unknown'})`
        : '[Scheduler] Next tick scheduled'
    );
    timer = setTimeout(() => {
      void (async () => {
        nextTickEta = null;
        const gapSkip = await tick();
        await scheduleNext(gapSkip);
      })();
    }, nextMinutes * 60 * 1000);
  };

  // Fire an initial tick shortly after startup so the publisher doesn't sit idle for
  // a full interval after every server restart. In dev mode we wait longer so Vite
  // finishes booting before Playwright launches.
  const STARTUP_TICK_DELAY_MS = ENV.IS_DEV ? 30_000 : 10_000;
  nextTickEta = new Date(Date.now() + STARTUP_TICK_DELAY_MS).toISOString();
  timer = setTimeout(() => {
    void (async () => {
      nextTickEta = null;
      const gapSkip = await tick();
      await scheduleNext(gapSkip ?? false);
    })();
  }, STARTUP_TICK_DELAY_MS);

  logger.info(
    {
      event: LOG_EVENT.schedulerStarted,
      baseIntervalMinutes: controls.baseIntervalMinutes,
      startupTickDelayMs: STARTUP_TICK_DELAY_MS,
    },
    `[Scheduler] Started — first tick in ${STARTUP_TICK_DELAY_MS / 1000}s, then every ${controls.baseIntervalMinutes} minute(s).`
  );

  return {
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    runNow: tick,
    setEnabled: (nextEnabled: boolean) => {
      enabled = nextEnabled;
    },
    setIntervalMinutes: (nextIntervalMinutes: number) => {
      controls = normalizeAutoPublisherControls(controls, { baseIntervalMinutes: nextIntervalMinutes });
      void scheduleNext(false);
    },
    setControls: (patch: Partial<AutoPublisherControls>) => {
      controls = normalizeAutoPublisherControls(controls, patch);
      if (controls.trendAdaptiveEnabled === false) {
        trendFactor = 1;
      }
      void scheduleNext(false);
    },
    setPreset: (nextPreset: ControlPanelPreset) => {
      preset = nextPreset;
    },
    getPreset: () => preset,
    applyPreset: (nextPreset: ControlPanelPreset) => {
      preset = nextPreset;
      controls = normalizeAutoPublisherControls(controls, PRESET_CONFIG[nextPreset].autoPublisher);
      void scheduleNext(false);
    },
    getState: async () => ({
      ...controls,
      enabled,
      effectiveIntervalMinutes: await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes),
      running,
      nextTickEta: enabled ? nextTickEta : null,
      lastObserverResult,
    }),
  };
}
