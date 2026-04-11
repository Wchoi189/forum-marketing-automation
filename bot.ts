import { chromium, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import type { ActivityLog, Post, PublisherRunDecision } from './contracts/models.js';
import { ENV } from './config/env.js';
import { appendPublisherHistoryEntry } from './lib/publisherHistory.js';
import { BOT_MAX_WAIT_MS } from './lib/publisher/core/timeouts.js';
import {
  publisherArtifactDirForRun,
  publisherDebugScreenshot,
  publisherFailureScreenshot
} from './lib/publisher/diagnostics.js';
import { runPublisherFlow } from './lib/publisher/flow/runPublisherFlow.js';
import { setPublisherStep, setPublisherRunning, playbookStepToCanvasStep } from './lib/publisherStepStore.js';
import { readRuntimeGapPersistedOverride, writeRuntimeGapPersistedOverride, readPersistedObserverControls, readPersistedPublisherControls, readPersistedGapSourcePin } from './lib/runtimeControls.js';
import { pageOutline, snapshotDiff, subtree, type ProjectedNode, type ProjectedSnapshot } from './lib/parser/index.js';
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from './lib/playwright/browser-eval-polyfill.js';
import { logger } from './lib/logger.js';
import { LOG_EVENT } from './lib/logEvents.js';

export type PublisherRunResult = {
  success: boolean;
  message: string;
  log?: ActivityLog;
  runId: string;
  decision: PublisherRunDecision;
  /** Project-relative artifact dir when publisher entered browser flow; null on gap-policy skip etc. */
  artifactDir: string | null;
};

const USER_DATA_DIR = ENV.BOT_PROFILE_DIR;
const LOG_FILE = ENV.ACTIVITY_LOG_PATH;
const BOARD_ROW_SELECTOR = 'tr.list0, tr.list1, tr.common-list0, tr.common-list1, tr.list_notice';

/** Reduces trivial AutomationControlled / headless flags; sites may still block by IP or advanced WAF. */
const CHROMIUM_LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'] as const;

function sharedBrowserContextOptions(): BrowserContextOptions {
  return {
    userAgent: ENV.BROWSER_USER_AGENT,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Google Chrome";v="146", "Chromium";v="146", "Not/A)Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"'
    }
  };
}

async function addStealthInitScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: BROWSER_EVAL_NAME_POLYFILL_SCRIPT });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

type ObserverPolicy = {
  boardUrl: string;
  authorMatch: string;
  gapThresholdMin: number;
  parseConfidenceMin: number;
  excludeNoticeRows: boolean;
};

type WorkflowManifest = {
  entry_url?: unknown;
  observer_rules?: {
    author_match?: unknown;
    gap_threshold_min?: unknown;
    parse_confidence_min?: unknown;
    exclude_notice_rows?: unknown;
  };
};

type DecisionRules = {
  observer_rules?: {
    author_match_value?: unknown;
    gap_threshold_min?: unknown;
    parse_confidence_min?: unknown;
    notice_rows_excluded?: unknown;
  };
};

type ObserverPolicyBase = {
  boardUrl: string;
  authorMatch: string;
  specGapThresholdMin: number;
  parseConfidenceMin: number;
  excludeNoticeRows: boolean;
};

let observerPolicyBasePromise: Promise<ObserverPolicyBase> | null = null;
let previousBoardSnapshot: ProjectedSnapshot | null = null;

type ParserSignal = {
  projectedRowCount: number;
  parserConfidence: number;
  warnings: string[];
  diffSummary: { added: number; removed: number; changed: number };
};

export type ObserverControls = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
};

/** Observer pacing plus resolved gap policy (for control panel / API). */
export type ObserverControlsWithGap = ObserverControls & {
  gapThresholdMin: number;
  gapPersistedOverride: number | null;
  gapThresholdSpecBaseline: number;
  gapUsesEnvOverride: boolean;
  /** Which source is currently supplying the effective gap threshold. */
  gapSource: 'file' | 'env' | 'spec';
  /**
   * Explicit source pin set by the user.
   * 'env'  = always use env var (skip file override).
   * 'spec' = always use spec baseline.
   * null   = default precedence: file → env → spec.
   */
  gapSourcePin: 'env' | 'spec' | null;
};

const observerControls: ObserverControls = {
  enabled: true,
  minPreVisitDelayMs: 1500,
  maxPreVisitDelayMs: 4000,
  minIntervalBetweenRunsMs: 0
};

export type PublisherControls = {
  /** 1-based saved-draft item row (alternating item / preview rows use offset automatically). */
  draftItemIndex: number;
};

const publisherControls: PublisherControls = {
  draftItemIndex: 1
};

/** Shared promise for an in-progress observer run. Concurrent callers receive the same result instead of failing. */
let activeObserverRun: Promise<ActivityLog> | null = null;
let lastObserverRunStartedAt = 0;

/** Prevents two concurrent publisher browser sessions from launching simultaneously. */
let activePublisherRun: Promise<PublisherRunResult> | null = null;

const PARSER_OPTIONS = {
  maxDepth: 6,
  maxSiblingsPerNode: 80,
  maxTotalNodes: 750,
  maxTextLengthPerNode: 200
} as const;

function extractErrorCode(input: unknown): string {
  const message = String((input as { message?: unknown })?.message ?? input ?? '').trim();
  const matched = message.match(/^([A-Z0-9_]+):/);
  return matched ? matched[1] : 'UNCLASSIFIED_ERROR';
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getObserverControls(): ObserverControls {
  return { ...observerControls };
}

export function setObserverControls(next: Partial<ObserverControls>): ObserverControls {
  if (typeof next.enabled === 'boolean') {
    observerControls.enabled = next.enabled;
  }

  const minDelay = clampInt(next.minPreVisitDelayMs, observerControls.minPreVisitDelayMs, 0, 120000);
  const maxDelay = clampInt(next.maxPreVisitDelayMs, observerControls.maxPreVisitDelayMs, 0, 120000);
  observerControls.minPreVisitDelayMs = Math.min(minDelay, maxDelay);
  observerControls.maxPreVisitDelayMs = Math.max(minDelay, maxDelay);
  observerControls.minIntervalBetweenRunsMs = clampInt(
    next.minIntervalBetweenRunsMs,
    observerControls.minIntervalBetweenRunsMs,
    0,
    3600000
  );

  return getObserverControls();
}

export function getPublisherControls(): PublisherControls {
  return { ...publisherControls };
}

export function setPublisherControls(next: Partial<PublisherControls>): PublisherControls {
  publisherControls.draftItemIndex = clampInt(
    next.draftItemIndex,
    publisherControls.draftItemIndex,
    1,
    50
  );
  return getPublisherControls();
}

async function readPlanningJson<T>(relativePath: string): Promise<T> {
  const filePath = path.join(ENV.PROJECT_ROOT, '.planning', 'spec-kit', relativePath);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

function assertPolicy(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[OBSERVER_POLICY] ${message}`);
  }
}

function toInt(value: unknown, label: string): number {
  assertPolicy(typeof value === 'number' && Number.isInteger(value), `${label} must be an integer`);
  return value;
}

function toNumber(value: unknown, label: string): number {
  assertPolicy(typeof value === 'number' && Number.isFinite(value), `${label} must be a number`);
  return value;
}

async function loadObserverPolicyBase(): Promise<ObserverPolicyBase> {
  if (!observerPolicyBasePromise) {
    observerPolicyBasePromise = (async () => {
      const [workflow, decisionRules] = await Promise.all([
        readPlanningJson<WorkflowManifest>('manifest/workflow.ppomppu-gonggu-v1.json'),
        readPlanningJson<DecisionRules>('specs/decision-rules.json')
      ]);

      const workflowRules = workflow.observer_rules;
      const decisionObserverRules = decisionRules.observer_rules;
      assertPolicy(Boolean(workflowRules), 'workflow observer_rules are missing');
      assertPolicy(Boolean(decisionObserverRules), 'decision-rules observer_rules are missing');

      const boardUrl = workflow.entry_url;
      assertPolicy(typeof boardUrl === 'string' && boardUrl.length > 0, 'workflow.entry_url must be a non-empty string');

      const workflowAuthorMatch = workflowRules?.author_match;
      const decisionAuthorMatch = decisionObserverRules?.author_match_value;
      assertPolicy(typeof workflowAuthorMatch === 'string' && workflowAuthorMatch.length > 0, 'workflow observer_rules.author_match must be a non-empty string');
      assertPolicy(typeof decisionAuthorMatch === 'string' && decisionAuthorMatch.length > 0, 'decision-rules observer_rules.author_match_value must be a non-empty string');
      assertPolicy(
        workflowAuthorMatch.trim().toLowerCase() === decisionAuthorMatch.trim().toLowerCase(),
        'author_match values differ between workflow and decision-rules contracts'
      );

      const workflowGapThreshold = toInt(workflowRules?.gap_threshold_min, 'workflow observer_rules.gap_threshold_min');
      const decisionGapThreshold = toInt(decisionObserverRules?.gap_threshold_min, 'decision-rules observer_rules.gap_threshold_min');
      assertPolicy(
        workflowGapThreshold === decisionGapThreshold,
        'gap_threshold_min differs between workflow and decision-rules contracts'
      );

      const workflowParseConfidence = toNumber(workflowRules?.parse_confidence_min, 'workflow observer_rules.parse_confidence_min');
      const decisionParseConfidence = toNumber(decisionObserverRules?.parse_confidence_min, 'decision-rules observer_rules.parse_confidence_min');
      assertPolicy(
        workflowParseConfidence === decisionParseConfidence,
        'parse_confidence_min differs between workflow and decision-rules contracts'
      );

      const workflowExcludeNotice = workflowRules?.exclude_notice_rows;
      const decisionExcludeNotice = decisionObserverRules?.notice_rows_excluded;
      assertPolicy(typeof workflowExcludeNotice === 'boolean', 'workflow observer_rules.exclude_notice_rows must be boolean');
      assertPolicy(typeof decisionExcludeNotice === 'boolean', 'decision-rules observer_rules.notice_rows_excluded must be boolean');
      assertPolicy(
        workflowExcludeNotice === decisionExcludeNotice,
        'notice-row exclusion policy differs between workflow and decision-rules contracts'
      );

      return {
        boardUrl,
        authorMatch: workflowAuthorMatch,
        specGapThresholdMin: workflowGapThreshold,
        parseConfidenceMin: workflowParseConfidence,
        excludeNoticeRows: workflowExcludeNotice
      };
    })();
  }
  return observerPolicyBasePromise;
}

/**
 * Precedence (default, no pin): file override → explicit env var → spec baseline.
 * With pin 'env': always use env var (skip file override).
 * With pin 'spec': always use spec baseline (skip both).
 */
async function resolveEffectiveGapThresholdMin(specGap: number): Promise<{ value: number; source: 'file' | 'env' | 'spec' }> {
  const pin = await readPersistedGapSourcePin();
  if (pin === 'spec') {
    return { value: specGap, source: 'spec' };
  }
  const raw = process.env.OBSERVER_GAP_THRESHOLD;
  const envVal = typeof raw === 'string' && raw.trim() !== '' ? ENV.OBSERVER_GAP_THRESHOLD : null;
  if (pin === 'env') {
    return { value: envVal ?? specGap, source: envVal !== null ? 'env' : 'spec' };
  }
  // Default precedence: file → env → spec
  const persisted = await readRuntimeGapPersistedOverride();
  if (persisted !== null) return { value: persisted, source: 'file' };
  if (envVal !== null) return { value: envVal, source: 'env' };
  return { value: specGap, source: 'spec' };
}

async function loadObserverPolicy(): Promise<ObserverPolicy> {
  const base = await loadObserverPolicyBase();
  const { value: gapThresholdMin } = await resolveEffectiveGapThresholdMin(base.specGapThresholdMin);
  return {
    boardUrl: base.boardUrl,
    authorMatch: base.authorMatch,
    gapThresholdMin,
    parseConfidenceMin: base.parseConfidenceMin,
    excludeNoticeRows: base.excludeNoticeRows
  };
}

export async function getObserverControlsWithGap(): Promise<ObserverControlsWithGap> {
  const base = await loadObserverPolicyBase();
  const [persisted, pin, resolved] = await Promise.all([
    readRuntimeGapPersistedOverride(),
    readPersistedGapSourcePin(),
    resolveEffectiveGapThresholdMin(base.specGapThresholdMin).then(r => r),
  ]);
  const raw = process.env.OBSERVER_GAP_THRESHOLD;
  return {
    ...getObserverControls(),
    gapThresholdMin: resolved.value,
    gapPersistedOverride: persisted,
    gapThresholdSpecBaseline: base.specGapThresholdMin,
    gapUsesEnvOverride: typeof raw === 'string' && raw.trim() !== '',
    gapSource: resolved.source,
    gapSourcePin: pin,
  };
}

export async function persistGapThresholdPersistedOverride(value: number | null): Promise<void> {
  await writeRuntimeGapPersistedOverride(value);
}

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

async function getBoardDiagnostics(page: import('playwright').Page) {
  const [title, rowCount, writeButtonCount, bodyText] = await Promise.all([
    page.title(),
    page.locator(BOARD_ROW_SELECTOR).count(),
    page.locator('a:has-text("글쓰기")').count(),
    page.locator('body').innerText().catch(() => '')
  ]);

  const isForbidden = title.toLowerCase().includes('403') || bodyText.toLowerCase().includes('forbidden');
  const loginHints = ['로그인', '로그 인', 'login'];
  const loginPromptVisible = loginHints.some((hint) => bodyText.toLowerCase().includes(hint.toLowerCase()));

  return {
    url: page.url(),
    title,
    rowCount,
    writeButtonCount,
    isForbidden,
    loginPromptVisible
  };
}

async function attemptPpomppuLoginFromBoard(page: import('playwright').Page, boardUrl: string): Promise<boolean> {
  const loginLink = page.locator('a:has-text("로그인")').first();
  if ((await loginLink.count()) === 0) {
    return false;
  }

  await Promise.all([page.waitForLoadState('domcontentloaded'), loginLink.click()]);

  const loginForm = page.locator('form#zb_login');
  if ((await loginForm.count()) === 0) {
    return false;
  }

  await page.fill('input[name="user_id"]', ENV.PPOMPPU_USER_ID);
  await page.fill('input[name="password"]', ENV.PPOMPPU_USER_PW);

  await Promise.all([
    page.waitForURL(/zboard\.php\?id=gonggu/, { timeout: BOT_MAX_WAIT_MS }).catch(() => null),
    page.locator('form#zb_login').locator('a:has-text("로그인")').first().click()
  ]);

  if (!page.url().includes('zboard.php?id=gonggu')) {
    await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: BOT_MAX_WAIT_MS });
  }

  const after = await getBoardDiagnostics(page);
  return after.writeButtonCount > 0;
}

export async function getLogs(): Promise<ActivityLog[]> {
  try {
    const data = await fs.readFile(LOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function createManualReviewMessage(parseConfidence: number, parseConfidenceMin: number): string {
  return `MANUAL_REVIEW_REQUIRED: parse confidence ${parseConfidence.toFixed(2)} is below ${parseConfidenceMin.toFixed(2)}`;
}

function flattenProjectedNodes(nodes: ProjectedNode[]): ProjectedNode[] {
  const output: ProjectedNode[] = [];
  const visit = (node: ProjectedNode) => {
    output.push(node);
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return output;
}

async function collectParserSignal(page: import('playwright').Page): Promise<{
  signal: ParserSignal;
  snapshot: ProjectedSnapshot;
  outline: Awaited<ReturnType<typeof pageOutline>>;
}> {
  const snapshot = await subtree(page, 'table#revolution_main_table, form[name="bbs_list"], body', PARSER_OPTIONS);
  const outline = await pageOutline(page, { ...PARSER_OPTIONS, maxDepth: 4, maxTotalNodes: 260 });
  const rowLikeCount = flattenProjectedNodes(snapshot.nodes).filter((node) => node.tag === 'tr').length;
  const diff = snapshotDiff(previousBoardSnapshot, snapshot);
  previousBoardSnapshot = snapshot;
  return {
    signal: {
      projectedRowCount: rowLikeCount,
      parserConfidence: snapshot.confidence,
      warnings: snapshot.warnings,
      diffSummary: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }
    },
    snapshot,
    outline
  };
}

function combinedConfidence(legacyConfidence: number, parserConfidence: number): number {
  return Number(Math.min(legacyConfidence, parserConfidence).toFixed(2));
}

async function captureBoardRowRegionArtifact(
  page: import('playwright').Page,
  reason: string,
  parserBundle?: {
    signal: ParserSignal;
    snapshot: ProjectedSnapshot;
    outline: Awaited<ReturnType<typeof pageOutline>>;
  }
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.join(ENV.PROJECT_ROOT, 'artifacts', 'board-diagnostics');
  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `board-row-region-${timestamp}.json`);

  const diagnostic = await page.evaluate(() => {
    const selectorCounts = {
      rowLegacy: document.querySelectorAll('tr.list0, tr.list1').length,
      rowCurrent: document.querySelectorAll('tr.common-list0, tr.common-list1').length,
      rowAlt: document.querySelectorAll('tr[class*="list"]').length,
      boardTables: document.querySelectorAll('table').length,
      boardLinks: document.querySelectorAll('a[href*="no="], a[href*="zboard.php?id="]').length
    };

    const boardRoot =
      document.querySelector('table#revolution_main_table') ||
      document.querySelector('form[name="bbs_list"]') ||
      document.querySelector('table') ||
      document.body;

    return {
      selectorCounts,
      bodyExcerpt: document.body?.innerText?.slice(0, 4000) ?? ''
    };
  });

  const parserResult =
    parserBundle ??
    (await collectParserSignal(page).catch(() => ({
      signal: {
        projectedRowCount: 0,
        parserConfidence: 0,
        warnings: ['parser_collection_failed'],
        diffSummary: { added: 0, removed: 0, changed: 0 }
      },
      snapshot: null,
      outline: null
    })));

  const payload = {
    capturedAt: new Date().toISOString(),
    reason,
    url: page.url(),
    title: await page.title().catch(() => 'N/A'),
    ...diagnostic,
    parserSignal: parserResult.signal,
    projectionSnapshot: parserResult.snapshot,
    projectionOutline: parserResult.outline
  };

  await fs.writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf-8');
  return artifactPath;
}

async function saveLog(log: ActivityLog) {
  const logs = await getLogs();
  logs.unshift(log);
  // Keep last 300 logs for weekly analysis (approx 12 days if run hourly)
  await fs.writeFile(LOG_FILE, JSON.stringify(logs.slice(0, 300), null, 2));
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

/**
 * Run the board observer. If a run is already in progress, the caller shares
 * its result rather than launching a second browser session. This eliminates the
 * startup race where silentRefreshObserver() holds the lock while the user
 * triggers a manual publish.
 */
export function runObserver(): Promise<ActivityLog> {
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

async function _executeObserverRun(): Promise<ActivityLog> {
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

  let browser: import('playwright').Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: ENV.BROWSER_HEADLESS,
      args: [...CHROMIUM_LAUNCH_ARGS]
    });
    const context = await browser.newContext(sharedBrowserContextOptions());
    await addStealthInitScripts(context);
    const page = await context.newPage();

    const policy = await loadObserverPolicy();
    logger.info({ event: LOG_EVENT.observerRunStarted, boardUrl: policy.boardUrl }, 'Running Observer');
    const response = await page.goto(policy.boardUrl, { waitUntil: 'domcontentloaded', timeout: BOT_MAX_WAIT_MS });
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

    // Fallback selector chain + confidence score keeps observer fail-closed on layout drift.
    const rows = await page.$$eval(BOARD_ROW_SELECTOR, function (trs) {
      const output: Array<{
        title: string;
        author: string;
        date: string;
        dateTitle: string;
        views: number;
        parseConfidence: number;
        isNotice: boolean;
      }> = [];

      for (const tr of trs) {
        const titleSelectors = ['a.baseList-title .list_title', '.list_title', 'a.baseList-title', 'td:nth-child(3)'];
        const authorSelectors = ['a.baseList-name .list_name', 'span.list_name', '.list_name', 'td:nth-child(4)'];
        const dateSelectors = ['td[title] nobr', 'td[title]', 'td.eng.list_vspace nobr', 'td:nth-child(5)'];

        let title = '';
        let titleConfidence = 0;
        for (let i = 0; i < titleSelectors.length; i++) {
          const value = tr.querySelector(titleSelectors[i])?.textContent?.trim() || '';
          if (value) {
            title = value;
            titleConfidence = i === 0 ? 1 : 0.75;
            break;
          }
        }

        let author = '';
        let authorConfidence = 0;
        for (let i = 0; i < authorSelectors.length; i++) {
          const value = tr.querySelector(authorSelectors[i])?.textContent?.trim() || '';
          if (value) {
            author = value;
            authorConfidence = i === 0 ? 1 : 0.75;
            break;
          }
        }

        let date = '';
        let dateTitle = '';
        let dateConfidence = 0;
        for (let i = 0; i < dateSelectors.length; i++) {
          const el = tr.querySelector(dateSelectors[i]) as HTMLElement | null;
          const value = el?.textContent?.trim() || '';
          if (value) {
            date = value;
            dateTitle = el?.getAttribute('title')?.trim() || '';
            if (!dateTitle && el) {
              const nobr = el.querySelector('nobr');
              dateTitle = nobr?.getAttribute('title')?.trim() || '';
            }
            dateConfidence = i === 0 ? 1 : 0.75;
            break;
          }
        }

        let viewsText = '';
        let viewsConfidence = 0;
        const numericCandidates = Array.from(tr.querySelectorAll('td.eng.list_vspace, td.eng'))
          .map((td) => td.textContent?.replace(/[^\d]/g, '') || '')
          .filter((value) => value.length > 0);
        if (numericCandidates.length > 0) {
          viewsText = numericCandidates[numericCandidates.length - 1];
          viewsConfidence = 0.75;
        }

        const parsedViews = Number.parseInt(viewsText || '0', 10);
        const views = Number.isNaN(parsedViews) ? 0 : parsedViews;
        const parseConfidence = (titleConfidence + authorConfidence + dateConfidence + viewsConfidence) / 4;

        output.push({
          title,
          author,
          date,
          dateTitle,
          views,
          parseConfidence,
          isNotice:
            tr.className.toLowerCase().includes('notice') ||
            tr.querySelector('img[src*="notice"]') !== null ||
            (tr.textContent || '').includes('공지')
        });
      }

      return output;
    });

    const nonNoticeRows = policy.excludeNoticeRows ? rows.filter(r => !r.isNotice) : rows;
    const validRows = nonNoticeRows.filter(r => r.title && r.author);
    const parseConfidence =
      validRows.length === 0
        ? 0
        : validRows.reduce((acc, row) => acc + row.parseConfidence, 0) / validRows.length;
    const parserConfidence = parserBundle.signal.parserConfidence;
    const effectiveParseConfidence = combinedConfidence(parseConfidence, parserConfidence);

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
    const allPosts: Post[] = validRows.map(({ title, author, date, views, isNotice }) => ({
      title,
      author,
      date,
      views,
      isNotice
    }));

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
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}

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
    await recordPublisherRun({
      force,
      success,
      message,
      runId,
      artifactDir: artifactAbs,
      decision
    });
    const artifactRel =
      artifactAbs === null || artifactAbs === undefined
        ? null
        : path.relative(ENV.PROJECT_ROOT, artifactAbs).replace(/\\/g, '/');
    const durationMs = Date.now() - publisherStartedAt;
    logger.info(
      { event: LOG_EVENT.publisherRunFinished, runId, decision, status: success ? 'success' : 'error', durationMs, force, artifactDir: artifactRel },
      'Publisher run completed'
    );
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
      return await finish(
        false,
        log.error || '[Publisher] Gap is too small to publish (safety / gap policy)',
        'gap_policy',
        log
      );
    }

    debugDir = publisherArtifactDirForRun();
    let traceStarted = false;
    /** When tracing ran: persist zip on failure or when success-path sampling hits. */
    let persistPublisherTraceZip = false;
    let publisherBrowserFlowFailed = false;
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: ENV.BROWSER_HEADLESS,
      args: [...CHROMIUM_LAUNCH_ARGS],
      ...sharedBrowserContextOptions()
    });
    await addStealthInitScripts(context);
    if (debugDir) {
      await fs.mkdir(debugDir, { recursive: true });
    }
    if (debugDir && ENV.PUBLISHER_DEBUG_TRACE) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      traceStarted = true;
    }

    let page: import('playwright').Page | null = null;
    try {
      page = await context.newPage();
      logger.info({ event: LOG_EVENT.publisherRunStarted, runId, boardUrl: policy.boardUrl, force }, 'Running Publisher');
      if (debugDir) {
        logger.info({ event: LOG_EVENT.publisherArtifactsDir, runId, debugDir }, '[Publisher] debug artifacts dir');
      }
      setPublisherStep('navigate');
      const response = await page.goto(policy.boardUrl, { waitUntil: 'domcontentloaded', timeout: BOT_MAX_WAIT_MS });
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
        const loginRecovered = diagnostics.loginPromptVisible
          ? await attemptPpomppuLoginFromBoard(page, policy.boardUrl).catch(() => false)
          : false;
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
      const flow = await runPublisherFlow({
        page,
        runtime: {
          boardEntryUrl: policy.boardUrl,
          draftItemIndex: publisherControls.draftItemIndex,
          verifyTextTimeoutMs: ENV.PUBLISHER_POST_SUBMIT_WAIT_MS
        },
        postSubmitWaitMs: ENV.PUBLISHER_POST_SUBMIT_WAIT_MS,
        dryRunMode: ENV.DRY_RUN_MODE,
        onStepStart: (stepId) => {
          setPublisherStep(playbookStepToCanvasStep(stepId));
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
      return await finish(true, flow.message, flow.decision, log);
    } catch (innerErr) {
      publisherBrowserFlowFailed = true;
      persistPublisherTraceZip = true;
      await publisherFailureScreenshot(page, debugDir);
      throw innerErr;
    } finally {
      if (traceStarted && debugDir) {
        const tracePath = path.join(debugDir, 'trace.zip');
        if (publisherBrowserFlowFailed || persistPublisherTraceZip) {
          await context.tracing.stop({ path: tracePath }).catch(() => null);
          logger.info({ event: LOG_EVENT.publisherArtifactsTrace, runId, tracePath }, '[Publisher] debug trace');
        } else {
          await context.tracing.stop().catch(() => null);
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
      await context.close();
    }
  } catch (error: any) {
    logger.error(
      { event: LOG_EVENT.publisherRunFailed, runId, status: 'error', errorCode: extractErrorCode(error), durationMs: Date.now() - publisherStartedAt, err: error },
      'Publisher Error'
    );
    return await finish(false, `[Publisher] ${String(error?.message ?? error)}`, 'publisher_error', log);
  }
}
