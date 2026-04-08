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

export type PublisherFlowOutcome = {
  decision: 'dry_run' | 'published_verified';
  message: string;
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
  const { page, runtime, postSubmitWaitMs, dryRunMode, workflowId, onBeforeSubmit, onSuccess, onStepStart } = input;
  const playbook = await loadPublisherPlaybook(workflowId);
  const { nonSubmitSteps, submitSteps } = splitSubmitSteps(playbook);

  assertSubmitStepsPresent(submitSteps.length);

  await runPublisherPlaybook(page, { ...playbook, steps: nonSubmitSteps }, runtime, onStepStart);
  await onBeforeSubmit?.();

  if (dryRunMode) {
    return {
      decision: 'dry_run',
      message: 'Publication simulated successfully (DRY_RUN_MODE=true)'
    };
  }

  const boardId = resolveBoardIdFromEntryUrl(runtime.boardEntryUrl);
  // Submit remains playbook-driven; success still requires verified list/view landing URL.
  onStepStart?.('submit-post');
  await Promise.all([
    waitForPublishLandingUrl(page, boardId, postSubmitWaitMs),
    runPublisherPlaybook(page, { ...playbook, steps: submitSteps }, runtime)
  ]);

  assertVerifiedPublishRedirect(page.url(), boardId);

  await onSuccess?.();
  return {
    decision: 'published_verified',
    message: `Publication submitted successfully (verified redirect to ${page.url()})`
  };
}
