import type { Page } from 'playwright';

import {
  runPublisherPlaybook,
  type PlaybookRuntimeContext,
  type PublisherPlaybook
} from '../../playbookRunner.js';
import { loadPublisherPlaybook } from './loadPublisherPlaybook.js';
import { waitForPublishLandingUrl } from '../ui/submit.js';
import {
  assertSubmitStepsPresent,
  assertVerifiedPublishRedirect,
  resolveBoardIdFromEntryUrl
} from './stateTransitions.js';
import { detectRateLimit, type RateLimitInfo } from '../ui/rateLimit.js';
import { setPublisherControls } from '../../state/index.js';
import { persistPublishBlockedUntil } from '../../state/index.js';
import { PLAYBOOK_STEP_IDS } from '../constants.js';

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

  // Run steps up to and including click-write
  await runPublisherPlaybook(page, { ...playbook, steps: preClickWriteSteps }, runtime, onStepStart, onStepEnd);

  // Check for rate limit after clicking write button
  const rateLimitStatus = await detectRateLimit(page);
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
