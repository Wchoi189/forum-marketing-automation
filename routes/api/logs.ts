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
import {
  buildBoardStats,
  buildCompetitorAnalyticsPayload,
  buildCompetitorStats,
  buildSchedulerSignalDiagnostics,
  buildTrendInsightsPayload,
  parseAnalyticsQuery,
} from '../../lib/analytics/index.js';
import { logger, LOG_EVENT } from '../../lib/logging/index.js';
import { extractErrorCode } from '../../lib/utils.js';
import { readPublisherHistory } from '../../lib/publisherHistory.js';
import { getOverview, getVendorSummaries, listRecords, getRecord, getProductPrices, getActivityTimeline, openDatabase } from '../../lib/competitor-store/index.js';
import { ENV } from '../../config/env.js';
import type { SchedulerSignalDiagnostics, PublisherHistoryEntry } from '../../contracts/models.js';
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
    const payload = buildCompetitorStats(logs, { ourAuthorSubstring: ENV.OUR_AUTHOR_SUBSTRING });
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
    const payload = buildBoardStats(logs, { ourAuthorSubstring: ENV.OUR_AUTHOR_SUBSTRING });
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
