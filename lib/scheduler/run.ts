/**
 * lib/scheduler/run.ts
 *
 * Main scheduler orchestration for automated publishing.
 * Import through lib/scheduler/index.ts, not directly.
 */

import { computeTurnoverAnalysis, trendMultiplierFromAvgRate, computeShareOfVoice, shareOfVoiceMultiplierFromSoV, summarizeSchedulerSignals } from '../analytics/index.js';
import { logger, LOG_EVENT } from '../logging/index.js';
import { ENV } from '../../config/env.js';
import { getPublisherControls, getSessionRecord, isSessionParked, isSessionProbeDue } from '../state/index.js';

import { defaultAutoPublisherControls } from './defaults.js';
import { PUBLISH_COOLDOWN_WINDOW_MINUTES } from '../publisher/index.js';

import { nextAttemptAt, BLOCK_FIELDS } from './nextAttempt.js';
import type { AttemptReason } from './nextAttempt.js';
import { PRESET_CONFIG, normalizeAutoPublisherControls } from './presets.js';
import type { AutoPublisherControls, ControlPanelPreset, BotDeps, SchedulerTickOutcome } from './types.js';

/** Multipliers feeding the adaptive branch of `nextAttemptAt`. */
type AdaptiveMultipliers = { trend: number; sov: number; opportunity: number };
const NEUTRAL_MULTIPLIERS: AdaptiveMultipliers = { trend: 1, sov: 1, opportunity: 1 };

/** Operator-facing sentence for one scheduling decision. */
function describeSchedule(
  reason: AttemptReason,
  nextMinutes: number,
  baseMinutes: number,
  nextTickEta: string,
  consecutiveFailures: number
): string {
  switch (reason) {
    case 'rate_limited_cooldown':
      return `[Scheduler] Cooldown active — next tick scheduled in ${nextMinutes} minute(s) (${baseMinutes - 1}m cooldown + 1m buffer)`;
    case 'system_maintenance':
      return `[Scheduler] Platform maintenance active — next tick scheduled in ${nextMinutes} minute(s) at ${nextTickEta}`;
    case 'error_backoff':
      return `[Scheduler] Error backoff active (failure count=${consecutiveFailures}) — next tick scheduled in ${nextMinutes} minute(s)`;
    case 'post_publish_cooldown':
      return `[Scheduler] Publish verified — next tick scheduled in ${nextMinutes} minute(s) (${PUBLISH_COOLDOWN_WINDOW_MINUTES}m platform cooldown + 1m buffer)`;
    case 'gap_recheck':
      return `[Scheduler] Gap monitoring — re-checking in ${nextMinutes} minute(s)`;
    case 'already_running':
      return `[Scheduler] A publisher run is already active — retrying in ${nextMinutes} minute(s)`;
    case 'session_required':
      return `[Scheduler] ppomppu session is dead — parked, no browser launched; re-checking in ${nextMinutes} minute(s). Log in through the session console to resume.`;
    case 'block_deadline_clamp':
      return `[Scheduler] Block deadline active — next tick scheduled at ${nextTickEta}`;
    case 'adaptive':
      return `[Scheduler] Next tick scheduled in ${nextMinutes} minute(s) at ${nextTickEta}`;
  }
}

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
  // Defaults come from the single source in ./defaults.ts. Persisted state wins for
  // every field it supplies; `intervalMinutes` is the caller's override for the base.
  const fallback = defaultAutoPublisherControls();
  const baseDefaults: AutoPublisherControls = {
    ...fallback,
    enabled: persistedState?.enabled ?? fallback.enabled,
    baseIntervalMinutes: Math.max(1, persistedState?.baseIntervalMinutes ?? intervalMinutes),
    quietHoursStart: persistedState?.quietHoursStart ?? fallback.quietHoursStart,
    quietHoursEnd: persistedState?.quietHoursEnd ?? fallback.quietHoursEnd,
    quietHoursMultiplier: persistedState?.quietHoursMultiplier ?? fallback.quietHoursMultiplier,
    activeHoursStart: persistedState?.activeHoursStart ?? fallback.activeHoursStart,
    activeHoursEnd: persistedState?.activeHoursEnd ?? fallback.activeHoursEnd,
    activeHoursMultiplier: persistedState?.activeHoursMultiplier ?? fallback.activeHoursMultiplier,
    trendAdaptiveEnabled: persistedState?.trendAdaptiveEnabled ?? fallback.trendAdaptiveEnabled,
    trendWindowDays: persistedState?.trendWindowDays ?? fallback.trendWindowDays,
    trendRecalibrationDays: persistedState?.trendRecalibrationDays ?? fallback.trendRecalibrationDays,
    scheduleJitterPercent: persistedState?.scheduleJitterPercent ?? fallback.scheduleJitterPercent,
    scheduleJitterMode: persistedState?.scheduleJitterMode ?? fallback.scheduleJitterMode,
    targetPublishIntervalMinutes: persistedState?.targetPublishIntervalMinutes ?? fallback.targetPublishIntervalMinutes,
    gapRecheckIntervalMinutes: persistedState?.gapRecheckIntervalMinutes ?? fallback.gapRecheckIntervalMinutes,
  };
  let controls = normalizeAutoPublisherControls(baseDefaults);
  let timer: NodeJS.Timeout | null = null;
  let enabled = baseDefaults.enabled;
  let running = false;
  let nextTickEta: string | null = null;
  let lastTrendRecalculatedAt = 0;
  let multipliers: AdaptiveMultipliers = { ...NEUTRAL_MULTIPLIERS };
  let lastObserverResult: { status: string; currentGap: number; requiredGap: number; checkedAt: string } | null = null;

  /**
   * Recompute the adaptive multipliers, honouring the recalibration interval.
   *
   * Returns the three factors separately rather than a single product so
   * `nextAttemptAt` can name each one in `inputsUsed`.
   */
  const recalcMultipliers = async (): Promise<AdaptiveMultipliers> => {
    if (!controls.trendAdaptiveEnabled) {
      multipliers = { ...NEUTRAL_MULTIPLIERS };
      return multipliers;
    }
    const now = Date.now();
    const minAgeMs = controls.trendRecalibrationDays * 24 * 60 * 60 * 1000;
    if (lastTrendRecalculatedAt > 0 && now - lastTrendRecalculatedAt < minAgeMs) {
      return multipliers;
    }

    const logs = await deps.getLogs();
    const analysis = computeTurnoverAnalysis(logs, controls.trendWindowDays);

    if (analysis.recentSnapshotCount < 3 || analysis.pairSampleCount < 3) {
      multipliers = { ...NEUTRAL_MULTIPLIERS };
      lastTrendRecalculatedAt = now;
      return multipliers;
    }

    const trend = trendMultiplierFromAvgRate(analysis.avgNewPostsPerHour);

    let sov = 1;
    try {
      const sovPercent = computeShareOfVoice(logs, controls.trendWindowDays, ENV.OUR_AUTHOR_SUBSTRING);
      sov = shareOfVoiceMultiplierFromSoV(sovPercent);
    } catch (err) {
      logger.warn({ event: 'scheduler_sov_fallback', err }, '[Scheduler] SoV computation failed; using sovFactor=1');
    }

    let opportunity = 1;
    if (deps.getPublisherHistory) {
      try {
        const historyLimit = Math.max(40, Math.min(200, controls.trendWindowDays * 24));
        const history = await deps.getPublisherHistory(historyLimit);
        const signalSummary = summarizeSchedulerSignals(history, {
          windowDays: controls.trendWindowDays,
          nowMs: now,
        });
        opportunity = signalSummary.isolatedMultiplier;
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

    multipliers = { trend, sov, opportunity };
    lastTrendRecalculatedAt = now;
    return multipliers;
  };

  /** Read the two block deadlines that can push a schedule later. */
  const readBlocks = (): Record<(typeof BLOCK_FIELDS)[number], string | null> => {
    const blockControls = getPublisherControls();
    return {
      publishBlockedUntil: blockControls.publishBlockedUntil ?? null,
      maintenanceBlockedUntil: blockControls.maintenanceBlockedUntil ?? null,
    };
  };

  /**
   * The interval a `normal` outcome would produce right now. Reported on the control
   * panel; it goes through `nextAttemptAt` so the number the operator sees and the
   * number the timer uses cannot drift.
   */
  const computeEffectiveIntervalMinutes = async (): Promise<number> => {
    const current = await recalcMultipliers();
    return nextAttemptAt({
      now: Date.now(),
      lastOutcome: { type: 'normal' },
      blocks: { publishBlockedUntil: null, maintenanceBlockedUntil: null },
      controls,
      multipliers: current,
    }).nextMinutes;
  };

  let consecutiveFailures = 0;

  const tick = async (): Promise<SchedulerTickOutcome | false> => {
    // SL-005: the timer keeps firing while disabled, so the expiry warning does too.
    await deps.session?.checkExpiry().catch((err) =>
      logger.warn({ event: 'scheduler_session_expiry_check_failed', err }, '[Scheduler] Session expiry check failed')
    );
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

    // SL-002: a dead session cannot be revived by the bot (KE-004). Launch nothing
    // and leave consecutiveFailures alone until an import marks it healthy.
    if (isSessionParked()) {
      return { type: 'session_lost' };
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
        // Only a verified publish starts the platform's one-post-per-hour
        // cooldown. A dry run submits nothing, so it keeps the gap-recheck pace.
        outcome = {
          type: 'success',
          cooldownApplies: result.decision === 'published_verified',
          gapInfo: result.gapInfo ?? { currentGap: 0, requiredGap: 4 },
        };
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
      } else if (result.decision === 'already_running') {
        // Benign overlap with a manual run — leave consecutiveFailures alone and
        // come back in a minute rather than entering the error backoff.
        outcome = { type: 'already_running' };
      } else if (result.decision === 'publisher_error' && isSessionParked()) {
        // This run found the session dead (PUBLISHER_LOGIN_REQUIRED): park, not backoff.
        outcome = { type: 'session_lost' };
      } else if (result.decision === 'publisher_error' || result.decision === 'observer_error') {
        consecutiveFailures += 1;
        outcome = { type: 'unexpected_error', consecutiveFailures };
      } else {
        outcome = { type: 'normal' };
      }

      // SL-004: a gap skip never reaches the board, so a session can die unseen
      // between publishes. Probe it when no run has verified it for a while.
      if (outcome.type === 'gap_skip' && deps.session && isSessionProbeDue(getSessionRecord(), Date.now())) {
        const sessionState = await deps.session.probe().catch((err) => {
          logger.warn({ event: 'scheduler_session_probe_failed', err }, '[Scheduler] Session probe failed');
          return 'unknown' as const;
        });
        if (sessionState === 'logged_out' && isSessionParked()) outcome = { type: 'session_lost' };
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

  /**
   * Arm the next timer. Call, clamp, setTimeout, log - and nothing else.
   *
   * Every scheduling decision, including the block clamp and the adaptive interval,
   * belongs to `nextAttemptAt`. Keeping arithmetic out of here is what makes the
   * decision table in tests/unit/nextAttempt.test.ts authoritative.
   */
  const scheduleNext = async (outcome: SchedulerTickOutcome | false = false) => {
    if (timer) {
      clearTimeout(timer);
    }

    const lastOutcome: SchedulerTickOutcome = outcome === false ? { type: 'normal' } : outcome;
    const current = lastOutcome.type === 'normal'
      ? await recalcMultipliers().catch(() => multipliers)
      : multipliers;

    const attempt = nextAttemptAt({
      now: Date.now(),
      lastOutcome,
      blocks: readBlocks(),
      controls,
      multipliers: current,
      random: Math.random,
    });

    if (attempt.clamp) {
      const blockedUntil = new Date(attempt.clamp.blockedUntilMs).toISOString();
      logger.info(
        {
          event: LOG_EVENT.schedulerNextScheduled,
          status: 'clamped',
          clampedBy: attempt.clamp.field,
          blockedUntil,
          discardedReason: attempt.clamp.discardedReason,
          discardedMinutes: attempt.clamp.discardedMinutes,
        },
        `[Scheduler] Schedule clamped — ${attempt.clamp.discardedReason} wanted ${attempt.clamp.discardedMinutes} minute(s) but ${attempt.clamp.field} is active until ${blockedUntil}`
      );
    }

    nextTickEta = new Date(attempt.at).toISOString();
    logger.info(
      {
        event: LOG_EVENT.schedulerNextScheduled,
        nextMinutes: attempt.nextMinutes,
        baseMinutes: attempt.baseMinutes,
        jitterPercent: attempt.jitterPercent,
        jitterMode: attempt.jitterMode,
        reason: attempt.reason,
        inputsUsed: attempt.inputsUsed,
      },
      describeSchedule(attempt.reason, attempt.nextMinutes, attempt.baseMinutes, nextTickEta, consecutiveFailures)
    );

    timer = setTimeout(() => {
      void (async () => {
        nextTickEta = null;
        const tickOutcome = await tick();
        await scheduleNext(tickOutcome);
      })();
    }, Math.max(0, attempt.at - Date.now()));
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
        multipliers = { ...NEUTRAL_MULTIPLIERS };
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
