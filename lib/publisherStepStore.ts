/**
 * Shared in-memory store for real-time publisher step tracking.
 * Updated by bot.ts as the publisher progresses through its phases.
 * Read by the /api/publisher-status endpoint for the UI to poll.
 */

export type PublisherCanvasStep =
  | 'navigate'
  | 'login-page'
  | 'login'
  | 'write-post'
  | 'restore-draft'
  | 'publish'
  | 'standby'
  | 'complete';

/** Maps playbook step_id values to the pipeline canvas step they belong to. */
const PLAYBOOK_STEP_MAP: Record<string, PublisherCanvasStep> = {
  'navigate-board': 'navigate',
  'click-write': 'write-post',
  'open-saved-drafts': 'restore-draft',
  'confirm-load-draft-modal': 'restore-draft',
  'verify-required-body': 'write-post',
  'set-youtube-category': 'write-post',
  'submit-post': 'publish',
};

export function playbookStepToCanvasStep(stepId: string): PublisherCanvasStep {
  return PLAYBOOK_STEP_MAP[stepId] ?? 'write-post';
}

let currentStep: PublisherCanvasStep | null = null;
let isRunning = false;

export function setPublisherStep(step: PublisherCanvasStep | null): void {
  currentStep = step;
}

export function setPublisherRunning(running: boolean): void {
  isRunning = running;
  if (!running) {
    currentStep = null;
  }
}

export function getPublisherStatus(): { step: PublisherCanvasStep | null; running: boolean } {
  return { step: currentStep, running: isRunning };
}
