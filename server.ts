import express from "express";
import fs from "fs";
import { createServer as createHttpServer } from "http";
import path from "path";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { pathToFileURL } from "url";
import { createServer as createViteServer } from "vite";
import {
  getLogs,
  runObserver,
  runPublisher,
  initBotControls,
  registerSignalHandlers,
} from "./bot.js";
import { getSharedLogCache } from "./lib/logCache.js";
import { initSharedBrowser } from "./lib/sharedBrowser.js";
import { ENV } from "./config/env.js";
import { WATCH_IGNORED } from "./config/watch.js";
import { validateRuntimeContracts } from "./config/runtime-validation.js";
import { logger } from "./lib/logger.js";
import { LOG_EVENT } from "./lib/logEvents.js";
import { readPublisherHistory } from "./lib/publisherHistory.js";
import {
  startScheduler,
  type BotDeps,
  type ControlPanelPreset,
} from "./lib/scheduler.js";
import {
  readPersistedSchedulerControls,
  readPersistedNlWebhookEnabled,
} from "./lib/runtimeControls.js";
import { getResourceMetrics, checkResourceThresholds, runGarbageCollection } from "./lib/resourceMonitor.js";
import * as kakaoDb from "./lib/kakaoDb.js";
import type { PublisherRunDecision } from "./contracts/models.js";

// ── Route modules ─────────────────────────────────────────────────────────────
import { createHealthRouter } from "./routes/api/health.js";
import { createLogsRouter } from "./routes/api/logs.js";
import { createControlRouter, buildControlPanelResponse } from "./routes/api/control.js";
import { createAiRouter } from "./routes/api/ai.js";
import { createNlRouter } from "./routes/api/nl.js";
import { createKakaoRouter } from "./routes/api/kakao.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDefaultDeps(): BotDeps {
  if (ENV.DEV_SKIP_BOT) {
    return {
      runObserver: async () => ({ status: 'skipped' as const, currentGap: 0, gapThresholdMin: 0, reason: 'DEV_SKIP_BOT' } as any as import('./contracts/models.js').ActivityLog),
      runPublisher: async () => ({ success: false, message: 'DEV_SKIP_BOT', runId: 'dev', decision: 'skip' as PublisherRunDecision, artifactDir: null } as any as import('./lib/publisher/publisherRun.js').PublisherRunResult),
      getLogs,
      getPublisherHistory: readPublisherHistory,
    };
  }
  return { runObserver, runPublisher, getLogs, getPublisherHistory: readPublisherHistory };
}

type SchedulerController = ReturnType<typeof startScheduler>;

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(
  deps: BotDeps = getDefaultDeps(),
  scheduler?: SchedulerController,
  opts: { initialNlWebhookEnabled?: boolean } = {}
) {
  const app = express();
  let nlWebhookEnabledRuntime: boolean = opts.initialNlWebhookEnabled ?? ENV.NL_WEBHOOK_ENABLED;
  const getPublisherHistoryForSignals = deps.getPublisherHistory ?? readPublisherHistory;

  // Shared control-panel response cache (accessed by both control and AI routers)
  let cachedControlPanel: { payload: unknown; expiresAt: number } | null = null;

  app.use(cors());
  app.use(express.json());

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const NOOP = (_req: unknown, _res: unknown, next: () => void) => next();
  const shouldSkipRateLimit = ENV.IS_DEV || ENV.DEV_SKIP_BOT;
  const defaultLimiter = shouldSkipRateLimit ? NOOP : rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false });
  const logsLimiter = shouldSkipRateLimit ? NOOP : rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const analyticsLimiter = shouldSkipRateLimit ? NOOP : rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const publisherLimiter = shouldSkipRateLimit ? NOOP : rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false });
  const observerLimiter = shouldSkipRateLimit ? NOOP : rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });

  const SKIP_RATE_PATHS = ["/kakao-webhook", "/api/publisher-status", "/api/health/resources", "/api/health"];
  const SKIP_RATE_PATTERNS = [/\.js(\?|$)/, /\.css(\?|$)/, /\.svg(\?|$)/, /\.(png|jpg|jpeg|gif|ico|woff2?)(\?|$)/];

  app.use((req, res, next) => {
    if (SKIP_RATE_PATTERNS.some(p => p.test(req.path))) return next();
    if (SKIP_RATE_PATHS.includes(req.path)) return next();
    defaultLimiter(req, res, next);
  });

  // ── Shared state helpers ──────────────────────────────────────────────────
  const logCache = getSharedLogCache();

  function invalidatePollingCaches() {
    logCache.invalidate();
    cachedControlPanel = null;
  }

  // ── Mount routers ─────────────────────────────────────────────────────────
  app.use(createHealthRouter({ invalidatePollingCaches }));

  app.use(createLogsRouter({
    logCache,
    scheduler,
    getPublisherHistoryForSignals,
    logsLimiter,
    analyticsLimiter,
  }));

  app.use(createControlRouter({
    deps,
    scheduler,
    getNlWebhookEnabled: () => nlWebhookEnabledRuntime,
    setNlWebhookEnabled: (v) => { nlWebhookEnabledRuntime = v; },
    invalidatePollingCaches,
    getCachedControlPanel: () => cachedControlPanel,
    setCachedControlPanel: (v) => { cachedControlPanel = v; },
    observerLimiter,
    publisherLimiter,
  }));

  app.use(createAiRouter({
    logCache,
    scheduler,
    getNlWebhookEnabled: () => nlWebhookEnabledRuntime,
    setCachedControlPanel: (v) => { cachedControlPanel = v; },
    buildCP: buildControlPanelResponse,
  }));

  app.use(createNlRouter({
    deps,
    logCache,
    scheduler,
    getNlWebhookEnabled: () => nlWebhookEnabledRuntime,
    setCachedControlPanel: (v) => { cachedControlPanel = v; },
    buildCP: buildControlPanelResponse,
  }));

  app.use(createKakaoRouter());

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ event: "unhandled_route_error", err }, `[Express] Unhandled route error: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}

// ── Server startup ────────────────────────────────────────────────────────────

export async function startServer() {
  registerSignalHandlers();
  await validateRuntimeContracts();

  const skipBot = ENV.DEV_SKIP_BOT;

  if (skipBot) {
    logger.info('[DEV] BOT disabled — running API + frontend only. Set DEV_SKIP_BOT=false to re-enable.');
  } else {
    await kakaoDb.ensureReady();
    await initSharedBrowser();
  }

  const [persistedScheduler, persistedNlWebhookEnabled] = await Promise.all([
    readPersistedSchedulerControls(),
    readPersistedNlWebhookEnabled(),
    skipBot ? Promise.resolve() : initBotControls(),
  ]);
  const scheduler = skipBot ? undefined : startScheduler(getDefaultDeps(), ENV.RUN_INTERVAL_MINUTES, persistedScheduler);
  if (!skipBot && Object.keys(persistedScheduler).length > 0) {
    logger.info({ event: 'scheduler_controls_loaded', ...persistedScheduler }, '[Scheduler] Restored persisted controls');
  }

  const app = createApp(getDefaultDeps(), scheduler, {
    initialNlWebhookEnabled: persistedNlWebhookEnabled ?? ENV.NL_WEBHOOK_ENABLED,
  });

  if (!skipBot) {
    const gcResult = await runGarbageCollection();
    if (gcResult.artifacts.deletedCount > 0 || gcResult.logRotated > 0) {
      logger.info({ event: 'resource.gc_startup', artifactsDeleted: gcResult.artifacts.deletedCount, logRotated: gcResult.logRotated }, 'Startup garbage collection completed');
    }
  }
  const resourceWarnings = await checkResourceThresholds();
  if (resourceWarnings.length > 0) {
    logger.warn({ event: 'resource.startup_warnings', warnings: resourceWarnings }, `Resource warnings at startup: ${resourceWarnings.join('; ')}`);
  }

  // ── Periodic GC (production only) ──────────────────────────────────────────
  // Run every 6 hours to prune debug artifacts and rotate activity log.
  // Not run in dev/test to avoid interfering with artifact inspection.
  if (process.env.NODE_ENV === 'production' && !skipBot) {
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    setInterval(async () => {
      try {
        const result = await runGarbageCollection();
        logger.info(
          { event: 'resource.gc_periodic', artifactsDeleted: result.artifacts.deletedCount, logRotated: result.logRotated },
          'Periodic GC completed'
        );
      } catch (err) {
        logger.error({ event: 'resource.gc_periodic_failed', err }, 'Periodic GC failed');
      }
    }, SIX_HOURS_MS).unref(); // .unref() so the timer does not prevent clean process exit
  }

  const PORT = ENV.PORT;

  if (process.env.NODE_ENV !== "production") {
    const httpServer = createHttpServer(app);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        watch: { ignored: WATCH_IGNORED },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
    httpServer.listen(PORT, "0.0.0.0", () => {
      logger.info({ event: LOG_EVENT.serverStarted, port: PORT, host: "0.0.0.0" }, `Server running on http://localhost:${PORT}`);
    });
    return;
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Vite content-hashes all JS/CSS/asset filenames — long cache is safe.
    // index.html is served by the catch-all without caching so SW/meta updates propagate.
    app.use(express.static(distPath, { maxAge: '7d', etag: true, index: false }));
    app.get("*", (req, res) => { res.sendFile(path.join(distPath, "index.html")); });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logger.info({ event: LOG_EVENT.serverStarted, port: PORT, host: "0.0.0.0" }, `Server running on http://localhost:${PORT}`);
  });
}

const isDirectRun = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isDirectRun) {
  startServer();
}
