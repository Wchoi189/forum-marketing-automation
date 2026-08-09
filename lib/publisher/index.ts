/**
 * Publisher module barrel export.
 *
 * Main exports for publisher automation.
 */

// Constants
export { PLAYBOOK_STEP_IDS, PUBLISHER_DECISIONS } from './constants.js';
export type { PlaybookStepId, PublisherDecision } from './constants.js';

// Core types
export type { PublisherRunResult } from './publisherRun.js';

// Flow orchestration
export type { PublisherFlowOutcome, RunPublisherFlowInput } from './flow/runPublisherFlow.js';
export { runPublisherFlow, splitSubmitSteps } from './flow/runPublisherFlow.js';

// Playbook loading
export { loadPublisherPlaybook } from './flow/loadPublisherPlaybook.js';

// UI interactions
export { detectRateLimit } from './ui/rateLimit.js';
export type { RateLimitInfo, RateLimitStatus } from './ui/rateLimit.js';
export { confirmLoadDraftFromModal } from './ui/draftModal.js';
export { clickSubmitButton, isPublishSuccessUrl, waitForPublishLandingUrl } from './ui/submit.js';
export type { SelectorResolutionStep } from './ui/selectorResolver.js';
export { resolveFirstLocator, resolveFirstVisibleLocator } from './ui/selectorResolver.js';

// State transitions
export { resolveBoardIdFromEntryUrl, assertSubmitStepsPresent, assertVerifiedPublishRedirect } from './flow/stateTransitions.js';

// Diagnostics
export { publisherArtifactDirForRun, publisherDebugScreenshot, publisherFailureScreenshot } from './diagnostics.js';

// Timeouts
export {
  BOT_MAX_WAIT_MS,
  DEFAULT_VERIFY_TEXT_TIMEOUT_MS,
  PLAYBOOK_LOCATOR_TIMEOUT_MS,
  PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS,
} from './core/timeouts.js';
