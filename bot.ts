import { chromium, type BrowserContext, type BrowserContextOptions } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import type { ActivityLog, Post } from './contracts/models.js';
import { ENV } from './config/env.js';
import { pageOutline, snapshotDiff, subtree, type ProjectedNode, type ProjectedSnapshot } from './lib/parser/index.js';
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from './lib/playwright/browser-eval-polyfill.js';

const USER_DATA_DIR = ENV.BOT_PROFILE_DIR;
const LOG_FILE = ENV.ACTIVITY_LOG_PATH;
const REQUIRED_DRAFT_TITLE =
  '[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)';
const REQUIRED_BODY_TEXT = '회원 모집 안내';
const REQUIRED_CATEGORY_LABEL = '유튜브';
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
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
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

let observerPolicyPromise: Promise<ObserverPolicy> | null = null;
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

const observerControls: ObserverControls = {
  enabled: true,
  minPreVisitDelayMs: 0,
  maxPreVisitDelayMs: 0,
  minIntervalBetweenRunsMs: 0
};

let observerRunning = false;
let lastObserverRunStartedAt = 0;

const PARSER_OPTIONS = {
  maxDepth: 6,
  maxSiblingsPerNode: 60,
  maxTotalNodes: 550,
  maxTextLengthPerNode: 200
} as const;

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

async function loadObserverPolicy(): Promise<ObserverPolicy> {
  if (observerPolicyPromise) {
    return observerPolicyPromise;
  }

  observerPolicyPromise = (async () => {
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
      gapThresholdMin: workflowGapThreshold,
      parseConfidenceMin: workflowParseConfidence,
      excludeNoticeRows: workflowExcludeNotice
    };
  })();

  return observerPolicyPromise;
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
    page.waitForURL(/zboard\.php\?id=gonggu/, { timeout: 30000 }).catch(() => null),
    page.locator('form#zb_login').locator('a:has-text("로그인")').first().click()
  ]);

  if (!page.url().includes('zboard.php?id=gonggu')) {
    await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
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

export async function runObserver() {
  if (!observerControls.enabled) {
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
    return log;
  }

  if (observerRunning) {
    const log: ActivityLog = {
      timestamp: new Date().toISOString(),
      current_gap_count: 0,
      last_post_timestamp: 'N/A',
      top_competitor_names: [],
      view_count_of_last_post: 0,
      status: 'error',
      all_posts: [],
      error: '[Observer] Observer run already in progress'
    };
    await saveLog(log);
    return log;
  }
  observerRunning = true;

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
    console.log('Running Observer...');
    const response = await page.goto(policy.boardUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
      .waitFor({ state: 'attached', timeout: 15000 })
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
        let dateConfidence = 0;
        for (let i = 0; i < dateSelectors.length; i++) {
          const value = tr.querySelector(dateSelectors[i])?.textContent?.trim() || '';
          if (value) {
            date = value;
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

    const log: ActivityLog = {
      timestamp: new Date().toISOString(),
      current_gap_count: gap,
      last_post_timestamp: lastPost?.date || 'N/A',
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
    return log;
  } catch (error: any) {
    console.error('Observer Error:', error);
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
    observerRunning = false;
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}

export async function runPublisher(force: boolean = false) {
  let log: ActivityLog | undefined;
  try {
    const policy = await loadObserverPolicy();
    log = await runObserver();
    
    if (log.status === 'error') {
      return { success: false, message: log.error || '[Observer] Observer failed', log };
    }

    if (force && !ENV.MANUAL_OVERRIDE_ENABLED) {
      return {
        success: false,
        message: '[Publisher] Manual override is disabled by environment policy (MANUAL_OVERRIDE_ENABLED=false)',
        log
      };
    }

    if (!force && log.status !== 'safe') {
      console.log('Gap is too small. Skipping publication.');
      return {
        success: false,
        message: log.error || '[Publisher] Gap is too small to publish (safety / gap policy)',
        log
      };
    }

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: ENV.BROWSER_HEADLESS,
      args: [...CHROMIUM_LAUNCH_ARGS],
      ...sharedBrowserContextOptions()
    });
    await addStealthInitScripts(context);

    const page = await context.newPage();

    try {
      console.log('Running Publisher...');
      const response = await page.goto(policy.boardUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
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

      // Step 1: Access Writing Interface
      // Find "글쓰기" button. Usually an <a> tag with text or image
      const writeBtn = page.locator('a:has-text("글쓰기")').first();
      await writeBtn.click();

      // Step 2: Retrieve Draft
      // Click "임시저장된 게시글"
      const draftBtn = page.locator('input[value="임시저장된 게시글"], button:has-text("임시저장된 게시글")');
      await draftBtn.click();

      // The drafts appear in a popup or modal. We need to find the specific one.
      // Logic: Find the draft titled `[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)`
      // Select the most recent one.
      await page.waitForSelector('.popup_layer, .modal', { timeout: 5000 }).catch(() => {});
      
      const draftRow = page.locator(`tr:has-text("${REQUIRED_DRAFT_TITLE}")`).first();
      
      if ((await draftRow.count()) === 0) {
        throw new Error('Draft not found');
      }

      // Step 3: Load & Verify
      const loadBtn = draftRow.locator('a:has-text("불러오기"), button:has-text("불러오기")').first();
      if ((await loadBtn.count()) > 0) {
        await loadBtn.click();
      } else {
        await draftRow.click();
      }

      // Wait for editor to load
      await page.waitForTimeout(2000);
      
      // Verify required text is in editor body
      // Ppomppu uses a custom editor, often an iframe or a textarea
      const content = await page.content();
      if (!content.includes(REQUIRED_BODY_TEXT)) {
        // Check inside iframes if necessary
        const frames = page.frames();
        let found = false;
        for (const frame of frames) {
          const frameContent = await frame.content();
          if (frameContent.includes(REQUIRED_BODY_TEXT)) {
            found = true;
            break;
          }
        }
        if (!found) throw new Error(`Verification failed: "${REQUIRED_BODY_TEXT}" not found in editor`);
      }

      // Step 4: Categorize
      // Set OTT category dropdown to "유튜브"
      // The selector might be a <select> or a custom dropdown
      const categorySelect = page.locator('select[name="category"], select#category');
      if (await categorySelect.count() > 0) {
        const selected = await categorySelect.selectOption({ label: REQUIRED_CATEGORY_LABEL });
        if (selected.length === 0) {
          throw new Error(`Category selection failed: "${REQUIRED_CATEGORY_LABEL}" option missing`);
        }
      }

      // Step 5: Publish
      const submitBtn = page.locator('input[value="작성완료"], button:has-text("작성완료")');
      if (ENV.DRY_RUN_MODE) {
        console.log('Dry-run mode enabled. Submit click intentionally skipped.');
        return { success: true, message: 'Publication simulated successfully (DRY_RUN_MODE=true)', log };
      }

      await submitBtn.click();
      console.log('Draft loaded, verified, and submitted.');
      return { success: true, message: 'Publication submitted successfully', log };

    } finally {
      await context.close();
    }
  } catch (error: any) {
    console.error('Publisher Error:', error);
    return { success: false, message: `[Publisher] ${String(error?.message ?? error)}`, log };
  }
}
