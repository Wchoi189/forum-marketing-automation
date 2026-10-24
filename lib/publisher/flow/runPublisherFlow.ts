/**
 * lib/publisher/flow/runPublisherFlow.ts
 *
 * Core publisher execution flow.
 * Inlines timeouts, playbook loading, DOM submit handling, and redirect verification
 * to provide a unified, cohesive execution module.
 */

import fs from 'fs/promises';
import path from 'path';
import type { Frame, Locator, Page } from 'playwright';

import { ENV } from '../../../config/env.js';
import {
  runPublisherPlaybook,
  type PlaybookRuntimeContext,
  type PublisherPlaybook
} from '../../playbookRunner.js';
import { detectRateLimit, type RateLimitInfo } from '../ui/rateLimit.js';
import { setPublisherControls, persistPublishBlockedUntil } from '../../state/index.js';
import { PLAYBOOK_STEP_IDS } from '../constants.js';

// ── Timeouts ─────────────────────────────────────────────────────────────────

/** Upper bound for in-page locator/URL waits (after navigation). */
export const BOT_MAX_WAIT_MS = 3000;

/** Upper bound for verify_text waits when not overridden at runtime. */
export const DEFAULT_VERIFY_TEXT_TIMEOUT_MS = 20_000;

/** Playwright locator/action timeout for draft modal + submit (avoid default 30s). */
export const PLAYBOOK_LOCATOR_TIMEOUT_MS = 3000;

/** Small retry buffer used inside post-submit URL verification. */
export const PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS = 400;

// ── Playbook Loading ──────────────────────────────────────────────────────────

const DEFAULT_WORKFLOW_ID = 'ppomppu-gonggu-v1';

async function readPlanningJson<T>(relativePath: string): Promise<T> {
  const filePath = path.join(ENV.PROJECT_ROOT, '.planning', 'spec-kit', relativePath);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export async function loadPublisherPlaybook(workflowId: string = DEFAULT_WORKFLOW_ID): Promise<PublisherPlaybook> {
  const playbook = await readPlanningJson<PublisherPlaybook>(`manifest/playbook.${workflowId}.json`);
  if (playbook.workflow_id !== workflowId) {
    throw new Error(`PUBLISHER_PLAYBOOK_INVALID: workflow_id mismatch (${playbook.workflow_id} != ${workflowId})`);
  }
  const actions = new Set(playbook.steps.map((s) => s.action));
  if (!actions.has('verify_text') || !actions.has('select') || !actions.has('submit')) {
    throw new Error('PUBLISHER_PLAYBOOK_INVALID: required actions verify_text/select/submit missing');
  }
  return playbook;
}

// ── State Transitions & Verification ─────────────────────────────────────────

export function resolveBoardIdFromEntryUrl(boardUrl: string): string {
  try {
    const id = new URL(boardUrl).searchParams.get('id');
    return id || 'gonggu';
  } catch {
    return 'gonggu';
  }
}

export function assertSubmitStepsPresent(stepCount: number): void {
  if (stepCount <= 0) {
    throw new Error('PUBLISHER_PLAYBOOK_INVALID: submit step missing');
  }
}

export function assertVerifiedPublishRedirect(finalUrl: string, boardId: string): void {
  if (!isPublishSuccessUrl(finalUrl, boardId)) {
    throw new Error(`PUBLISHER_SUBMIT_REDIRECT_UNVERIFIED: final url "${finalUrl}"`);
  }
}

// ── UI Submit Helpers ─────────────────────────────────────────────────────────

export async function clickSubmitButton(locator: Locator): Promise<void> {
  await locator.click({ noWaitAfter: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS });
}

/** Post-submit landing page for this Zboard (list or view), not the compose screen. */
export function isPublishSuccessUrl(href: string, boardId: string): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.searchParams.get('id') !== boardId) return false;
  if (u.searchParams.get('page') === 'write') return false;
  if (/write\.php/i.test(u.pathname)) return false;
  // Interim "ok" page after submit — must not count as success until real list/view.
  if (/write_ok\.php/i.test(u.pathname)) return false;
  if (u.pathname.includes('zboard.php')) return true;
  if (u.pathname.includes('view.php')) return true;
  if (u.searchParams.has('no')) return true;
  return false;
}

/**
 * After submit, wait until main frame URL is a final board list/view (not compose / write_ok).
 * Uses domcontentloaded so slow full "load" on the destination cannot false-timeout the waiter.
 */
export async function waitForPublishLandingUrl(
  page: Page,
  boardId: string,
  timeoutMs: number
): Promise<void> {
  const navigatedUrls: string[] = [];
  const onNav = (frame: Frame) => {
    if (frame === page.mainFrame()) {
      try {
        navigatedUrls.push(frame.url());
      } catch {
        navigatedUrls.push('(url_unavailable)');
      }
    }
  };
  page.on('framenavigated', onNav);
  const tailChain = () => navigatedUrls.slice(-12).join(' -> ');
  try {
    await page.waitForURL((u) => isPublishSuccessUrl(u.href, boardId), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded'
    });
  } catch (firstErr) {
    let href = '';
    try {
      href = page.url();
    } catch {
      href = '(url_unavailable)';
    }
    if (isPublishSuccessUrl(href, boardId)) {
      return;
    }
    await page.waitForTimeout(PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS).catch(() => null);
    try {
      href = page.url();
    } catch {
      href = '(url_unavailable)';
    }
    if (isPublishSuccessUrl(href, boardId)) {
      return;
    }
    const base =
      firstErr instanceof Error && /timeout/i.test(firstErr.message)
        ? `PUBLISHER_POST_SUBMIT_TIMEOUT: no final list/view within ${timeoutMs}ms (boardId=${boardId})`
        : `PUBLISHER_POST_SUBMIT_VERIFY_FAILED: ${String((firstErr as Error)?.message ?? firstErr)}`;
    throw new Error(`${base} | lastUrl="${href}" | mainFrameNavTail="${tailChain()}"`);
  } finally {
    page.off('framenavigated', onNav);
  }
}

// ── Flow Types & Execution ───────────────────────────────────────────────────

export type PublisherFlowOutcome = {
  decision: 'dry_run' | 'published_verified' | 'rate_limited';
  message: string;
  rateLimitInfo?: RateLimitInfo;
};

export type RunPublisherFlowInput = {
  page: Page;
  runtime: PlaybookRuntimeContext;
  postSubmitWaitMs: number;
  dryRunMode: boolean;
  workflowId?: string;
  onBeforeSubmit?: () => Promise<void>;
  onSuccess?: () => Promise<void>;
  /** Called before each playbook step with the step's ID, for real-time progress tracking. */
  onStepStart?: (stepId: string) => void;
  /** Called after each playbook step completes, for diagnostics like screenshots. */
  onStepEnd?: (stepId: string) => Promise<void>;
};

export function splitSubmitSteps(playbook: PublisherPlaybook): {
  nonSubmitSteps: PublisherPlaybook['steps'];
  submitSteps: PublisherPlaybook['steps'];
} {
  return {
    nonSubmitSteps: playbook.steps.filter((s) => s.action !== 'submit'),
    submitSteps: playbook.steps.filter((s) => s.action === 'submit')
  };
}

export async function runPublisherFlow(input: RunPublisherFlowInput): Promise<PublisherFlowOutcome> {
  const { page, runtime, postSubmitWaitMs, dryRunMode, workflowId, onBeforeSubmit, onSuccess, onStepStart, onStepEnd } = input;
  const playbook = await loadPublisherPlaybook(workflowId);
  const { nonSubmitSteps, submitSteps } = splitSubmitSteps(playbook);

  assertSubmitStepsPresent(submitSteps.length);

  // Split nonSubmitSteps to check for rate limit after click-write
  const clickWriteIndex = nonSubmitSteps.findIndex((s) => s.step_id === PLAYBOOK_STEP_IDS.CLICK_WRITE);
  const preClickWriteSteps = clickWriteIndex >= 0 ? nonSubmitSteps.slice(0, clickWriteIndex + 1) : nonSubmitSteps;
  const postClickWriteSteps = clickWriteIndex >= 0 ? nonSubmitSteps.slice(clickWriteIndex + 1) : [];

  // STAB-003: Hook dialog event before clicking write button to capture alert text
  let capturedDialogText: string | null = null;
  const dialogListener = (dialog: import('playwright').Dialog) => {
    capturedDialogText = dialog.message();
    void dialog.accept().catch(() => null);
  };
  page.once('dialog', dialogListener);

  try {
    // Run steps up to and including click-write
    await runPublisherPlaybook(page, { ...playbook, steps: preClickWriteSteps }, runtime, onStepStart, onStepEnd);
  } finally {
    page.off('dialog', dialogListener);
  }

  // Check for rate limit after clicking write button
  const rateLimitStatus = await detectRateLimit(page, capturedDialogText);
  if (rateLimitStatus.blocked) {
    // Set backoff time with a small buffer
    const blockedUntil = new Date(Date.now() + (rateLimitStatus.remainingMinutes + 1) * 60 * 1000).toISOString();
    setPublisherControls({ publishBlockedUntil: blockedUntil });
    await persistPublishBlockedUntil(blockedUntil).catch(() => null);

    return {
      decision: 'rate_limited',
      message: rateLimitStatus.message,
      rateLimitInfo: rateLimitStatus,
    };
  }

  // Run remaining non-submit steps (open drafts, load draft, verify)
  if (postClickWriteSteps.length > 0) {
    await runPublisherPlaybook(page, { ...playbook, steps: postClickWriteSteps }, runtime, onStepStart, onStepEnd);
  }
  await onBeforeSubmit?.();

  if (dryRunMode) {
    return {
      decision: 'dry_run',
      message: 'Publication simulated successfully (DRY_RUN_MODE=true)'
    };
  }

  const boardId = resolveBoardIdFromEntryUrl(runtime.boardEntryUrl);
  // Submit remains playbook-driven; success still requires verified list/view landing URL.
  onStepStart?.(PLAYBOOK_STEP_IDS.SUBMIT_POST);
  await Promise.all([
    waitForPublishLandingUrl(page, boardId, postSubmitWaitMs),
    runPublisherPlaybook(page, { ...playbook, steps: submitSteps }, runtime, undefined, onStepEnd)
  ]);

  assertVerifiedPublishRedirect(page.url(), boardId);

  // Clear any rate limit backoff on successful publish
  setPublisherControls({ publishBlockedUntil: null });
  await persistPublishBlockedUntil(null).catch(() => null);

  await onSuccess?.();
  return {
    decision: 'published_verified',
    message: `Publication submitted successfully (verified redirect to ${page.url()})`
  };
}
