/**
 * bot.ts — re-export adapter
 *
 * This file was previously ~1,380 lines. It has been decomposed into focused
 * modules under lib/observer/ and lib/publisher/. This file now re-exports the
 * public API surface consumed by server.ts and the scheduler so existing import
 * paths remain stable without any changes to callers.
 *
 * Module map:
 *   lib/controls.ts                  — ObserverControls, PublisherControls, get/set
 *   lib/observer/policyLoader.ts     — loadObserverPolicy, getObserverControlsWithGap, persistGapThresholdPersistedOverride
 *   lib/observer/boardDiagnostics.ts — getBoardDiagnostics, attemptPpomppuLoginFromBoard
 *   lib/observer/parserSignal.ts     — collectParserSignal, captureBoardRowRegionArtifact, PARSER_OPTIONS
 *   lib/observer/boardParser.ts      — parseBoardRows ($$eval-compatible)
 *   lib/observer/observerRun.ts      — runObserver
 *   lib/publisher/publisherRun.ts    — runPublisher, PublisherRunResult
 *   lib/browserDebug.ts              — registerBrowserDebugHandlers
 *   lib/sharedBrowser.ts             — shutdownBrowser (via closeSharedBrowser)
 *   lib/logCache.ts                  — getLogs (via getSharedLogCache)
 *   lib/runtimeControls.ts           — persistGapThresholdPersistedOverride (writeRuntimeGapPersistedOverride)
 */

// ── Controls ────────────────────────────────────────────────────────────────
export type {
  ObserverControls,
  ObserverControlsWithGap,
  PublisherControls
} from './lib/controls.js';
export {
  getObserverControls,
  setObserverControls,
  getPublisherControls,
  setPublisherControls
} from './lib/controls.js';

// ── Policy loader ────────────────────────────────────────────────────────────
export { getObserverControlsWithGap } from './lib/observer/policyLoader.js';

// ── Persisted gap override ───────────────────────────────────────────────────
import { writeRuntimeGapPersistedOverride } from './lib/runtimeControls.js';
export async function persistGapThresholdPersistedOverride(value: number | null): Promise<void> {
  await writeRuntimeGapPersistedOverride(value);
}

// ── Parser options (consumed by /api/parser-metrics) ────────────────────────
export { PARSER_OPTIONS } from './lib/observer/parserSignal.js';

// ── Observer run ─────────────────────────────────────────────────────────────
export { runObserver } from './lib/observer/observerRun.js';

// ── Publisher run ─────────────────────────────────────────────────────────────
export type { PublisherRunResult } from './lib/publisher/publisherRun.js';
export { runPublisher } from './lib/publisher/publisherRun.js';

// ── Log access ───────────────────────────────────────────────────────────────
import { getSharedLogCache } from './lib/logCache.js';
export async function getLogs() {
  return getSharedLogCache().get();
}

// ── Browser lifecycle ─────────────────────────────────────────────────────────
import { closeSharedBrowser, isSharedBrowserReady, activeContexts } from './lib/sharedBrowser.js';
import { logger } from './lib/logger.js';

export async function shutdownBrowser(): Promise<void> {
  if (activeContexts.size > 0 || isSharedBrowserReady()) {
    logger.info(
      { event: 'browser.shutdown', activeContexts: activeContexts.size },
      'Shutting down shared browser'
    );
  }
  await closeSharedBrowser();
}

// ── Signal handlers ───────────────────────────────────────────────────────────
export function registerSignalHandlers(): void {
  let handled = false;
  const onSignal = (sig: string) => {
    if (handled) return;
    handled = true;
    logger.info({ event: 'signal.received', signal: sig }, `Received ${sig} — shutting down browser`);
    shutdownBrowser()
      .catch(() => null)
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

// ── Bot controls initialisation ───────────────────────────────────────────────
import { readPersistedObserverControls, readPersistedPublisherControls } from './lib/runtimeControls.js';
import { setObserverControls, setPublisherControls } from './lib/controls.js';

/**
 * Load persisted observer + publisher controls from disk and apply them.
 * Called once during server startup before the first scheduler tick fires.
 */
export async function initBotControls(): Promise<void> {
  const [obs, pub] = await Promise.all([
    readPersistedObserverControls(),
    readPersistedPublisherControls(),
  ]);
  if (Object.keys(obs).length > 0) {
    setObserverControls(obs);
    logger.info({ event: 'bot_controls_loaded', observer: obs }, '[Bot] Restored persisted observer controls');
  }
  if (Object.keys(pub).length > 0) {
    setPublisherControls(pub);
    logger.info({ event: 'bot_controls_loaded', publisher: pub }, '[Bot] Restored persisted publisher controls');
  }
}

// ── Log cache initialisation (side effect at module load) ─────────────────────
import { ENV } from './config/env.js';
import { initSharedLogCache } from './lib/logCache.js';

// Shared log cache — initialized at module load so all importers see the same instance.
initSharedLogCache(ENV.ACTIVITY_LOG_PATH, 15_000);
