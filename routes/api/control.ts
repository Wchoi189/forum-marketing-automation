/**
 * routes/api/control.ts
 *
 * Bot control routes:
 *   GET  /api/publisher-status
 *   POST /api/run-observer
 *   POST /api/run-publisher
 *   GET  /api/playbook/:workflowId
 *   GET  /api/control-panel
 *   POST /api/control-panel
 *   GET  /api/parser-metrics
 *   POST /api/parser-metrics
 *   GET  /api/drafts
 */

import { Router, type RequestHandler } from 'express';
import path from 'path';
import fs from 'fs';
import { ENV } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { LOG_EVENT } from '../../lib/logEvents.js';
import { extractErrorCode } from '../../lib/utils.js';
import {
  getObserverControls,
  setObserverControls,
  getPublisherControls,
  setPublisherControls,
} from '../../lib/controls.js';
import type { ObserverControlsWithGap } from '../../lib/controls.js';
import {
  getObserverControlsWithGap,
} from '../../lib/observer/policyLoader.js';
import { getPublisherStatus } from '../../lib/publisherStepStore.js';
import { PARSER_OPTIONS } from '../../lib/observer/parserSignal.js';
import {
  readPersistedObserverControls,
  readPersistedPublisherControls,
  readPersistedSchedulerControls,
  readPersistedNlWebhookEnabled,
  RuntimeControlsVersionConflictError,
  persistAllControlPanelSettings,
  writeRuntimeControls,
} from '../../lib/runtimeControls.js';
import {
  PRESET_CONFIG,
  type BotDeps,
  type AutoPublisherControls,
  type ControlPanelPreset,
} from '../../lib/scheduler.js';
import type { SchedulerController } from '../routerTypes.js';

// ── Shared control panel response builder ─────────────────────────────────────

export type ControlPanelResponse = {
  stateVersion: number;
  persistedAt: string | null;
  preset: ControlPanelPreset;
  nlWebhookEnabled: boolean;
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
    scheduleJitterMode: string;
    targetPublishIntervalMinutes: number;
    gapRecheckIntervalMinutes: number;
    running: boolean;
    nextTickEta?: string | null;
  };
  lastObserverResult?: {
    status: string;
    currentGap: number;
    requiredGap: number;
    checkedAt: string;
  } | null;
};

export async function buildControlPanelResponse(
  scheduler: SchedulerController | undefined,
  nlWebhookEnabled: boolean,
  stateMetaOverride?: { stateVersion: number; persistedAt: string | null }
): Promise<ControlPanelResponse> {
  const { readRuntimeControlsStateMeta } = await import('../../lib/runtimeControls.js');

  const [autoPublisherState, observer, publisher, stateMeta] = await Promise.all([
    (scheduler ? scheduler.getState() : Promise.resolve(null)).then((st) =>
      st ?? {
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
        gapRecheckIntervalMinutes: 3,
        running: false,
        lastObserverResult: null,
      }
    ),
    getObserverControlsWithGap(),
    Promise.resolve(getPublisherControls()),
    stateMetaOverride ? Promise.resolve(stateMetaOverride) : readRuntimeControlsStateMeta(),
  ]);

  return {
    stateVersion: stateMeta.stateVersion,
    persistedAt: stateMeta.persistedAt,
    preset: scheduler?.getPreset() ?? 'balanced',
    nlWebhookEnabled,
    observer,
    publisher,
    autoPublisher: autoPublisherState,
    lastObserverResult: autoPublisherState.lastObserverResult ?? null,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export type ControlRouterDeps = {
  deps: BotDeps;
  scheduler: SchedulerController | undefined;
  getNlWebhookEnabled: () => boolean;
  setNlWebhookEnabled: (v: boolean) => void;
  invalidatePollingCaches: () => void;
  getCachedControlPanel: () => { payload: unknown; expiresAt: number } | null;
  setCachedControlPanel: (v: { payload: unknown; expiresAt: number } | null) => void;
  observerLimiter: RequestHandler;
  publisherLimiter: RequestHandler;
};

const CONTROL_PANEL_CACHE_MS = 10_000;
const PLAYBOOK_CACHE_MS = 60_000;

export function createControlRouter(opts: ControlRouterDeps): Router {
  const { deps, scheduler } = opts;
  const router = Router();

  let cachedPlaybook: { key: string; payload: unknown; expiresAt: number } | null = null;

  // ── /api/publisher-status ───────────────────────────────────────────────────
  router.get('/api/publisher-status', (_req, res) => {
    res.json(getPublisherStatus());
  });

  // ── /api/run-observer ───────────────────────────────────────────────────────
  router.post('/api/run-observer', opts.observerLimiter, async (req, res) => {
    try {
      const log = await deps.runObserver();
      if (log.status === 'error') {
        logger.error(
          { event: LOG_EVENT.apiRunObserverFailed, status: 'error', errorCode: extractErrorCode(log.error), error: log.error },
          'run-observer returned error status'
        );
        res.status(500).json({ success: false, action: 'observer', error: log.error, log });
      } else {
        opts.invalidatePollingCaches();
        res.json({ success: true, action: 'observer', log });
      }
    } catch (error: any) {
      logger.error(
        { event: LOG_EVENT.apiRunObserverFailed, status: 'error', errorCode: extractErrorCode(error), err: error },
        'run-observer request failed'
      );
      res.status(500).json({ success: false, action: 'observer', error: `[Observer] ${String(error?.message ?? error)}` });
    }
  });

  // ── /api/run-publisher ──────────────────────────────────────────────────────
  router.post('/api/run-publisher', opts.publisherLimiter, async (req, res) => {
    const { force } = req.body;
    try {
      const result = await deps.runPublisher(force);
      if (!result.success) {
        logger.error(
          { event: LOG_EVENT.apiRunPublisherFailed, status: 'error', runId: result.runId, decision: result.decision, errorCode: extractErrorCode(result.message), error: result.message },
          'run-publisher returned unsuccessful result'
        );
        res.status(500).json({ success: false, action: 'publisher', force: Boolean(force), message: result.message, error: result.message, log: result.log, runId: result.runId, decision: result.decision, artifactDir: result.artifactDir });
      } else {
        opts.invalidatePollingCaches();
        res.json({ ...result, action: 'publisher', force: Boolean(force) });
      }
    } catch (error: any) {
      logger.error(
        { event: LOG_EVENT.apiRunPublisherFailed, status: 'error', errorCode: extractErrorCode(error), force: Boolean(req.body?.force), err: error },
        'run-publisher request failed'
      );
      res.status(500).json({ success: false, action: 'publisher', force: Boolean(req.body?.force), error: `[Publisher] ${String(error?.message ?? error)}` });
    }
  });

  // ── /api/playbook/:workflowId ───────────────────────────────────────────────
  router.get('/api/playbook/:workflowId', async (req, res) => {
    try {
      const { workflowId } = req.params;
      if (!/^[a-zA-Z0-9-]+$/.test(workflowId)) { res.status(400).json({ error: 'Invalid workflow ID' }); return; }
      const cacheKey = workflowId;
      if (cachedPlaybook && cachedPlaybook.key === cacheKey && Date.now() < cachedPlaybook.expiresAt) {
        res.json(cachedPlaybook.payload); return;
      }
      const playbookPath = path.join(ENV.PROJECT_ROOT, '.planning/spec-kit/manifest', `playbook.${workflowId}.json`);
      const content = await fs.promises.readFile(playbookPath, 'utf-8');
      const playbook = JSON.parse(content);
      cachedPlaybook = { key: cacheKey, payload: playbook, expiresAt: Date.now() + PLAYBOOK_CACHE_MS };
      res.json(playbook);
    } catch (error: any) {
      logger.error({ event: 'playbook_fetch_failed', error }, 'Failed to fetch playbook');
      res.status(500).json({ error: 'Failed to load playbook' });
    }
  });

  // ── /api/drafts ─────────────────────────────────────────────────────────────
  router.get('/api/drafts', (_req, res) => {
    res.json([
      { title: '[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)', timestamp: '2026-03-30 10:00:00', id: 'draft_1' },
      { title: '[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)', timestamp: '2026-03-29 15:30:00', id: 'draft_2' }
    ]);
  });

  // ── GET /api/control-panel ──────────────────────────────────────────────────
  router.get('/api/control-panel', async (_req, res) => {
    const cached = opts.getCachedControlPanel();
    if (cached && Date.now() < cached.expiresAt) { res.json(cached.payload); return; }
    const payload = await buildControlPanelResponse(scheduler, opts.getNlWebhookEnabled());
    opts.setCachedControlPanel({ payload, expiresAt: Date.now() + CONTROL_PANEL_CACHE_MS });
    res.json(payload);
  });

  // ── POST /api/control-panel ─────────────────────────────────────────────────
  router.post('/api/control-panel', async (req, res) => {
    const body = (req.body ?? {}) as {
      expectedVersion?: number;
      preset?: ControlPanelPreset;
      nlWebhookEnabled?: boolean;
      observer?: Partial<ObserverControlsWithGap>;
      publisher?: Partial<ReturnType<typeof getPublisherControls>>;
      autoPublisher?: Partial<AutoPublisherControls> & { enabled?: boolean };
    };

    if (body.expectedVersion !== undefined && (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0)) {
      res.status(400).json({ error: 'expectedVersion must be an integer >= 0' }); return;
    }

    const prevNlWebhookEnabledRuntime = opts.getNlWebhookEnabled();
    const prevObserverControls = getObserverControls();
    const prevPublisherControls = getPublisherControls();
    const prevSchedulerPreset = scheduler?.getPreset();
    const prevSchedulerState = scheduler ? await scheduler.getState() : null;

    try {
      if (typeof body.nlWebhookEnabled === 'boolean') opts.setNlWebhookEnabled(body.nlWebhookEnabled);

      const rawObserver = body.observer ?? {};
      const gapPersistedOverride = (rawObserver as { gapPersistedOverride?: number | null }).gapPersistedOverride;
      const gapSourcePin = (rawObserver as { gapSourcePin?: 'env' | 'spec' | null }).gapSourcePin;
      const observerPacing: Parameters<typeof setObserverControls>[0] = { ...rawObserver };
      delete (observerPacing as { gapPersistedOverride?: unknown }).gapPersistedOverride;
      delete (observerPacing as { gapSourcePin?: unknown }).gapSourcePin;
      delete (observerPacing as { gapThresholdMin?: unknown }).gapThresholdMin;
      delete (observerPacing as { gapThresholdSpecBaseline?: unknown }).gapThresholdSpecBaseline;
      delete (observerPacing as { gapUsesEnvOverride?: unknown }).gapUsesEnvOverride;
      delete (observerPacing as { gapSource?: unknown }).gapSource;

      if (Object.prototype.hasOwnProperty.call(rawObserver, 'gapPersistedOverride')) {
        const v = gapPersistedOverride;
        if (v !== null && (typeof v !== 'number' || !Number.isInteger(v))) {
          logger.warn({ event: LOG_EVENT.apiControlPanelValidationFailed, status: 'error', field: 'gapPersistedOverride', reason: 'not_integer_or_null', value: v }, 'Control panel validation failed');
          res.status(400).json({ error: 'gapPersistedOverride must be an integer 1–50 or null' }); return;
        }
        if (v !== null && (v < 1 || v > 50)) {
          logger.warn({ event: LOG_EVENT.apiControlPanelValidationFailed, status: 'error', field: 'gapPersistedOverride', reason: 'out_of_range', value: v }, 'Control panel validation failed');
          res.status(400).json({ error: 'gapPersistedOverride must be an integer 1–50 or null' }); return;
        }
      }

      if (Object.prototype.hasOwnProperty.call(rawObserver, 'gapSourcePin')) {
        const pin = gapSourcePin;
        if (pin !== null && pin !== 'env' && pin !== 'spec') {
          res.status(400).json({ error: "gapSourcePin must be 'env', 'spec', or null" }); return;
        }
      }

      setObserverControls(observerPacing);
      if (body.publisher && typeof body.publisher === 'object') setPublisherControls(body.publisher);

      const hasPreset = Boolean(scheduler && body.preset && PRESET_CONFIG[body.preset]);
      if (scheduler && body.preset && PRESET_CONFIG[body.preset]) {
        const presetConfig = PRESET_CONFIG[body.preset];
        setObserverControls({ ...presetConfig.observer, ...observerPacing });
        scheduler.applyPreset(body.preset);
        scheduler.setControls(presetConfig.autoPublisher);
      }

      if (scheduler && body.autoPublisher) {
        if (Object.prototype.hasOwnProperty.call(body.autoPublisher, 'enabled')) {
          scheduler.setEnabled(Boolean(body.autoPublisher.enabled));
        }
        if (!hasPreset) scheduler.setControls(body.autoPublisher);
      }

      const autoPublisherState = (scheduler ? await scheduler.getState() : null) ?? {
        enabled: true, baseIntervalMinutes: ENV.RUN_INTERVAL_MINUTES, effectiveIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
        quietHoursStart: 3, quietHoursEnd: 5, quietHoursMultiplier: 1.8,
        activeHoursStart: 8, activeHoursEnd: 23, activeHoursMultiplier: 0.8,
        trendAdaptiveEnabled: true, trendWindowDays: 7, trendRecalibrationDays: 7,
        scheduleJitterPercent: ENV.SCHEDULER_JITTER_PERCENT, scheduleJitterMode: ENV.SCHEDULER_JITTER_MODE,
        targetPublishIntervalMinutes: 0, gapRecheckIntervalMinutes: 3, running: false
      };

      const currentObserver = await getObserverControlsWithGap();
      const currentPublisher = getPublisherControls();
      const persistMeta = await persistAllControlPanelSettings({
        expectedVersion: body.expectedVersion,
        nlWebhookEnabled: typeof body.nlWebhookEnabled === 'boolean' ? body.nlWebhookEnabled : undefined,
        gapPersistedOverride: Object.prototype.hasOwnProperty.call(rawObserver, 'gapPersistedOverride') ? (gapPersistedOverride ?? null) : undefined,
        gapSourcePin: Object.prototype.hasOwnProperty.call(rawObserver, 'gapSourcePin') ? (gapSourcePin ?? null) : undefined,
        schedulerEnabled: autoPublisherState.enabled,
        schedulerControls: {
          baseIntervalMinutes: autoPublisherState.baseIntervalMinutes,
          quietHoursStart: autoPublisherState.quietHoursStart,
          quietHoursEnd: autoPublisherState.quietHoursEnd,
          quietHoursMultiplier: autoPublisherState.quietHoursMultiplier,
          activeHoursStart: autoPublisherState.activeHoursStart,
          activeHoursEnd: autoPublisherState.activeHoursEnd,
          activeHoursMultiplier: autoPublisherState.activeHoursMultiplier,
          trendAdaptiveEnabled: autoPublisherState.trendAdaptiveEnabled,
          trendWindowDays: autoPublisherState.trendWindowDays,
          trendRecalibrationDays: autoPublisherState.trendRecalibrationDays,
          scheduleJitterPercent: autoPublisherState.scheduleJitterPercent,
          scheduleJitterMode: autoPublisherState.scheduleJitterMode,
          targetPublishIntervalMinutes: autoPublisherState.targetPublishIntervalMinutes,
          gapRecheckIntervalMinutes: autoPublisherState.gapRecheckIntervalMinutes,
        },
        preset: scheduler?.getPreset() ?? 'balanced',
        observerControls: { enabled: currentObserver.enabled, minPreVisitDelayMs: currentObserver.minPreVisitDelayMs, maxPreVisitDelayMs: currentObserver.maxPreVisitDelayMs, minIntervalBetweenRunsMs: currentObserver.minIntervalBetweenRunsMs },
        publisherControls: { draftItemIndex: currentPublisher.draftItemIndex },
      });

      const payload = await buildControlPanelResponse(scheduler, opts.getNlWebhookEnabled(), { stateVersion: persistMeta.stateVersion, persistedAt: persistMeta.persistedAt });
      opts.setCachedControlPanel({ payload, expiresAt: Date.now() + CONTROL_PANEL_CACHE_MS });
      res.json(payload);
    } catch (error: unknown) {
      const [persistedObserver, persistedPublisher, persistedScheduler, persistedNlWebhookEnabled] = await Promise.all([
        readPersistedObserverControls(), readPersistedPublisherControls(), readPersistedSchedulerControls(), readPersistedNlWebhookEnabled(),
      ]);

      setObserverControls(Object.keys(persistedObserver).length > 0 ? persistedObserver : prevObserverControls);
      setPublisherControls(Object.keys(persistedPublisher).length > 0 ? persistedPublisher : prevPublisherControls);
      opts.setNlWebhookEnabled(persistedNlWebhookEnabled ?? prevNlWebhookEnabledRuntime);

      if (scheduler) {
        if (Object.keys(persistedScheduler).length > 0) {
          if (typeof persistedScheduler.preset === 'string' && persistedScheduler.preset in PRESET_CONFIG) {
            scheduler.setPreset(persistedScheduler.preset as ControlPanelPreset);
          }
          if (typeof persistedScheduler.enabled === 'boolean') scheduler.setEnabled(persistedScheduler.enabled);
          scheduler.setControls({
            baseIntervalMinutes: persistedScheduler.baseIntervalMinutes, quietHoursStart: persistedScheduler.quietHoursStart,
            quietHoursEnd: persistedScheduler.quietHoursEnd, quietHoursMultiplier: persistedScheduler.quietHoursMultiplier,
            activeHoursStart: persistedScheduler.activeHoursStart, activeHoursEnd: persistedScheduler.activeHoursEnd,
            activeHoursMultiplier: persistedScheduler.activeHoursMultiplier, trendAdaptiveEnabled: persistedScheduler.trendAdaptiveEnabled,
            trendWindowDays: persistedScheduler.trendWindowDays, trendRecalibrationDays: persistedScheduler.trendRecalibrationDays,
            scheduleJitterPercent: persistedScheduler.scheduleJitterPercent, scheduleJitterMode: persistedScheduler.scheduleJitterMode,
            targetPublishIntervalMinutes: persistedScheduler.targetPublishIntervalMinutes, gapRecheckIntervalMinutes: persistedScheduler.gapRecheckIntervalMinutes,
          });
        } else if (prevSchedulerState) {
          scheduler.setPreset(prevSchedulerPreset ?? 'balanced');
          scheduler.setControls({
            baseIntervalMinutes: prevSchedulerState.baseIntervalMinutes, quietHoursStart: prevSchedulerState.quietHoursStart,
            quietHoursEnd: prevSchedulerState.quietHoursEnd, quietHoursMultiplier: prevSchedulerState.quietHoursMultiplier,
            activeHoursStart: prevSchedulerState.activeHoursStart, activeHoursEnd: prevSchedulerState.activeHoursEnd,
            activeHoursMultiplier: prevSchedulerState.activeHoursMultiplier, trendAdaptiveEnabled: prevSchedulerState.trendAdaptiveEnabled,
            trendWindowDays: prevSchedulerState.trendWindowDays, trendRecalibrationDays: prevSchedulerState.trendRecalibrationDays,
            scheduleJitterPercent: prevSchedulerState.scheduleJitterPercent, scheduleJitterMode: prevSchedulerState.scheduleJitterMode,
            targetPublishIntervalMinutes: prevSchedulerState.targetPublishIntervalMinutes, gapRecheckIntervalMinutes: prevSchedulerState.gapRecheckIntervalMinutes,
          });
          scheduler.setEnabled(prevSchedulerState.enabled);
        }
      }

      if (error instanceof RuntimeControlsVersionConflictError) {
        const latest = await buildControlPanelResponse(scheduler, opts.getNlWebhookEnabled());
        res.status(409).json({ error: 'CONTROL_PANEL_VERSION_CONFLICT', expectedVersion: error.expectedVersion, currentVersion: error.currentVersion, currentState: latest });
        return;
      }

      logger.error({ event: LOG_EVENT.apiControlPanelPersistFailed, status: 'error', errorCode: extractErrorCode(error), err: error }, 'control-panel persistence failed');
      res.status(500).json({ error: '[ControlPanel] Failed to persist control panel settings' });
    }
  });

  // ── /api/parser-metrics ─────────────────────────────────────────────────────
  router.get('/api/parser-metrics', (_req, res) => {
    res.json({
      customParserEnabled: ENV.CUSTOM_PARSER_ENABLED,
      browserRequestLogging: ENV.BROWSER_REQUEST_LOGGING,
      parserOptions: {
        maxDepth: PARSER_OPTIONS.maxDepth,
        maxSiblingsPerNode: PARSER_OPTIONS.maxSiblingsPerNode,
        maxTotalNodes: PARSER_OPTIONS.maxTotalNodes,
        maxTextLengthPerNode: PARSER_OPTIONS.maxTextLengthPerNode
      }
    });
  });

  router.post('/api/parser-metrics', async (req, res) => {
    const { customParserEnabled, browserRequestLogging, logLevel, parserDetailedLogging } = req.body as {
      customParserEnabled?: boolean; browserRequestLogging?: boolean; logLevel?: string; parserDetailedLogging?: boolean;
    };
    try {
      if (typeof customParserEnabled === 'boolean') ENV.CUSTOM_PARSER_ENABLED = customParserEnabled;
      if (typeof browserRequestLogging === 'boolean') ENV.BROWSER_REQUEST_LOGGING = browserRequestLogging;
      if (typeof logLevel === 'string' && ['error', 'warn', 'info', 'debug'].includes(logLevel)) ENV.LOG_LEVEL = logLevel;
      if (typeof parserDetailedLogging === 'boolean') ENV.PARSER_DETAILED_LOGGING = parserDetailedLogging;

      const currentState = await buildControlPanelResponse(scheduler, opts.getNlWebhookEnabled());
      await persistAllControlPanelSettings({
        expectedVersion: undefined,
        customParserEnabled: typeof customParserEnabled === 'boolean' ? customParserEnabled : undefined,
        browserRequestLogging: typeof browserRequestLogging === 'boolean' ? browserRequestLogging : undefined,
        logLevel: typeof logLevel === 'string' ? logLevel : undefined,
        parserDetailedLogging: typeof parserDetailedLogging === 'boolean' ? parserDetailedLogging : undefined,
        gapPersistedOverride: undefined, gapSourcePin: undefined, nlWebhookEnabled: undefined,
        schedulerEnabled: currentState.autoPublisher.enabled,
        schedulerControls: {
          baseIntervalMinutes: currentState.autoPublisher.baseIntervalMinutes,
          quietHoursStart: currentState.autoPublisher.quietHoursStart, quietHoursEnd: currentState.autoPublisher.quietHoursEnd,
          quietHoursMultiplier: currentState.autoPublisher.quietHoursMultiplier,
          activeHoursStart: currentState.autoPublisher.activeHoursStart, activeHoursEnd: currentState.autoPublisher.activeHoursEnd,
          activeHoursMultiplier: currentState.autoPublisher.activeHoursMultiplier,
          trendAdaptiveEnabled: currentState.autoPublisher.trendAdaptiveEnabled,
          trendWindowDays: currentState.autoPublisher.trendWindowDays,
          trendRecalibrationDays: currentState.autoPublisher.trendRecalibrationDays,
          scheduleJitterPercent: currentState.autoPublisher.scheduleJitterPercent,
          scheduleJitterMode: currentState.autoPublisher.scheduleJitterMode as import('../../lib/scheduleJitter.js').ScheduleJitterMode,
          targetPublishIntervalMinutes: currentState.autoPublisher.targetPublishIntervalMinutes,
          gapRecheckIntervalMinutes: currentState.autoPublisher.gapRecheckIntervalMinutes,
        },
        preset: currentState.preset,
        observerControls: { enabled: currentState.observer.enabled, minPreVisitDelayMs: currentState.observer.minPreVisitDelayMs, maxPreVisitDelayMs: currentState.observer.maxPreVisitDelayMs, minIntervalBetweenRunsMs: currentState.observer.minIntervalBetweenRunsMs },
        publisherControls: { draftItemIndex: currentState.publisher.draftItemIndex },
      });
      logger.info({ event: 'parser_settings_updated', customParserEnabled: ENV.CUSTOM_PARSER_ENABLED, browserRequestLogging: ENV.BROWSER_REQUEST_LOGGING, logLevel: ENV.LOG_LEVEL, parserDetailedLogging: ENV.PARSER_DETAILED_LOGGING }, '[Settings] Parser settings updated');
      res.json({ customParserEnabled: ENV.CUSTOM_PARSER_ENABLED, browserRequestLogging: ENV.BROWSER_REQUEST_LOGGING, logLevel: ENV.LOG_LEVEL, parserDetailedLogging: ENV.PARSER_DETAILED_LOGGING });
    } catch (err) {
      logger.error({ event: 'parser_settings_update_error', err }, '[Settings] Failed to update parser settings');
      res.status(500).json({ error: 'settings_update_failed' });
    }
  });

  return router;
}
