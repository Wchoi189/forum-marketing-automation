/**
 * lib/publisher/publisherRun.ts
 *
 * Publisher entry point — concurrency guard, gap-policy check, browser flow,
 * and run recording.
 */

import { randomUUID } from 'node:crypto';
import path from 'path';
import fs from 'fs/promises';
import type { BrowserContext } from 'playwright';
import type { ActivityLog, PublisherRunDecision } from '../../contracts/models.js';
import { ENV } from '../../config/env.js';
import { logger } from '../logger.js';
import { LOG_EVENT } from '../logEvents.js';
import { extractErrorCode } from '../utils.js';
import { appendPublisherHistoryEntry } from '../publisherHistory.js';
import { BOT_MAX_WAIT_MS } from './core/timeouts.js';
import {
  publisherArtifactDirForRun,
  publisherDebugScreenshot,
  publisherFailureScreenshot
} from './diagnostics.js';
import { runPublisherFlow } from './flow/runPublisherFlow.js';
import type { DraftRowSelectionDiagnostics, PlaybookRuntimeContext } from '../playbookRunner.js';
import { setPublisherStep, setPublisherRunning, playbookStepToCanvasStep } from '../publisherStepStore.js';
import { createBrowserContext, saveStorageState } from '../sharedBrowser.js';
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from '../playwright/browser-eval-polyfill.js';
import { sendSlackNotification } from '../notifications.js';
import { registerBrowserDebugHandlers } from '../browserDebug.js';
import { getBoardDiagnostics, attemptPpomppuLoginFromBoard } from '../observer/boardDiagnostics.js';
import { loadObserverPolicy } from '../observer/policyLoader.js';
import { getPublisherControls } from '../controls.js';
import { runObserver } from '../observer/observerRun.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PublisherRunResult = {
  success: boolean;
  message: string;
  log?: ActivityLog;
  runId: string;
  decision: PublisherRunDecision;
  /** Project-relative artifact dir when publisher entered browser flow; null on gap-policy skip etc. */
  artifactDir: string | null;
  /** Gap at the time of the run — set for gap_policy skips and publisher errors where gap was safe */
  gapInfo?: {
    currentGap: number;
    requiredGap: number;
  };
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Prevents two concurrent publisher browser sessions from launching simultaneously. */
let activePublisherRun: Promise<PublisherRunResult> | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function addStealthInitScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: BROWSER_EVAL_NAME_POLYFILL_SCRIPT });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

function formatDraftRowSelectionSuffix(selection?: DraftRowSelectionDiagnostics): string {
  if (!selection) return '';
  const label = selection.clickedLabel ? ` label="${selection.clickedLabel}"` : '';
  return ` [draft-row requested=${selection.requestedDraftIndex} raw=${selection.clickedRawRowIndex} selectable=${selection.selectableRows}/${selection.totalRows}${label}]`;
}

function appendDraftRowSelection(message: string, selection?: DraftRowSelectionDiagnostics): string {
  if (!selection || message.includes('[draft-row requested=')) return message;
  return `${message}${formatDraftRowSelectionSuffix(selection)}`;
}

async function recordPublisherRun(entry: {
  force: boolean;
  success: boolean;
  message: string;
  runId: string;
  artifactDir: string | null;
  decision: PublisherRunDecision;
}): Promise<void> {
  const rel =
    entry.artifactDir === null || entry.artifactDir === undefined
      ? null
      : path.relative(ENV.PROJECT_ROOT, entry.artifactDir).replace(/\\/g, '/');
  await appendPublisherHistoryEntry({
    at: new Date().toISOString(),
    success: entry.success,
    force: entry.force,
    message: entry.message.slice(0, 500),
    runId: entry.runId,
    artifactDir: rel,
    decision: entry.decision
  }).catch(() => null);
}

// ---------------------------------------------------------------------------
// Core publisher execution
// ---------------------------------------------------------------------------

async function _executePublisherRun(force: boolean): Promise<PublisherRunResult> {
  const runId = randomUUID();
  const publisherStartedAt = Date.now();
  let log: ActivityLog | undefined;
  let debugDir: string | null = null;

  setPublisherRunning(true);

  const finish = async (
    success: boolean,
    message: string,
    decision: PublisherRunDecision,
    outLog?: ActivityLog
  ) => {
    setPublisherRunning(false);
    const artifactAbs = debugDir;
    if (decision !== 'gap_policy') {
      await recordPublisherRun({
        force,
        success,
        message,
        runId,
        artifactDir: artifactAbs,
        decision
      });
    }
    const artifactRel =
      artifactAbs === null || artifactAbs === undefined
        ? null
        : path.relative(ENV.PROJECT_ROOT, artifactAbs).replace(/\\/g, '/');
    const durationMs = Date.now() - publisherStartedAt;
    logger.info(
      { event: LOG_EVENT.publisherRunFinished, runId, decision, status: success ? 'success' : 'error', durationMs, force, artifactDir: artifactRel },
      'Publisher run completed'
    );

    // Filter noise: don't notify for normal gap-check skips
    if (success) {
      const emoji = decision === 'dry_run' ? '🚧' : '✅';
      const label = decision === 'dry_run' ? 'Dry Run' : 'Success';
      await sendSlackNotification(`${emoji} *Publisher ${label}* [${decision}]\n> ${message}${force ? ' (Force)' : ''}`);
    } else if (decision !== 'gap_policy') {
      await sendSlackNotification(`❌ *Publisher Failed* [${decision}]\n> ${message}${force ? ' (Force)' : ''}`);
    }

    return { success, message, log: outLog, runId, decision, artifactDir: artifactRel };
  };

  try {
    const policy = await loadObserverPolicy();
    log = await runObserver();

    if (log.status === 'error') {
      return await finish(false, log.error || '[Observer] Observer failed', 'observer_error', log);
    }

    if (force && !ENV.MANUAL_OVERRIDE_ENABLED) {
      return await finish(
        false,
        '[Publisher] Manual override is disabled by environment policy (MANUAL_OVERRIDE_ENABLED=false)',
        'manual_override_disabled',
        log
      );
    }

    if (!force && log.status !== 'safe') {
      const gap = log.current_gap_count;
      const need = policy.gapThresholdMin;
      logger.info(
        { event: LOG_EVENT.publisherRunSkipped, runId, decision: 'gap_policy', status: 'unsafe', currentGap: gap, requiredGap: need, force, parseUnsafe: Boolean(log.error) },
        '[Publisher] gap_policy skip'
      );
      const result = await finish(
        false,
        log.error || '[Publisher] Gap is too small to publish (safety / gap policy)',
        'gap_policy',
        log
      );
      return {
        ...result,
        gapInfo: { currentGap: gap, requiredGap: need }
      };
    }

    debugDir = publisherArtifactDirForRun();
    let traceStarted = false;
    /** When tracing ran: persist zip on failure or when success-path sampling hits. */
    let persistPublisherTraceZip = false;
    let publisherBrowserFlowFailed = false;

    let context: BrowserContext | null = null;
    context = createBrowserContext({ loadSavedStorageState: true });
    await addStealthInitScripts(context);
    if (debugDir) {
      await fs.mkdir(debugDir, { recursive: true });
    }
    if (debugDir && ENV.PUBLISHER_DEBUG_TRACE) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      traceStarted = true;
    }

    let page: import('playwright').Page | null = null;
    let playbookRuntime: PlaybookRuntimeContext | null = null;
    try {
      page = await context.newPage();
      registerBrowserDebugHandlers(page, 'Publisher');

      logger.info({ event: LOG_EVENT.publisherRunStarted, runId, boardUrl: policy.boardUrl, force }, 'Running Publisher');
      if (debugDir) {
        logger.info({ event: LOG_EVENT.publisherArtifactsDir, runId, debugDir }, '[Publisher] debug artifacts dir');
      }
      setPublisherStep('navigate');
      // Navigate to the page
      const response = await page.goto(policy.boardUrl, { waitUntil: 'domcontentloaded', timeout: ENV.BOT_NAV_TIMEOUT_MS });
      const statusCode = response?.status() ?? 0;
      const diagnostics = await getBoardDiagnostics(page);
      if (statusCode >= 400 || diagnostics.isForbidden) {
        throw new Error(
          `PUBLISHER_BOARD_BLOCKED: status=${statusCode} title="${diagnostics.title}" url="${diagnostics.url}"` +
            (statusCode === 403
              ? ' | hint=403_often_bot_or_waf_not_login — try headed Chrome, custom BROWSER_USER_AGENT, or non-datacenter IP'
              : '')
        );
      }
      if (diagnostics.writeButtonCount === 0) {
        setPublisherStep('login-page');
        const loginRecovered = await attemptPpomppuLoginFromBoard(page, policy.boardUrl).catch(() => false);
        if (!loginRecovered) {
          const latest = await getBoardDiagnostics(page);
          const reason = latest.loginPromptVisible
            ? 'login_required_or_session_missing'
            : 'write_button_not_visible';
          throw new Error(
            `PUBLISHER_WRITE_ENTRY_UNAVAILABLE: reason=${reason} title="${latest.title}" url="${latest.url}" rows=${latest.rowCount}`
          );
        }
      }

      await publisherDebugScreenshot(page, debugDir, '01-board');
      const publisherControls = getPublisherControls();
      playbookRuntime = {
        boardEntryUrl: policy.boardUrl,
        draftItemIndex: publisherControls.draftItemIndex,
        verifyTextTimeoutMs: ENV.PUBLISHER_POST_SUBMIT_WAIT_MS
      };
      const flow = await runPublisherFlow({
        page,
        runtime: playbookRuntime,
        postSubmitWaitMs: ENV.PUBLISHER_POST_SUBMIT_WAIT_MS,
        dryRunMode: ENV.DRY_RUN_MODE,
        onStepStart: (stepId) => {
          setPublisherStep(playbookStepToCanvasStep(stepId));
        },
        onStepEnd: async (stepId) => {
          // Diagnostic screenshot after each step for visibility into intermediate page states
          if (page && debugDir) await publisherDebugScreenshot(page, debugDir, `step-${stepId}`);
        },
        onBeforeSubmit: async () => {
          if (page) await publisherDebugScreenshot(page, debugDir, '05-before-submit');
        },
        onSuccess: async () => {
          if (page) await publisherDebugScreenshot(page, debugDir, '06-success');
        }
      });
      if (flow.decision === 'dry_run') {
        logger.info({ event: LOG_EVENT.publisherSubmitSkipped, runId, decision: flow.decision, status: 'success' }, 'Dry-run mode enabled. Submit click intentionally skipped.');
      } else {
        logger.info({ event: LOG_EVENT.publisherSubmitCompleted, runId, decision: flow.decision, status: 'success' }, 'Draft loaded, verified, and submitted.');
      }
      const samplePct = ENV.PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT;
      persistPublisherTraceZip =
        samplePct > 0 && Math.random() * 100 < samplePct;
      const flowMessage = appendDraftRowSelection(flow.message, playbookRuntime.draftRowSelection);
      const successResult = await finish(true, flowMessage, flow.decision, log);
      return { ...successResult, gapInfo: { currentGap: 0, requiredGap: policy.gapThresholdMin } };
    } catch (innerErr) {
      publisherBrowserFlowFailed = true;
      persistPublisherTraceZip = true;
      await publisherFailureScreenshot(page, debugDir);
      const maybeError = innerErr as { message?: unknown };
      if (playbookRuntime?.draftRowSelection && typeof maybeError.message === 'string') {
        maybeError.message = appendDraftRowSelection(maybeError.message, playbookRuntime.draftRowSelection);
      }
      throw innerErr;
    } finally {
      if (traceStarted && debugDir) {
        const tracePath = path.join(debugDir, 'trace.zip');
        if (publisherBrowserFlowFailed || persistPublisherTraceZip) {
          await context!.tracing.stop({ path: tracePath }).catch(() => null);
          logger.info({ event: LOG_EVENT.publisherArtifactsTrace, runId, tracePath }, '[Publisher] debug trace');
        } else {
          await context!.tracing.stop().catch(() => null);
          logger.debug(
            {
              event: LOG_EVENT.publisherArtifactsTraceDiscarded,
              runId,
              reason: 'success_not_sampled',
              traceSuccessSamplePercent: ENV.PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT
            },
            '[Publisher] trace discarded (success not sampled)'
          );
        }
      }
      await saveStorageState(context!).catch(() => null);
      await context!.close().catch(() => null);
    }
  } catch (error: any) {
    logger.error(
      { event: LOG_EVENT.publisherRunFailed, runId, status: 'error', errorCode: extractErrorCode(error), durationMs: Date.now() - publisherStartedAt, err: error },
      'Publisher Error'
    );
    const errorResult = await finish(false, `[Publisher] ${String(error?.message ?? error)}`, 'publisher_error', log);
    if (log?.status === 'safe' && log.gap_threshold_min !== undefined) {
      return { ...errorResult, gapInfo: { currentGap: log.current_gap_count, requiredGap: log.gap_threshold_min } };
    }
    return errorResult;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the publisher. Concurrent calls are rejected immediately — only one browser
 * session may execute at a time. The scheduler's own `running` flag prevents its
 * own re-entry; this guard covers the HTTP endpoint vs scheduler overlap.
 */
export function runPublisher(force: boolean = false): Promise<PublisherRunResult> {
  if (activePublisherRun !== null) {
    const runId = randomUUID();
    logger.warn(
      { event: LOG_EVENT.publisherRunSkipped, status: 'skip', reason: 'publisher_already_running', force },
      '[Publisher] Skipped — another publisher run is already active'
    );
    return Promise.resolve({
      success: false,
      message: '[Publisher] A publisher run is already in progress — try again shortly',
      runId,
      decision: 'publisher_error' as PublisherRunDecision,
      artifactDir: null
    });
  }

  const runPromise = _executePublisherRun(force);
  activePublisherRun = runPromise;
  runPromise.then(
    () => { activePublisherRun = null; },
    () => { activePublisherRun = null; }
  );
  return runPromise;
}
