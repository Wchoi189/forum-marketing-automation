import express from "express";
import path from "path";
import cors from "cors";
import { pathToFileURL } from "url";
import { createServer as createViteServer } from "vite";
import {
  getLogs,
  getObserverControlsWithGap,
  getPublisherControls,
  persistGapThresholdPersistedOverride,
  runObserver,
  runPublisher,
  setObserverControls,
  setPublisherControls,
  type ObserverControlsWithGap
} from "./bot.js";
import { ENV } from "./config/env.js";
import { validateRuntimeContracts } from "./config/runtime-validation.js";
import { buildCompetitorAnalyticsPayload, parseAnalyticsQuery } from "./lib/competitorAnalytics.js";
import { logger } from "./lib/logger.js";
import { LOG_EVENT } from "./lib/logEvents.js";
import { readPublisherHistory } from "./lib/publisherHistory.js";
import { applyScheduleJitter, type ScheduleJitterMode } from "./lib/scheduleJitter.js";
import { buildTrendInsightsPayload, computeTurnoverAnalysis, trendMultiplierFromAvgRate } from "./lib/trendInsights.js";

type BotDeps = {
  runObserver: typeof runObserver;
  runPublisher: typeof runPublisher;
  getLogs: typeof getLogs;
};

const defaultDeps: BotDeps = { runObserver, runPublisher, getLogs };

type SchedulerController = ReturnType<typeof startScheduler>;

type ControlPanelResponse = {
  preset: "balanced" | "night-safe" | "day-aggressive";
  observer: ObserverControlsWithGap;
  publisher: ReturnType<typeof getPublisherControls>;
  autoPublisher: {
    enabled: boolean;
    baseIntervalMinutes: number;
    effectiveIntervalMinutes: number;
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
    /** 0 = off; otherwise blended with trend-based effective interval. */
    targetPublishIntervalMinutes: number;
    running: boolean;
  };
};

type ControlPanelPreset = ControlPanelResponse["preset"];

type AutoPublisherControls = {
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

function extractErrorCode(input: unknown): string {
  const message = String((input as { message?: unknown })?.message ?? input ?? "").trim();
  const matched = message.match(/^([A-Z0-9_]+):/);
  return matched ? matched[1] : "UNCLASSIFIED_ERROR";
}

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

function normalizeAutoPublisherControls(
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
      typeof merged.scheduleJitterPercent === "number" ? merged.scheduleJitterPercent : base.scheduleJitterPercent,
      0,
      50
    ),
    scheduleJitterMode: merged.scheduleJitterMode === "none" ? "none" : "uniform",
    targetPublishIntervalMinutes: clampInt(
      typeof merged.targetPublishIntervalMinutes === "number"
        ? merged.targetPublishIntervalMinutes
        : base.targetPublishIntervalMinutes,
      0,
      1440
    )
  };
}

const PRESET_CONFIG: Record<
  ControlPanelPreset,
  { observer: Parameters<typeof setObserverControls>[0]; autoPublisher: Partial<AutoPublisherControls> }
> = {
  balanced: {
    observer: {
      enabled: true,
      minPreVisitDelayMs: 2000,
      maxPreVisitDelayMs: 7000,
      minIntervalBetweenRunsMs: 30000
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
      targetPublishIntervalMinutes: 0
    }
  },
  "night-safe": {
    observer: {
      enabled: true,
      minPreVisitDelayMs: 5000,
      maxPreVisitDelayMs: 12000,
      minIntervalBetweenRunsMs: 60000
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
      targetPublishIntervalMinutes: 0
    }
  },
  "day-aggressive": {
    observer: {
      enabled: true,
      minPreVisitDelayMs: 1000,
      maxPreVisitDelayMs: 4000,
      minIntervalBetweenRunsMs: 15000
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
      targetPublishIntervalMinutes: 0
    }
  }
};

export function createApp(deps: BotDeps = defaultDeps, scheduler?: SchedulerController) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      service: "marketing-automation",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/logs", async (req, res) => {
    const logs = await deps.getLogs();
    res.json(logs);
  });

  app.get("/api/publisher-history", async (req, res) => {
    const raw = req.query.limit;
    const str = Array.isArray(raw) ? raw[0] : raw;
    const n = str !== undefined ? Number(str) : 40;
    const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 40;
    const entries = await readPublisherHistory(limit);
    res.json(entries);
  });

  app.get("/api/analytics/competitors", async (req, res) => {
    const parsed = parseAnalyticsQuery({
      query: req.query as Record<string, string | string[] | undefined>
    });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const logs = await deps.getLogs();
    const payload = buildCompetitorAnalyticsPayload(logs, parsed);
    res.json(payload);
  });

  app.get("/api/competitor-stats", async (req, res) => {
    const logs = await deps.getLogs();
    const stats: Record<string, { count: number, totalViews: number }> = {};
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentLogs = logs.filter(log => new Date(log.timestamp) >= oneWeekAgo);

    recentLogs.forEach(log => {
      if (log.all_posts) {
        // Use a set to count unique posts per snapshot to avoid double counting if snapshots are frequent
        // But actually, frequency should be "how many times they appeared in snapshots" or "how many unique posts they made"
        // Let's go with "how many unique posts they made" across all snapshots
        const uniquePostsInSnapshot = new Set();
        log.all_posts.forEach(post => {
          const key = post.title + post.author;
          if (!uniquePostsInSnapshot.has(key)) {
            if (!stats[post.author]) {
              stats[post.author] = { count: 0, totalViews: 0 };
            }
            stats[post.author].count++;
            stats[post.author].totalViews += post.views;
            uniquePostsInSnapshot.add(key);
          }
        });
      }
    });

    const result = Object.entries(stats).map(([author, s]) => ({
      author,
      frequency: s.count,
      avgViews: Math.round(s.totalViews / s.count)
    })).sort((a, b) => b.frequency - a.frequency);
    const isSharePlanAuthor = (author: string) => author.toLowerCase().includes("shareplan");
    const sharePlanRow = result.find((row) => isSharePlanAuthor(row.author)) ?? {
      author: "SharePlan",
      frequency: 0,
      avgViews: 0
    };
    const top = result.slice(0, 10);
    const includesSharePlan = top.some((row) => isSharePlanAuthor(row.author));
    if (includesSharePlan) {
      res.json(top);
      return;
    }
    if (top.length < 10) {
      res.json([...top, sharePlanRow]);
      return;
    }
    res.json([...top.slice(0, 9), sharePlanRow]);
  });

  app.get("/api/board-stats", async (req, res) => {
    const logs = await deps.getLogs();
    if (logs.length < 2) return res.json({ turnoverRate: 0, shareOfVoice: 0 });

    const latest = logs[0];
    const previous = logs[1];

    const prevKeys = new Set(previous.all_posts?.map(p => p.title + p.author) || []);
    const newPosts = latest.all_posts?.filter(p => !prevKeys.has(p.title + p.author)).length || 0;
    
    const timeDiffHours = (new Date(latest.timestamp).getTime() - new Date(previous.timestamp).getTime()) / (1000 * 60 * 60);
    const turnoverRate = timeDiffHours > 0 ? (newPosts / timeDiffHours).toFixed(1) : 0;

    const ourPosts = latest.all_posts?.filter(p => p.author.toLowerCase().includes('shareplan')).length || 0;
    const shareOfVoice = latest.all_posts?.length ? Math.round((ourPosts / latest.all_posts.length) * 100) : 0;

    res.json({ turnoverRate, shareOfVoice });
  });

  app.get("/api/trend-insights", async (req, res) => {
    try {
      const logs = await deps.getLogs();
      let windowDays = 7;
      let trendAdaptiveEnabled = true;
      let referenceBaseIntervalMinutes = ENV.RUN_INTERVAL_MINUTES;

      if (scheduler) {
        const st = await scheduler.getState();
        referenceBaseIntervalMinutes = st.baseIntervalMinutes;
        trendAdaptiveEnabled = st.trendAdaptiveEnabled;
        windowDays = st.trendWindowDays;
      }

      const rawWindow = req.query.windowDays;
      if (rawWindow !== undefined) {
        const str = Array.isArray(rawWindow) ? rawWindow[0] : rawWindow;
        const n = Number(str);
        if (Number.isInteger(n) && n >= 1 && n <= 60) {
          windowDays = n;
        }
      }

      const rawAdaptive = req.query.trendAdaptiveEnabled;
      if (rawAdaptive === "true") trendAdaptiveEnabled = true;
      if (rawAdaptive === "false") trendAdaptiveEnabled = false;

      const payload = buildTrendInsightsPayload(logs, {
        windowDays,
        referenceBaseIntervalMinutes,
        trendAdaptiveEnabled
      });
      res.json(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { event: LOG_EVENT.apiTrendInsightsFailed, status: "error", errorCode: extractErrorCode(error), err: error },
        "Trend insights request failed"
      );
      res.status(500).json({ error: `[TrendInsights] ${message}` });
    }
  });

  app.get("/api/drafts", (req, res) => {
    res.json([
      {
        title: "[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)",
        timestamp: "2026-03-30 10:00:00",
        id: "draft_1"
      },
      {
        title: "[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)",
        timestamp: "2026-03-29 15:30:00",
        id: "draft_2"
      }
    ]);
  });

  app.post("/api/run-observer", async (req, res) => {
    try {
      const log = await deps.runObserver();
      if (log.status === 'error') {
        logger.error(
          { event: LOG_EVENT.apiRunObserverFailed, status: "error", errorCode: extractErrorCode(log.error), error: log.error },
          "run-observer returned error status"
        );
        res.status(500).json({ success: false, action: 'observer', error: log.error, log });
      } else {
        res.json({ success: true, action: 'observer', log });
      }
    } catch (error: any) {
      logger.error(
        { event: LOG_EVENT.apiRunObserverFailed, status: "error", errorCode: extractErrorCode(error), err: error },
        "run-observer request failed"
      );
      res.status(500).json({
        success: false,
        action: 'observer',
        error: `[Observer] ${String(error?.message ?? error)}`
      });
    }
  });

  app.post("/api/run-publisher", async (req, res) => {
    const { force } = req.body;
    try {
      const result = await deps.runPublisher(force);
      if (!result.success) {
        logger.error(
          {
            event: LOG_EVENT.apiRunPublisherFailed,
            status: "error",
            runId: result.runId,
            decision: result.decision,
            errorCode: extractErrorCode(result.message),
            error: result.message
          },
          "run-publisher returned unsuccessful result"
        );
        res.status(500).json({
          success: false,
          action: 'publisher',
          force: Boolean(force),
          message: result.message,
          error: result.message,
          log: result.log,
          runId: result.runId,
          decision: result.decision,
          artifactDir: result.artifactDir
        });
      } else {
        res.json({ ...result, action: 'publisher', force: Boolean(force) });
      }
    } catch (error: any) {
      logger.error(
        { event: LOG_EVENT.apiRunPublisherFailed, status: "error", errorCode: extractErrorCode(error), force: Boolean(req.body?.force), err: error },
        "run-publisher request failed"
      );
      res.status(500).json({
        success: false,
        action: 'publisher',
        force: Boolean(req.body?.force),
        error: `[Publisher] ${String(error?.message ?? error)}`
      });
    }
  });

  app.get("/api/control-panel", async (req, res) => {
    const autoPublisherState = (scheduler ? await scheduler.getState() : null) ?? {
      enabled: true,
      baseIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
      effectiveIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
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
      running: false
    };
    const payload: ControlPanelResponse = {
      preset: scheduler?.getPreset() ?? "balanced",
      observer: await getObserverControlsWithGap(),
      publisher: getPublisherControls(),
      autoPublisher: autoPublisherState
    };
    res.json(payload);
  });

  app.post("/api/control-panel", async (req, res) => {
    const body = (req.body ?? {}) as {
      preset?: ControlPanelPreset;
      observer?: Partial<ObserverControlsWithGap>;
      publisher?: Partial<ReturnType<typeof getPublisherControls>>;
      autoPublisher?: Partial<AutoPublisherControls> & { enabled?: boolean };
    };

    const rawObserver = body.observer ?? {};
    const gapPersistedOverride = (rawObserver as { gapPersistedOverride?: number | null }).gapPersistedOverride;
    const observerPacing: Parameters<typeof setObserverControls>[0] = { ...rawObserver };
    delete (observerPacing as { gapPersistedOverride?: unknown }).gapPersistedOverride;
    delete (observerPacing as { gapThresholdMin?: unknown }).gapThresholdMin;
    delete (observerPacing as { gapThresholdSpecBaseline?: unknown }).gapThresholdSpecBaseline;
    delete (observerPacing as { gapUsesEnvOverride?: unknown }).gapUsesEnvOverride;

    if (Object.prototype.hasOwnProperty.call(rawObserver, "gapPersistedOverride")) {
      const v = gapPersistedOverride;
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v))) {
        logger.warn(
          { event: LOG_EVENT.apiControlPanelValidationFailed, status: "error", field: "gapPersistedOverride", reason: "not_integer_or_null", value: v },
          "Control panel validation failed"
        );
        res.status(400).json({ error: "gapPersistedOverride must be an integer 1–50 or null" });
        return;
      }
      if (v !== null && (v < 1 || v > 50)) {
        logger.warn(
          { event: LOG_EVENT.apiControlPanelValidationFailed, status: "error", field: "gapPersistedOverride", reason: "out_of_range", value: v },
          "Control panel validation failed"
        );
        res.status(400).json({ error: "gapPersistedOverride must be an integer 1–50 or null" });
        return;
      }
      await persistGapThresholdPersistedOverride(v === null ? null : v);
    }

    setObserverControls(observerPacing);
    if (body.publisher && typeof body.publisher === "object") {
      setPublisherControls(body.publisher);
    }

    const hasPreset = Boolean(scheduler && body.preset && PRESET_CONFIG[body.preset]);
    if (scheduler && body.preset && PRESET_CONFIG[body.preset]) {
      const presetConfig = PRESET_CONFIG[body.preset];
      setObserverControls({ ...presetConfig.observer, ...observerPacing });
      scheduler.applyPreset(body.preset);
      scheduler.setControls(presetConfig.autoPublisher);
    }

    if (scheduler && body.autoPublisher) {
      // Preset wins scheduler numeric controls; only explicit enabled toggle may be layered after preset.
      if (Object.prototype.hasOwnProperty.call(body.autoPublisher, "enabled")) {
        scheduler.setEnabled(Boolean(body.autoPublisher.enabled));
      }
      if (!hasPreset) {
        scheduler.setControls(body.autoPublisher);
      }
    }

    const autoPublisherState = (scheduler ? await scheduler.getState() : null) ?? {
      enabled: true,
      baseIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
      effectiveIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
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
      running: false
    };
    const payload: ControlPanelResponse = {
      preset: scheduler?.getPreset() ?? "balanced",
      observer: await getObserverControlsWithGap(),
      publisher: getPublisherControls(),
      autoPublisher: autoPublisherState
    };
    res.json(payload);
  });

  return app;
}

export function startScheduler(deps: BotDeps = defaultDeps, intervalMinutes: number = ENV.RUN_INTERVAL_MINUTES) {
  let preset: ControlPanelPreset = "balanced";
  let controls = normalizeAutoPublisherControls(
    {
      enabled: true,
      baseIntervalMinutes: Math.max(1, intervalMinutes),
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
      targetPublishIntervalMinutes: 0
    },
    { ...PRESET_CONFIG.balanced.autoPublisher, baseIntervalMinutes: Math.max(1, intervalMinutes) }
  );
  let timer: NodeJS.Timeout | null = null;
  let enabled = true;
  let running = false;
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
      logger.warn({ event: LOG_EVENT.schedulerTickSkipped, status: "skip", reason: "already_running" }, "[Scheduler] Tick skipped because previous run is still active.");
      return;
    }

    running = true;
    const tickStartedAt = Date.now();
    try {
      logger.info({ event: LOG_EVENT.schedulerTickStarted }, "[Scheduler] Tick started");
      await deps.runPublisher(false);
    } catch (error: any) {
      logger.error({ event: LOG_EVENT.schedulerTickFailed, status: "error", error: String(error?.message ?? error) }, "[Scheduler] Tick failed");
    } finally {
      logger.info({ event: LOG_EVENT.schedulerTickFinished, status: "ok", durationMs: Date.now() - tickStartedAt }, "[Scheduler] Tick finished");
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
    logger.info({ event: LOG_EVENT.schedulerNextScheduled, nextMinutes, baseMinutes, jitterPercent: controls.scheduleJitterPercent, jitterMode: controls.scheduleJitterMode }, "[Scheduler] Next tick scheduled");
    timer = setTimeout(() => {
      void (async () => {
        await tick();
        await scheduleNext();
      })();
    }, nextMinutes * 60 * 1000);
  };
  void scheduleNext();

  logger.info({ event: LOG_EVENT.schedulerStarted, baseIntervalMinutes: controls.baseIntervalMinutes }, `[Scheduler] Started with interval ${controls.baseIntervalMinutes} minute(s).`);

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
      enabled,
      ...controls,
      effectiveIntervalMinutes: await computeEffectiveIntervalMinutes().catch(() => controls.baseIntervalMinutes),
      running
    })
  };
}

export async function startServer() {
  await validateRuntimeContracts();

  const scheduler = startScheduler();
  const app = createApp(defaultDeps, scheduler);
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = ENV.PORT;
  app.listen(PORT, "0.0.0.0", () => {
    logger.info({ event: LOG_EVENT.serverStarted, port: PORT, host: "0.0.0.0" }, `Server running on http://localhost:${PORT}`);
  });

}

const isDirectRun = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isDirectRun) {
  startServer();
}
