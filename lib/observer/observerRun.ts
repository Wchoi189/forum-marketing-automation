/**
 * lib/observer/observerRun.ts
 *
 * Observer entry point — manages concurrency guard and delegates to the
 * internal execution function.
 */

import type { BrowserContext } from 'playwright';
import type { ActivityLog } from '../../contracts/models.js';
import { ENV } from '../../config/env.js';
import { logger } from '../logger.js';
import { LOG_EVENT } from '../logEvents.js';
import { extractErrorCode } from '../utils.js';
import { createBrowserContext } from '../sharedBrowser.js';
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from '../playwright/browser-eval-polyfill.js';
import { BOT_MAX_WAIT_MS } from '../publisher/core/timeouts.js';
import { parseBoardRows } from './boardParser.js';
import { getBoardDiagnostics } from './boardDiagnostics.js';
import { collectParserSignal, captureBoardRowRegionArtifact, combinedConfidence, createManualReviewMessage } from './parserSignal.js';
import { loadObserverPolicy } from './policyLoader.js';
import { getObserverControls } from '../controls.js';
import { getSharedLogCache } from '../logCache.js';
import { registerBrowserDebugHandlers } from '../browserDebug.js';
import fs from 'fs/promises';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_FILE = ENV.ACTIVITY_LOG_PATH;
const BOARD_ROW_SELECTOR = 'tr.list0, tr.list1, tr.common-list0, tr.common-list1, tr.list_notice';
const KEEP_ACTIVITY_LOG_ENTRIES = 200;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Shared promise for an in-progress observer run. Concurrent callers receive the same result instead of failing. */
let activeObserverRun: Promise<ActivityLog> | null = null;
let lastObserverRunStartedAt = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveLog(log: ActivityLog) {
  const logCache = getSharedLogCache();
  const logs = await logCache.get();
  logs.unshift(log);
  await fs.writeFile(LOG_FILE, JSON.stringify(logs.slice(0, KEEP_ACTIVITY_LOG_ENTRIES), null, 2));
  logCache.invalidate();
}

async function addStealthInitScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: BROWSER_EVAL_NAME_POLYFILL_SCRIPT });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

/** Prefer board `title` on date cells for HH:mm; else show board text; else observation time (Korean locale). */
function formatLastPostTimestampDisplay(dateText: string, dateTitleAttr: string, capturedAtIso: string): string {
  const title = dateTitleAttr?.trim() ?? '';
  const text = dateText?.trim() ?? '';

  const timeInTitle = title.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (timeInTitle) {
    const ymd = title.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) {
      return `${ymd[1]}-${ymd[2]}-${ymd[3]} ${timeInTitle[1]}`;
    }
    const slash = title.match(/(\d{2}\/\d{2}\/\d{2,4})/);
    if (slash) {
      return `${slash[1]} ${timeInTitle[1]}`;
    }
    if (text && !/\d{1,2}:\d{2}/.test(text)) {
      return `${text} ${timeInTitle[1]}`;
    }
    return timeInTitle[1];
  }

  if (/\d{1,2}:\d{2}/.test(text)) {
    return text;
  }

  const obs = new Date(capturedAtIso);
  const timeStr = obs.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (text && text !== 'N/A') {
    return `${text} · observed ${timeStr}`;
  }
  return `observed ${timeStr}`;
}

// ---------------------------------------------------------------------------
// Core observer execution
// ---------------------------------------------------------------------------

async function _executeObserverRun(): Promise<ActivityLog> {
  const observerControls = getObserverControls();
  const observerStartedAt = Date.now();
  const now = Date.now();
  const elapsed = now - lastObserverRunStartedAt;
  const waitForInterval = Math.max(0, observerControls.minIntervalBetweenRunsMs - elapsed);
  const preVisitJitter = randomInt(observerControls.minPreVisitDelayMs, observerControls.maxPreVisitDelayMs);
  const totalDelay = waitForInterval + preVisitJitter;
  if (totalDelay > 0) {
    await sleep(totalDelay);
  }
  lastObserverRunStartedAt = Date.now();

  let context: BrowserContext | null = null;
  try {
    context = createBrowserContext();
    await addStealthInitScripts(context);
    const page = await context.newPage();

    registerBrowserDebugHandlers(page, 'Observer');

    const policy = await loadObserverPolicy();
    logger.info({ event: LOG_EVENT.observerRunStarted, boardUrl: policy.boardUrl }, 'Running Observer');
    const response = await page.goto(policy.boardUrl, {
      waitUntil: 'domcontentloaded',
      timeout: ENV.BOT_NAV_TIMEOUT_MS
    });
    const statusCode = response?.status() ?? 0;
    const diagnostics = await getBoardDiagnostics(page);
    if (statusCode >= 400 || diagnostics.isForbidden) {
      throw new Error(
        `BOARD_ACCESS_DENIED: status=${statusCode} title="${diagnostics.title}" url="${diagnostics.url}" rows=${diagnostics.rowCount}` +
          (statusCode === 403
            ? ' | hint=403_often_bot_or_waf_not_login — try headed Chrome, custom BROWSER_USER_AGENT, or non-datacenter IP'
            : '')
      );
    }
    const parserBundle = await collectParserSignal(page);
    const rowsReady = await page
      .locator(BOARD_ROW_SELECTOR)
      .first()
      .waitFor({ state: 'attached', timeout: BOT_MAX_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    if (!rowsReady) {
      const latest = await getBoardDiagnostics(page);
      const artifactPath = await captureBoardRowRegionArtifact(page, 'observer_rows_not_attached', parserBundle);
      throw new Error(
        `BOARD_CONTENT_UNAVAILABLE: title="${latest.title}" url="${latest.url}" rows=${latest.rowCount} artifact="${artifactPath}"`
      );
    }

    // parseBoardRows is a named, self-contained function (no module-scope closures) so it can
    // be passed to $$eval (which serialises the callback) and also unit-tested with mock DOM.
    const rows = await page.$$eval(BOARD_ROW_SELECTOR, parseBoardRows);

    const nonNoticeRows = policy.excludeNoticeRows ? rows.filter(r => !r.isNotice) : rows;
    const validRows = nonNoticeRows.filter(r => r.title && r.author);
    const parseConfidence =
      validRows.length === 0
        ? 0
        : validRows.reduce((acc, row) => acc + row.parseConfidence, 0) / validRows.length;
    const parserConfidence = parserBundle.signal.parserConfidence;
    const effectiveParseConfidence = combinedConfidence(parseConfidence, parserConfidence);

    logger.debug({
      event: 'confidence_comparison',
      legacyConfidence: parseConfidence,
      parserConfidence,
      combinedConfidence: effectiveParseConfidence,
      parserWarnings: parserBundle.signal.warnings,
      parserRowLikeCount: parserBundle.signal.projectedRowCount,
      legacyValidRowCount: validRows.length
    }, `[Observer] Confidence comparison - Legacy: ${parseConfidence.toFixed(2)}, Parser: ${parserConfidence.toFixed(2)}, Combined: ${effectiveParseConfidence.toFixed(2)}`);

    const sharePlanIndex = validRows.findIndex(
      (r) => r.author.toLowerCase().includes(policy.authorMatch.toLowerCase())
    );

    let gap = 0;
    let competitors: string[] = [];
    let lastPost: (typeof validRows)[number] | null = null;

    if (sharePlanIndex === -1) {
      // If not found, assume safe but gap is large
      gap = validRows.length;
      competitors = validRows.slice(0, 5).map(r => r.author);
    } else {
      gap = sharePlanIndex;
      competitors = validRows.slice(0, sharePlanIndex).map(r => r.author);
      lastPost = validRows[sharePlanIndex];
    }

    const status =
      effectiveParseConfidence < policy.parseConfidenceMin
        ? 'unsafe'
        : gap >= policy.gapThresholdMin
          ? 'safe'
          : 'unsafe';

    const allPosts = validRows.map(({ title, author, date, views, isNotice }) => ({
      title,
      author,
      date,
      views,
      isNotice
    }));

    logger.info({
      event: 'observer_decision',
      status,
      currentGap: gap,
      requiredGap: policy.gapThresholdMin,
      effectiveConfidence: effectiveParseConfidence,
      minConfidence: policy.parseConfidenceMin,
      parseConfidence: parseConfidence,
      parserConfidence: parserConfidence,
      validRowsCount: validRows.length,
      allPostsCount: allPosts.length
    }, `[Observer] Decision: ${status.toUpperCase()} - Gap: ${gap}/${policy.gapThresholdMin}, Confidence: ${effectiveParseConfidence.toFixed(2)}/${policy.parseConfidenceMin}`);

    const capturedAtIso = new Date().toISOString();
    const log: ActivityLog = {
      timestamp: capturedAtIso,
      current_gap_count: gap,
      gap_threshold_min: policy.gapThresholdMin,
      last_post_timestamp: lastPost
        ? formatLastPostTimestampDisplay(lastPost.date, lastPost.dateTitle ?? '', capturedAtIso)
        : 'N/A',
      top_competitor_names: competitors,
      view_count_of_last_post: lastPost?.views || 0,
      status,
      all_posts: allPosts,
      ...(effectiveParseConfidence < policy.parseConfidenceMin
        ? {
            error: `${createManualReviewMessage(effectiveParseConfidence, policy.parseConfidenceMin)} (legacy=${parseConfidence.toFixed(2)}, parser=${parserConfidence.toFixed(2)}, projectedRows=${parserBundle.signal.projectedRowCount}, diff=${JSON.stringify(parserBundle.signal.diffSummary)})`
          }
        : {})
    };

    await saveLog(log);
    logger.info(
      {
        event: LOG_EVENT.observerRunFinished,
        status: log.status,
        currentGap: log.current_gap_count,
        gapThresholdMin: log.gap_threshold_min ?? null,
        durationMs: Date.now() - observerStartedAt
      },
      'Observer run completed'
    );
    return log;
  } catch (error: any) {
    logger.error(
      { event: LOG_EVENT.observerRunFailed, status: 'error', errorCode: extractErrorCode(error), durationMs: Date.now() - observerStartedAt, err: error },
      'Observer Error'
    );
    const log: ActivityLog = {
      timestamp: new Date().toISOString(),
      current_gap_count: 0,
      last_post_timestamp: 'N/A',
      top_competitor_names: [],
      view_count_of_last_post: 0,
      status: 'error',
      all_posts: [],
      error: `[Observer] ${String(error?.message ?? error)}`
    };
    await saveLog(log);
    return log;
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the board observer. If a run is already in progress, the caller shares
 * its result rather than launching a second browser session. This eliminates the
 * startup race where silentRefreshObserver() holds the lock while the user
 * triggers a manual publish.
 */
export function runObserver(): Promise<ActivityLog> {
  const observerControls = getObserverControls();

  if (!observerControls.enabled) {
    return (async (): Promise<ActivityLog> => {
      const disabledAt = Date.now();
      const log: ActivityLog = {
        timestamp: new Date().toISOString(),
        current_gap_count: 0,
        last_post_timestamp: 'N/A',
        top_competitor_names: [],
        view_count_of_last_post: 0,
        status: 'error',
        all_posts: [],
        error: '[Observer] Observer is paused by control panel'
      };
      await saveLog(log);
      logger.warn(
        { event: LOG_EVENT.observerRunSkipped, status: 'error', errorCode: 'OBSERVER_PAUSED', durationMs: Date.now() - disabledAt },
        'Observer skipped because controls are disabled'
      );
      return log;
    })();
  }

  if (activeObserverRun !== null) {
    logger.info(
      { event: LOG_EVENT.observerRunSkipped, reason: 'sharing_active_run' },
      'Observer run already in progress — sharing result with concurrent caller'
    );
    return activeObserverRun;
  }

  const runPromise = _executeObserverRun();
  activeObserverRun = runPromise;
  runPromise.then(
    () => { activeObserverRun = null; },
    () => { activeObserverRun = null; }
  );
  return runPromise;
}
