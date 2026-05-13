/**
 * routes/api/nl.ts
 *
 * Natural-language webhook route:
 *   POST /api/nl-command
 */

import { Router } from 'express';
import { ENV } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { classifyIntent, buildStatusSummary, extractIntervalMinutes, extractGapThreshold } from '../../lib/nlWebhook.js';
import { getAdvisorCache, markAdvisorCacheApplied } from '../../lib/aiAdvisor.js';
import { writeRuntimeControls, writeRuntimeGapPersistedOverride } from '../../lib/runtimeControls.js';
import { buildTrendInsightsPayload } from '../../lib/trendInsights.js';
import { readPublisherHistory } from '../../lib/publisherHistory.js';
import type { BotDeps } from '../../lib/scheduler.js';
import type { LogCache } from '../../lib/logCache.js';
import type { SchedulerController } from '../routerTypes.js';
import type { buildControlPanelResponse } from './control.js';

const CONTROL_PANEL_CACHE_MS = 10_000;

export type NlRouterDeps = {
  deps: BotDeps;
  logCache: LogCache;
  scheduler: SchedulerController | undefined;
  getNlWebhookEnabled: () => boolean;
  setCachedControlPanel: (v: { payload: unknown; expiresAt: number } | null) => void;
  buildCP: typeof buildControlPanelResponse;
};

export function createNlRouter(opts: NlRouterDeps): Router {
  const { deps, logCache, scheduler } = opts;
  const router = Router();

  router.post('/api/nl-command', async (req, res) => {
    if (!opts.getNlWebhookEnabled()) { res.status(503).json({ error: 'nl_webhook_disabled' }); return; }
    if (!ENV.XAI_API_KEY) { res.status(503).json({ error: 'xai_key_absent' }); return; }

    if (ENV.NL_WEBHOOK_SECRET) {
      const authHeader = req.headers['authorization'] ?? '';
      if (authHeader !== `Bearer ${ENV.NL_WEBHOOK_SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
    }

    const body = (req.body ?? {}) as { message?: unknown; source?: unknown; dry_run?: unknown };
    if (typeof body.message !== 'string' || body.message.trim() === '') { res.status(400).json({ error: 'message_required' }); return; }

    const message = body.message.trim();
    const source = typeof body.source === 'string' ? body.source : 'unknown';
    const dryRun = body.dry_run === true;

    const classification = await classifyIntent(message);
    const { intent, extractedParams, confidence } = classification;
    logger.info({ event: 'nl_command_received', source, intent, confidence, dryRun }, '[NL Webhook] Command received');

    if (intent === 'unknown') { res.status(422).json({ error: 'unknown_intent', reason: classification.reason }); return; }

    if (dryRun) {
      const dispatchMap: Record<string, string> = {
        pause_scheduler: 'POST /api/control-panel', resume_scheduler: 'POST /api/control-panel',
        force_publish: 'POST /api/run-publisher', set_interval: 'POST /api/control-panel',
        set_gap_threshold: 'writeRuntimeGapPersistedOverride', apply_ai_recommendation: 'POST /api/apply-ai-recommendation',
        status_query: 'GET /api/control-panel + GET /api/trend-insights + GET /api/publisher-history',
      };
      res.json({ intent, dispatched_to: dispatchMap[intent] ?? 'unknown', result: null, dry_run: true }); return;
    }

    try {
      let dispatchedTo: string;
      let result: unknown;

      switch (intent) {
        case 'pause_scheduler': {
          if (scheduler) scheduler.setEnabled(false);
          const persistMeta = await writeRuntimeControls({ schedulerEnabled: false });
          const controlPanel = await opts.buildCP(scheduler, opts.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
          dispatchedTo = 'POST /api/control-panel';
          result = { schedulerEnabled: false, stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt, controlPanel };
          break;
        }
        case 'resume_scheduler': {
          if (scheduler) scheduler.setEnabled(true);
          const persistMeta = await writeRuntimeControls({ schedulerEnabled: true });
          const controlPanel = await opts.buildCP(scheduler, opts.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
          dispatchedTo = 'POST /api/control-panel';
          result = { schedulerEnabled: true, stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt, controlPanel };
          break;
        }
        case 'force_publish': {
          if (!ENV.MANUAL_OVERRIDE_ENABLED) { res.status(422).json({ error: 'force_publish_disabled', reason: 'MANUAL_OVERRIDE_ENABLED is false' }); return; }
          dispatchedTo = 'POST /api/run-publisher';
          result = await deps.runPublisher(true);
          break;
        }
        case 'set_interval': {
          const intervalMinutes = extractIntervalMinutes(extractedParams);
          if (intervalMinutes === null) { res.status(422).json({ error: 'missing_param', reason: 'intervalMinutes could not be extracted or is out of range (5–480)' }); return; }
          if (scheduler) scheduler.setControls({ baseIntervalMinutes: intervalMinutes });
          const persistMeta = await writeRuntimeControls({ schedulerBaseIntervalMinutes: intervalMinutes });
          const controlPanel = await opts.buildCP(scheduler, opts.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
          dispatchedTo = 'POST /api/control-panel';
          result = { baseIntervalMinutes: intervalMinutes, stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt, controlPanel };
          break;
        }
        case 'set_gap_threshold': {
          const gapThreshold = extractGapThreshold(extractedParams);
          if (gapThreshold === null) { res.status(422).json({ error: 'missing_param', reason: 'observerGapThresholdMin could not be extracted or is out of range (1–50)' }); return; }
          const persistMeta = await writeRuntimeGapPersistedOverride(gapThreshold);
          const controlPanel = await opts.buildCP(scheduler, opts.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
          dispatchedTo = 'writeRuntimeGapPersistedOverride';
          result = { observerGapThresholdMin: gapThreshold, stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt, controlPanel };
          break;
        }
        case 'apply_ai_recommendation': {
          const cached = getAdvisorCache();
          if (!cached || !cached.result.ok) { res.status(422).json({ error: 'no_recommendation' }); return; }
          const ageMs = Date.now() - new Date(cached.cachedAt).getTime();
          if (ageMs > 30 * 60 * 1000) { res.status(422).json({ error: 'recommendation_stale' }); return; }
          const { recommendedIntervalMinutes, recommendedGapThreshold } = cached.result.recommendation;
          if (scheduler) scheduler.setControls({ baseIntervalMinutes: recommendedIntervalMinutes });
          const persistMeta = await writeRuntimeControls({ observerGapThresholdMin: recommendedGapThreshold, schedulerBaseIntervalMinutes: recommendedIntervalMinutes });
          const controlPanel = await opts.buildCP(scheduler, opts.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
          opts.setCachedControlPanel({ payload: controlPanel, expiresAt: Date.now() + CONTROL_PANEL_CACHE_MS });
          markAdvisorCacheApplied();
          dispatchedTo = 'POST /api/apply-ai-recommendation';
          result = { applied: true, intervalMinutes: recommendedIntervalMinutes, gapThreshold: recommendedGapThreshold, stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt, controlPanel };
          break;
        }
        case 'status_query': {
          const [logs, history, cpState] = await Promise.all([logCache.get(), readPublisherHistory(5), scheduler ? scheduler.getState() : null]);
          const trend = buildTrendInsightsPayload(logs, { windowDays: cpState?.trendWindowDays ?? 7, referenceBaseIntervalMinutes: cpState?.baseIntervalMinutes ?? ENV.RUN_INTERVAL_MINUTES, trendAdaptiveEnabled: cpState?.trendAdaptiveEnabled ?? true, ourAuthorSubstring: ENV.OUR_AUTHOR_SUBSTRING });
          const advisorCache = getAdvisorCache();
          const recommendation = advisorCache?.result.ok ? advisorCache.result.recommendation : null;
          result = buildStatusSummary({ schedulerEnabled: cpState?.enabled ?? true, baseIntervalMinutes: cpState?.baseIntervalMinutes ?? ENV.RUN_INTERVAL_MINUTES }, trend.multiplierBand, trend.sovPercent, history, recommendation);
          dispatchedTo = 'GET /api/control-panel + GET /api/trend-insights + GET /api/publisher-history';
          break;
        }
        default: { res.status(422).json({ error: 'unknown_intent' }); return; }
      }

      logger.info({ event: 'nl_command_dispatched', intent, dispatchedTo, dryRun: false }, '[NL Webhook] Command dispatched');
      res.json({ intent, dispatched_to: dispatchedTo, result, dry_run: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ event: 'nl_command_dispatch_error', intent, err }, '[NL Webhook] Dispatch failed');
      res.status(503).json({ error: 'dispatch_failed', reason: msg });
    }
  });

  return router;
}
