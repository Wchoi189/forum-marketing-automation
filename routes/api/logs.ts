/**
 * routes/api/logs.ts
 *
 * Observation log and analytics routes:
 *   GET /api/logs
 *   GET /api/publisher-history
 *   GET /api/analytics/competitors
 *   GET /api/competitor-stats
 *   GET /api/board-stats
 *   GET /api/competitor-intel/overview
 *   GET /api/competitor-intel/vendors
 *   GET /api/competitor-intel/records
 *   GET /api/competitor-intel/records/:recordId
 *   GET /api/competitor-intel/products
 *   GET /api/competitor-intel/timeline
 *   GET /api/trend-insights
 *   GET /api/scheduler-signals
 */

import { Router, type RequestHandler } from 'express';
import { buildCompetitorAnalyticsPayload, parseAnalyticsQuery } from '../../lib/competitorAnalytics.js';
import { logger } from '../../lib/logger.js';
import { LOG_EVENT } from '../../lib/logEvents.js';
import { extractErrorCode } from '../../lib/utils.js';
import { readPublisherHistory } from '../../lib/publisherHistory.js';
import { buildTrendInsightsPayload } from '../../lib/trendInsights.js';
import {
  getOverview,
  getVendorSummaries,
  listRecords,
  getRecord,
  getProductPrices,
  getActivityTimeline,
} from '../../lib/competitor-intel-ui.js';
import { openDatabase } from '../../lib/competitor-ad-sqlite.js';
import { ENV } from '../../config/env.js';
import type { SchedulerSignalDiagnostics, PublisherHistoryEntry } from '../../lib/models.js';
import {
  OPPORTUNITY_MULTIPLIER_MAX,
  OPPORTUNITY_MULTIPLIER_MIN,
  buildSchedulerAdaptationWindows,
  buildSchedulerSignalTimeline,
  summarizeSchedulerSignals,
} from '../../lib/schedulerSignals.js';
import type { LogCache } from '../../lib/logCache.js';
import type { SchedulerController } from '../routerTypes.js';

// ── Response cache types ──────────────────────────────────────────────────────

type ResponseCache<T> = { data: T; expiresAt: number };
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePositiveIntQuery(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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
  options: {
    windowDays: number;
    windowSize: number;
    historyLimit: number;
    nowMs?: number;
  }
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

// ── Router ────────────────────────────────────────────────────────────────────

export type LogsRouterDeps = {
  logCache: LogCache;
  scheduler: SchedulerController | undefined;
  getPublisherHistoryForSignals: (limit: number) => Promise<PublisherHistoryEntry[]>;
  logsLimiter: RequestHandler;
  analyticsLimiter: RequestHandler;
};

export function createLogsRouter(deps: LogsRouterDeps): Router {
  const { logCache, scheduler, getPublisherHistoryForSignals } = deps;

  // Per-router caches (TTL-based)
  let cachedLogs: { key: string; payload: unknown; expiresAt: number } | null = null;
  const LOGS_CACHE_MS = 15_000;

  let cachedPublisherHistory: { key: string; payload: unknown[]; expiresAt: number } | null = null;
  const PUBLISHER_HISTORY_CACHE_MS = 15_000;

  let cachedAnalytics: ResponseCache<{ key: string; payload: unknown }> | null = null;

  let cachedCompetitorStats: { payload: unknown; expiresAt: number } | null = null;
  const COMPETITOR_STATS_CACHE_MS = 30_000;

  let cachedBoardStats: { payload: unknown; expiresAt: number } | null = null;
  const BOARD_STATS_CACHE_MS = 30_000;

  let cachedTrendInsights: { payload: unknown; expiresAt: number } | null = null;
  const TREND_INSIGHTS_CACHE_MS = 30_000;

  const router = Router();

  // ── /api/logs ───────────────────────────────────────────────────────────────
  router.get('/api/logs', deps.logsLimiter, async (req, res) => {
    const raw = req.query.limit;
    const str = Array.isArray(raw) ? raw[0] : raw;
    const n = str !== undefined ? Number(str) : 200;
    const limit = Number.isInteger(n) && n >= 1 && n <= 500 ? n : 200;
    const cacheKey = String(limit);

    if (cachedLogs && cachedLogs.key === cacheKey && Date.now() < cachedLogs.expiresAt) {
      res.json(cachedLogs.payload);
      return;
    }

    const allLogs = await logCache.get();
    const logs = allLogs.slice(-limit);
    const payload = {
      logs,
      hasMore: allLogs.length > limit,
      oldestTimestamp: logs.length > 0 ? logs[0].timestamp : null,
      totalCount: allLogs.length,
    };
    cachedLogs = { key: cacheKey, payload, expiresAt: Date.now() + LOGS_CACHE_MS };
    res.json(payload);
  });

  // ── /api/publisher-history ──────────────────────────────────────────────────
  router.get('/api/publisher-history', async (req, res) => {
    const raw = req.query.limit;
    const str = Array.isArray(raw) ? raw[0] : raw;
    const n = str !== undefined ? Number(str) : 40;
    const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 40;
    const cacheKey = String(limit);

    if (cachedPublisherHistory && cachedPublisherHistory.key === cacheKey && Date.now() < cachedPublisherHistory.expiresAt) {
      res.json(cachedPublisherHistory.payload);
      return;
    }

    const entries = await readPublisherHistory(limit);
    cachedPublisherHistory = { key: cacheKey, payload: entries, expiresAt: Date.now() + PUBLISHER_HISTORY_CACHE_MS };
    res.json(entries);
  });

  // ── /api/analytics/competitors ──────────────────────────────────────────────
  router.get('/api/analytics/competitors', deps.analyticsLimiter, async (req, res) => {
    try {
      const parsed = parseAnalyticsQuery({
        query: req.query as Record<string, string | string[] | undefined>
      });
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const cacheKey = JSON.stringify({
        fromMs: parsed.fromMs,
        toMs: parsed.toMs,
        bucket: parsed.bucket,
        excludeNotices: parsed.excludeNotices,
        authorFilter: parsed.authorFilter,
        focusAuthor: parsed.focusAuthor
      });

      if (cachedAnalytics && Date.now() < cachedAnalytics.expiresAt && cachedAnalytics.data.key === cacheKey) {
        res.json(cachedAnalytics.data.payload);
        return;
      }

      const logs = await logCache.get();
      const payload = buildCompetitorAnalyticsPayload(logs, parsed);
      cachedAnalytics = { data: { key: cacheKey, payload }, expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS };
      res.json(payload);
    } catch (err) {
      logger.error({ event: 'analytics_competitors_error', err }, '[Analytics] buildCompetitorAnalyticsPayload failed');
      res.status(500).json({ error: 'analytics_failed' });
    }
  });

  // ── /api/competitor-stats ───────────────────────────────────────────────────
  router.get('/api/competitor-stats', async (_req, res) => {
    if (cachedCompetitorStats && Date.now() < cachedCompetitorStats.expiresAt) {
      res.json(cachedCompetitorStats.payload);
      return;
    }

    const logs = await logCache.get();
    const stats: Record<string, { count: number, totalViews: number }> = {};

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentLogs = logs.filter(log => new Date(log.timestamp) >= oneWeekAgo);

    recentLogs.forEach((log: { timestamp: string; all_posts?: Array<{ title: string; author: string; views: number }> }) => {
      if (log.all_posts) {
        const uniquePostsInSnapshot = new Set();
        log.all_posts.forEach((post: { title: string; author: string; views: number }) => {
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
    const isSharePlanAuthor = (author: string) => author.toLowerCase().includes('shareplan');
    const sharePlanRow = result.find((row) => isSharePlanAuthor(row.author)) ?? {
      author: 'SharePlan',
      frequency: 0,
      avgViews: 0
    };
    const top = result.slice(0, 10);
    const includesSharePlan = top.some((row) => isSharePlanAuthor(row.author));
    let payload: unknown;
    if (includesSharePlan) {
      payload = top;
    } else if (top.length < 10) {
      payload = [...top, sharePlanRow];
    } else {
      payload = [...top.slice(0, 9), sharePlanRow];
    }
    cachedCompetitorStats = { payload, expiresAt: Date.now() + COMPETITOR_STATS_CACHE_MS };
    res.json(payload);
  });

  // ── /api/board-stats ────────────────────────────────────────────────────────
  router.get('/api/board-stats', async (_req, res) => {
    if (cachedBoardStats && Date.now() < cachedBoardStats.expiresAt) {
      res.json(cachedBoardStats.payload);
      return;
    }

    const logs = await logCache.get();
    if (logs.length < 2) {
      res.json({ turnoverRate: 0, shareOfVoice: 0 });
      return;
    }

    const latest = logs[0];
    const previous = logs[1];

    const prevKeys = new Set(previous.all_posts?.map((p: { title: string; author: string }) => p.title + p.author) || []);
    const newPosts = latest.all_posts?.filter((p: { title: string; author: string }) => !prevKeys.has(p.title + p.author)).length || 0;

    const timeDiffHours = (new Date(latest.timestamp).getTime() - new Date(previous.timestamp).getTime()) / (1000 * 60 * 60);
    const turnoverRate = timeDiffHours > 0 ? (newPosts / timeDiffHours).toFixed(1) : 0;

    const ourPosts = latest.all_posts?.filter((p: { author: string }) => p.author.toLowerCase().includes('shareplan')).length || 0;
    const shareOfVoice = latest.all_posts?.length ? Math.round((ourPosts / latest.all_posts.length) * 100) : 0;

    const payload = { turnoverRate, shareOfVoice };
    cachedBoardStats = { payload, expiresAt: Date.now() + BOARD_STATS_CACHE_MS };
    res.json(payload);
  });

  // ── Competitor Intelligence UI ───────────────────────────────────────────────
  router.get('/api/competitor-intel/overview', (_req, res) => {
    try {
      const db = openDatabase();
      const payload = getOverview(db);
      db.close();
      res.json(payload);
    } catch (err) {
      logger.error({ event: 'competitor_intel_overview_error', err }, '[CompetitorIntel] overview failed');
      res.status(500).json({ error: 'Failed to fetch overview' });
    }
  });

  router.get('/api/competitor-intel/vendors', (_req, res) => {
    try {
      const db = openDatabase();
      const payload = getVendorSummaries(db);
      db.close();
      res.json(payload);
    } catch (err) {
      logger.error({ event: 'competitor_intel_vendors_error', err }, '[CompetitorIntel] vendors failed');
      res.status(500).json({ error: 'Failed to fetch vendors' });
    }
  });

  router.get('/api/competitor-intel/records', (req, res) => {
    try {
      const vendor = typeof req.query.vendor === 'string' ? req.query.vendor : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const db = openDatabase();
      const { entries, total } = listRecords(db, { vendor, limit, offset });
      db.close();
      res.json({ entries, total, limit, offset });
    } catch (err) {
      logger.error({ event: 'competitor_intel_records_error', err }, '[CompetitorIntel] records failed');
      res.status(500).json({ error: 'Failed to fetch records' });
    }
  });

  router.get('/api/competitor-intel/records/:recordId', (req, res) => {
    try {
      const db = openDatabase();
      const detail = getRecord(db, req.params.recordId);
      db.close();
      if (!detail) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }
      res.json(detail);
    } catch (err) {
      logger.error({ event: 'competitor_intel_record_error', err }, '[CompetitorIntel] record failed');
      res.status(500).json({ error: 'Failed to fetch record' });
    }
  });

  router.get('/api/competitor-intel/products', (_req, res) => {
    try {
      const db = openDatabase();
      const payload = getProductPrices(db);
      db.close();
      res.json(payload);
    } catch (err) {
      logger.error({ event: 'competitor_intel_products_error', err }, '[CompetitorIntel] products failed');
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  router.get('/api/competitor-intel/timeline', (req, res) => {
    try {
      const bucketDays = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const db = openDatabase();
      const payload = getActivityTimeline(db, bucketDays);
      db.close();
      res.json(payload);
    } catch (err) {
      logger.error({ event: 'competitor_intel_timeline_error', err }, '[CompetitorIntel] timeline failed');
      res.status(500).json({ error: 'Failed to fetch timeline' });
    }
  });

  // ── /api/trend-insights ─────────────────────────────────────────────────────
  router.get('/api/trend-insights', deps.analyticsLimiter, async (req, res) => {
    try {
      if (cachedTrendInsights && Date.now() < cachedTrendInsights.expiresAt) {
        res.json(cachedTrendInsights.payload);
        return;
      }

      const logs = await logCache.get();
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
      if (rawAdaptive === 'true') trendAdaptiveEnabled = true;
      if (rawAdaptive === 'false') trendAdaptiveEnabled = false;

      const payload = buildTrendInsightsPayload(logs, {
        windowDays,
        referenceBaseIntervalMinutes,
        trendAdaptiveEnabled,
        ourAuthorSubstring: ENV.OUR_AUTHOR_SUBSTRING
      });

      let schedulerSignals: SchedulerSignalDiagnostics | null = null;
      try {
        const historyLimit = Math.max(40, Math.min(240, windowDays * 24));
        schedulerSignals = await buildSchedulerSignalDiagnostics(getPublisherHistoryForSignals, {
          windowDays,
          windowSize: 8,
          historyLimit,
        });
      } catch (err) {
        logger.warn(
          { event: 'api_scheduler_signal_diagnostics_fallback', err },
          'Trend insights could not load scheduler signal diagnostics; returning base payload'
        );
      }

      const result = {
        ...payload,
        schedulerSignals,
      };
      cachedTrendInsights = { payload: result, expiresAt: Date.now() + TREND_INSIGHTS_CACHE_MS };
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { event: LOG_EVENT.apiTrendInsightsFailed, status: 'error', errorCode: extractErrorCode(error), err: error },
        'Trend insights request failed'
      );
      res.status(500).json({ error: `[TrendInsights] ${message}` });
    }
  });

  // ── /api/scheduler-signals ──────────────────────────────────────────────────
  router.get('/api/scheduler-signals', async (req, res) => {
    try {
      const schedulerState = scheduler ? await scheduler.getState() : null;
      const defaultWindowDays = schedulerState?.trendWindowDays ?? 7;

      const windowDays = parsePositiveIntQuery(req.query.windowDays, defaultWindowDays, 1, 60);
      const windowSize = parsePositiveIntQuery(req.query.windowSize, 8, 1, 24);
      const historyLimit = parsePositiveIntQuery(
        req.query.historyLimit,
        Math.max(40, Math.min(240, windowDays * 24)),
        20,
        500
      );

      const schedulerSignals = await buildSchedulerSignalDiagnostics(getPublisherHistoryForSignals, {
        windowDays,
        windowSize,
        historyLimit,
      });

      res.json(schedulerSignals);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          event: 'api_scheduler_signal_diagnostics_failed',
          status: 'error',
          errorCode: extractErrorCode(error),
          err: error,
        },
        'Scheduler signal diagnostics request failed'
      );
      res.status(500).json({ error: `[SchedulerSignals] ${message}` });
    }
  });

  return router;
}
