import { applyScheduleJitter, type ScheduleJitterMode } from './scheduleJitter.js';
import {
  computeTurnoverAnalysis,
  trendMultiplierFromAvgRate,
  computeShareOfVoice,
  shareOfVoiceMultiplierFromSoV,
  COMBINED_MULTIPLIER_MIN,
  COMBINED_MULTIPLIER_MAX,
} from './trendInsights.js';
import { logger } from './logger.js';
import { LOG_EVENT } from './logEvents.js';
import { ENV } from '../config/env.js';
import type { ActivityLog } from '../contracts/models.js';
import type { PublisherRunResult } from '../bot.js';

export type BotDeps = {
  runObserver: () => Promise<ActivityLog>;
  runPublisher: (force?: boolean) => Promise<PublisherRunResult>;
  getLogs: () => Promise<ActivityLog[]>;
};

export type ControlPanelPreset = 'balanced' | 'night-safe' | 'day-aggressive';

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
};

// Observer pacing subset used by presets (matches Partial<ObserverControls> shape).
type ObserverPacingPatch = {
  enabled?: boolean;
  minPreVisitDelayMs?: number;
  maxPreVisitDelayMs?: number;
  minIntervalBetweenRunsMs?: number;
};

export type PresetConfig = {
  observer: ObserverPacingPatch;
  autoPublisher: Partial<AutoPublisherControls>;
};

function isHourInRange(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}

export function normalizeAutoPublisherControls(
  base: AutoPublisherControls,
  patch?: Partial<AutoPublisherControls>
): AutoPublisherControls {
  const merged = { ...base, ...(patch ?? {}) };
  return {
    enabled: Boolean(merged.enabled),
    baseIntervalMinutes: clampInt(merged.baseIntervalMinutes, 1, 1440),
    quietHoursStart: clampInt(merged.quietHoursStart, 0, 23),
    quietHoursEnd: clampInt(merged.quietHoursEnd, 0, 23),
    quietHoursMultiplier: clampFloat(merged.quietHoursMultiplier, 0.2, 5),
    activeHoursStart: clampInt(merged.activeHoursStart, 0, 23),
    activeHoursEnd: clampInt(merged.activeHoursEnd, 0, 23),
    activeHoursMultiplier: clampFloat(merged.activeHoursMultiplier, 0.2, 5),
    trendAdaptiveEnabled: Boolean(merged.trendAdaptiveEnabled),
    trendWindowDays: clampInt(merged.trendWindowDays, 1, 60),
    trendRecalibrationDays: clampInt(merged.trendRecalibrationDays, 1, 30),
    scheduleJitterPercent: clampInt(
      typeof merged.scheduleJitterPercent === 'number' ? merged.scheduleJitterPercent : base.scheduleJitterPercent,
      0,
      50
    ),
    scheduleJitterMode: merged.scheduleJitterMode === 'none' ? 'none' : 'uniform',
    targetPublishIntervalMinutes: clampInt(
      typeof merged.targetPublishIntervalMinutes === 'number'
        ? merged.targetPublishIntervalMinutes
        : base.targetPublishIntervalMinutes,
      0,
      1440
    ),
  };
}

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
  };
  let controls = normalizeAutoPublisherControls(baseDefaults);
  let timer: NodeJS.Timeout | null = null;
  let enabled = baseDefaults.enabled;
  let running = false;
  let nextTickEta: string | null = null;
  let lastTrendRecalculatedAt = 0;
  let trendFactor = 1;

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
    let effective = clampInt(controls.baseIntervalMinutes * multiplier, 1, 1440);
    if (controls.targetPublishIntervalMinutes > 0) {
      const t = controls.targetPublishIntervalMinutes;
      effective = clampInt(Math.round(effective * 0.5 + t * 0.5), 1, 1440);
    }
    return effective;
  };

  const tick = async () => {
    if (!enabled) {
      return;
    }
    if (running) {
      logger.warn(
        { event: LOG_EVENT.schedulerTickSkipped, status: 'skip', reason: 'already_running' },
        '[Scheduler] Tick skipped because previous run is still active.'
      );
      return;
    }

    running = true;
    const tickStartedAt = Date.now();
    try {
      logger.info({ event: LOG_EVENT.schedulerTickStarted }, '[Scheduler] Tick started');
      await deps.runPublisher(false);
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
  };

  const scheduleNext = async () => {
    if (timer) {
      clearTimeout(timer);
    }
    const baseMinutes = await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes);
    const nextMinutes = applyScheduleJitter(
      baseMinutes,
      controls.scheduleJitterPercent,
      controls.scheduleJitterMode,
      Math.random
    );
    nextTickEta = new Date(Date.now() + nextMinutes * 60 * 1000).toISOString();
    logger.info(
      {
        event: LOG_EVENT.schedulerNextScheduled,
        nextMinutes,
        baseMinutes,
        jitterPercent: controls.scheduleJitterPercent,
        jitterMode: controls.scheduleJitterMode,
      },
      '[Scheduler] Next tick scheduled'
    );
    timer = setTimeout(() => {
      void (async () => {
        nextTickEta = null;
        await tick();
        await scheduleNext();
      })();
    }, nextMinutes * 60 * 1000);
  };

  // Fire an initial tick shortly after startup so the publisher doesn't sit idle for
  // a full interval after every server restart. The short delay lets the server finish
  // binding and Vite initialise before Playwright launches.
  const STARTUP_TICK_DELAY_MS = 10_000;
  nextTickEta = new Date(Date.now() + STARTUP_TICK_DELAY_MS).toISOString();
  timer = setTimeout(() => {
    void (async () => {
      nextTickEta = null;
      await tick();
      await scheduleNext();
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
      void scheduleNext();
    },
    setControls: (patch: Partial<AutoPublisherControls>) => {
      controls = normalizeAutoPublisherControls(controls, patch);
      if (controls.trendAdaptiveEnabled === false) {
        trendFactor = 1;
      }
      void scheduleNext();
    },
    setPreset: (nextPreset: ControlPanelPreset) => {
      preset = nextPreset;
    },
    getPreset: () => preset,
    applyPreset: (nextPreset: ControlPanelPreset) => {
      preset = nextPreset;
      controls = normalizeAutoPublisherControls(controls, PRESET_CONFIG[nextPreset].autoPublisher);
      void scheduleNext();
    },
    getState: async () => ({
      ...controls,
      enabled,
      effectiveIntervalMinutes: await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes),
      running,
      nextTickEta: enabled ? nextTickEta : null,
    }),
  };
}
