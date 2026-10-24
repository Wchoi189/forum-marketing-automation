/**
 * Publisher module barrel export.
 *
 * Main exports for publisher automation.
 */

// Constants
export {
  PLAYBOOK_STEP_IDS,
  PUBLISHER_DECISIONS,
  PUBLISH_COOLDOWN_WINDOW_MS,
  PUBLISH_COOLDOWN_WINDOW_MINUTES,
} from './constants.js';
export type { PlaybookStepId, PublisherDecision } from './constants.js';

// Core types
export type { PublisherRunResult, PublisherRunOverrides } from './publisherRun.js';
export { runPublisher } from './publisherRun.js';

// Flow orchestration & consolidated flow helpers
export type { PublisherFlowOutcome, RunPublisherFlowInput } from './flow/runPublisherFlow.js';
export {
  runPublisherFlow,
  splitSubmitSteps,
  loadPublisherPlaybook,
  resolveBoardIdFromEntryUrl,
  assertSubmitStepsPresent,
  assertVerifiedPublishRedirect,
  clickSubmitButton,
  isPublishSuccessUrl,
  waitForPublishLandingUrl,
  BOT_MAX_WAIT_MS,
  DEFAULT_VERIFY_TEXT_TIMEOUT_MS,
  PLAYBOOK_LOCATOR_TIMEOUT_MS,
  PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS,
} from './flow/runPublisherFlow.js';

// UI interactions
export { detectRateLimit } from './ui/rateLimit.js';
export type { RateLimitInfo, RateLimitStatus } from './ui/rateLimit.js';
export { confirmLoadDraftFromModal } from './ui/draftModal.js';
export type { SelectorResolutionStep } from './ui/selectorResolver.js';
export { resolveFirstLocator, resolveFirstVisibleLocator } from './ui/selectorResolver.js';

// Diagnostics
export { publisherArtifactDirForRun, publisherDebugScreenshot, publisherFailureScreenshot } from './diagnostics.js';

// History
export {
  appendPublisherHistoryEntry,
  readPublisherHistory,
  getLastSuccessfulPublish,
} from './history.js';
export type { PublisherHistoryEntry } from './history.js';

// Step store
export {
  playbookStepToCanvasStep,
  setPublisherStep,
  setPublisherRunning,
  getPublisherStatus,
} from './stepStore.js';
export type { PublisherCanvasStep } from './stepStore.js';
