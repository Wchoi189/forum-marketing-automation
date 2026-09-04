/**
 * lib/scheduler/run.ts
 *
 * Main scheduler orchestration for automated publishing.
 * Import through lib/scheduler/index.ts, not directly.
 */

import { clamp } from '../utils.js';
import { applyScheduleJitter } from '../scheduleJitter.js';
import { computeTurnoverAnalysis, trendMultiplierFromAvgRate, computeShareOfVoice, shareOfVoiceMultiplierFromSoV, COMBINED_MULTIPLIER_MIN, COMBINED_MULTIPLIER_MAX, summarizeSchedulerSignals } from '../analytics/index.js';
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

  let consecutiveFailures = 0;
  const ERROR_BACKOFF_MINUTES = [15, 30, 60] as const;

  type SchedulerTickOutcome =
    | { type: 'rate_limited'; remainingMinutes: number }
    | { type: 'system_maintenance'; remainingMinutes: number }
    | { type: 'gap_skip'; gapInfo?: { currentGap: number; requiredGap: number } }
    | { type: 'success'; gapInfo?: { currentGap: number; requiredGap: number } }
    | { type: 'unexpected_error'; consecutiveFailures: number }
    | { type: 'normal' };

  const tick = async (): Promise<SchedulerTickOutcome | false> => {
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
    let outcome: SchedulerTickOutcome = { type: 'normal' };
    try {
      logger.info({ event: LOG_EVENT.schedulerTickStarted }, '[Scheduler] Tick started');
      const result = await deps.runPublisher(false);

      if (result.decision === 'gap_policy') {
        consecutiveFailures = 0;
        outcome = { type: 'gap_skip', gapInfo: result.gapInfo };
      } else if (result.decision === 'published_verified' || result.decision === 'dry_run') {
        consecutiveFailures = 0;
        outcome = { type: 'success', gapInfo: result.gapInfo ?? { currentGap: 0, requiredGap: 4 } };
      } else if (result.decision === 'rate_limited') {
        // Expected rate-limit cooldown — do NOT increment consecutiveFailures
        const remaining =
          result.cooldownRemainingMinutes && result.cooldownRemainingMinutes > 0
            ? result.cooldownRemainingMinutes
            : 60;
        outcome = { type: 'rate_limited', remainingMinutes: remaining };
      } else if (result.decision === 'system_maintenance') {
        // Expected platform maintenance pause — do NOT increment consecutiveFailures
        const remaining =
          result.maintenanceRemainingMinutes && result.maintenanceRemainingMinutes > 0
            ? result.maintenanceRemainingMinutes
            : 30;
        outcome = { type: 'system_maintenance', remainingMinutes: remaining };
      } else if (result.decision === 'publisher_error' || result.decision === 'observer_error') {
        consecutiveFailures += 1;
        outcome = { type: 'unexpected_error', consecutiveFailures };
      } else {
        outcome = { type: 'normal' };
      }

      if (result.log) {
        lastObserverResult = {
          status: result.log.status,
          currentGap: result.log.current_gap_count,
          requiredGap: result.log.gap_threshold_min ?? result.gapInfo?.requiredGap ?? 0,
          checkedAt: result.log.timestamp,
        };
      }
    } catch (error: any) {
      consecutiveFailures += 1;
      outcome = { type: 'unexpected_error', consecutiveFailures };
      logger.error(
        { event: LOG_EVENT.schedulerTickFailed, status: 'error', consecutiveFailures, error: String(error?.message ?? error) },
        '[Scheduler] Tick failed'
      );
    } finally {
      logger.info(
        { event: LOG_EVENT.schedulerTickFinished, status: 'ok', durationMs: Date.now() - tickStartedAt },
        '[Scheduler] Tick finished'
      );
      running = false;
    }

    return outcome;
  };

  const scheduleNext = async (
    outcome:
      | SchedulerTickOutcome
      | boolean
      | { currentGap: number; requiredGap: number } = false
  ) => {
    if (timer) {
      clearTimeout(timer);
    }
    let nextMinutes: number;
    let baseMinutes: number;
    let reason: string = 'normal';

    if (outcome && typeof outcome === 'object' && 'type' in outcome) {
      if (outcome.type === 'rate_limited') {
        const remaining = Math.max(1, outcome.remainingMinutes);
        baseMinutes = remaining + 1; // 1-minute buffer after cooldown
        nextMinutes = baseMinutes;
        reason = 'rate_limited_cooldown';
      } else if (outcome.type === 'system_maintenance') {
        const remaining = Math.max(1, outcome.remainingMinutes);
        baseMinutes = remaining; // Buffer already included in maintenance parser
        nextMinutes = baseMinutes;
        reason = 'system_maintenance';
      } else if (outcome.type === 'unexpected_error') {
        const idx = Math.min(outcome.consecutiveFailures - 1, ERROR_BACKOFF_MINUTES.length - 1);
        baseMinutes = ERROR_BACKOFF_MINUTES[Math.max(0, idx)] ?? 60;
        nextMinutes = baseMinutes;
        reason = 'error_backoff';
      } else if (outcome.type === 'gap_skip' || outcome.type === 'success') {
        baseMinutes = controls.gapRecheckIntervalMinutes;
        nextMinutes = controls.gapRecheckIntervalMinutes;
        reason = 'gap_recheck';
      } else {
        baseMinutes = await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes);
        nextMinutes = applyScheduleJitter(
          baseMinutes,
          controls.scheduleJitterPercent,
          controls.scheduleJitterMode,
          Math.random
        );
        reason = 'normal';
      }
    } else if (outcome && typeof outcome === 'object' && 'currentGap' in outcome) {
      baseMinutes = controls.gapRecheckIntervalMinutes;
      nextMinutes = controls.gapRecheckIntervalMinutes;
      reason = 'gap_recheck';
    } else if (outcome === true) {
      baseMinutes = controls.gapRecheckIntervalMinutes;
      nextMinutes = controls.gapRecheckIntervalMinutes;
      reason = 'gap_recheck';
    } else {
      baseMinutes = await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes);
      nextMinutes = applyScheduleJitter(
        baseMinutes,
        controls.scheduleJitterPercent,
        controls.scheduleJitterMode,
        Math.random
      );
      reason = 'normal';
    }

    nextTickEta = new Date(Date.now() + nextMinutes * 60 * 1000).toISOString();
    const isSpecialSchedule = reason !== 'normal';
    logger.info(
      {
        event: LOG_EVENT.schedulerNextScheduled,
        nextMinutes,
        baseMinutes,
        jitterPercent: isSpecialSchedule ? 0 : controls.scheduleJitterPercent,
        jitterMode: isSpecialSchedule ? 'none' : controls.scheduleJitterMode,
        reason,
      },
      reason === 'rate_limited_cooldown'
        ? `[Scheduler] Cooldown active — next tick scheduled in ${nextMinutes} minute(s) (${baseMinutes - 1}m cooldown + 1m buffer)`
        : reason === 'system_maintenance'
        ? `[Scheduler] Platform maintenance active — next tick scheduled in ${nextMinutes} minute(s) at ${nextTickEta}`
        : reason === 'error_backoff'
        ? `[Scheduler] Error backoff active (failure count=${consecutiveFailures}) — next tick scheduled in ${nextMinutes} minute(s)`
        : reason === 'gap_recheck'
        ? `[Scheduler] Gap monitoring — re-checking in ${nextMinutes} minute(s)`
        : '[Scheduler] Next tick scheduled'
    );
    timer = setTimeout(() => {
      void (async () => {
        nextTickEta = null;
        const tickOutcome = await tick();
        await scheduleNext(tickOutcome);
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
      const tickOutcome = await tick();
      await scheduleNext(tickOutcome);
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
    runNow: async () => {
      const tickOutcome = await tick();
      if (tickOutcome !== false) {
        await scheduleNext(tickOutcome);
      }
      return tickOutcome;
    },
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
      consecutiveFailures,
      nextTickEta: enabled ? nextTickEta : null,
      lastObserverResult,
    }),
  };
}
