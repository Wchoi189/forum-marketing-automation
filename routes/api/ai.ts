/**
 * routes/api/ai.ts
 *
 * AI advisor routes:
 *   GET  /api/ai-recommendation
 *   GET  /api/ai-token-stats
 *   POST /api/apply-ai-recommendation
 */

import { Router } from 'express';
import { ENV } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { buildTrendInsightsPayload } from '../../lib/trendInsights.js';
import {
  buildAdvisorContext,
  callGrokAdvisor,
  getAdvisorCache,
  setAdvisorCache,
  markAdvisorCacheApplied,
  getAdvisorTokenStats,
} from '../../lib/aiAdvisor.js';
import { readPublisherHistory } from '../../lib/publisherHistory.js';
import { writeRuntimeControls } from '../../lib/runtimeControls.js';
import type { LogCache } from '../../lib/logCache.js';
import type { SchedulerController } from '../routerTypes.js';
import type { buildControlPanelResponse } from './control.js';

const CONTROL_PANEL_CACHE_MS = 10_000;

export type AiRouterDeps = {
  logCache: LogCache;
  scheduler: SchedulerController | undefined;
  getNlWebhookEnabled: () => boolean;
  setCachedControlPanel: (v: { payload: unknown; expiresAt: number } | null) => void;
  buildCP: typeof buildControlPanelResponse;
};

export function createAiRouter(deps: AiRouterDeps): Router {
  const { logCache, scheduler } = deps;
  const router = Router();

  // ── GET /api/ai-recommendation ──────────────────────────────────────────────
  router.get('/api/ai-recommendation', async (_req, res) => {
    if (!ENV.AI_ADVISOR_ENABLED || !ENV.XAI_API_KEY) {
      res.json({ recommendation: null, contextBuiltAt: null, source: 'disabled' }); return;
    }
    const cached = getAdvisorCache();
    if (cached) { res.json({ recommendation: cached.result, contextBuiltAt: cached.cachedAt, source: 'cached' }); return; }

    try {
      const [logs, history, controlPanelState] = await Promise.all([
        logCache.get(), readPublisherHistory(10), scheduler ? scheduler.getState() : null,
      ]);
      const trend = buildTrendInsightsPayload(logs, {
        windowDays: controlPanelState?.trendWindowDays ?? 7,
        referenceBaseIntervalMinutes: controlPanelState?.baseIntervalMinutes ?? ENV.RUN_INTERVAL_MINUTES,
        trendAdaptiveEnabled: controlPanelState?.trendAdaptiveEnabled ?? true,
        ourAuthorSubstring: ENV.OUR_AUTHOR_SUBSTRING,
      });
      const latestLog = logs[0] ?? null;
      const context = buildAdvisorContext(trend, history, latestLog, {
        baseIntervalMinutes: controlPanelState?.baseIntervalMinutes ?? ENV.RUN_INTERVAL_MINUTES,
        scheduleJitterPercent: controlPanelState?.scheduleJitterPercent ?? ENV.SCHEDULER_JITTER_PERCENT,
        enabled: controlPanelState?.enabled ?? true,
        trendAdaptiveEnabled: controlPanelState?.trendAdaptiveEnabled ?? true,
      });
      const result = await callGrokAdvisor(context);
      setAdvisorCache(result);
      const freshCache = getAdvisorCache()!;
      res.json({ recommendation: freshCache.result, contextBuiltAt: freshCache.cachedAt, source: 'fresh' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ event: 'ai_advisor_endpoint_failed', err }, 'GET /api/ai-recommendation failed');
      res.json({ recommendation: null, contextBuiltAt: null, source: 'error', error: msg });
    }
  });

  // ── GET /api/ai-token-stats ─────────────────────────────────────────────────
  router.get('/api/ai-token-stats', (_req, res) => { res.json(getAdvisorTokenStats()); });

  // ── POST /api/apply-ai-recommendation ───────────────────────────────────────
  router.post('/api/apply-ai-recommendation', async (_req, res) => {
    const cached = getAdvisorCache();
    if (!cached || !cached.result.ok) { res.status(422).json({ error: 'no_recommendation' }); return; }
    const ageMs = Date.now() - new Date(cached.cachedAt).getTime();
    if (ageMs > 30 * 60 * 1000) { res.status(422).json({ error: 'recommendation_stale' }); return; }

    const { recommendedIntervalMinutes, recommendedGapThreshold } = cached.result.recommendation;
    if (scheduler) scheduler.setControls({ baseIntervalMinutes: recommendedIntervalMinutes });
    const persistMeta = await writeRuntimeControls({ observerGapThresholdMin: recommendedGapThreshold, schedulerBaseIntervalMinutes: recommendedIntervalMinutes });
    const controlPanel = await deps.buildCP(scheduler, deps.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
    deps.setCachedControlPanel({ payload: controlPanel, expiresAt: Date.now() + CONTROL_PANEL_CACHE_MS });
    markAdvisorCacheApplied();
    const appliedAt = new Date().toISOString();
    logger.info({ event: 'ai_advisor_applied', intervalMinutes: recommendedIntervalMinutes, gapThreshold: recommendedGapThreshold }, 'AI recommendation applied to control panel');
    res.json({ applied: true, intervalMinutes: recommendedIntervalMinutes, gapThreshold: recommendedGapThreshold, stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt, appliedAt, controlPanel });
  });

  return router;
}
