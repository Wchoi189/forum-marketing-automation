/**
 * lib/publisher/constants.ts
 *
 * Shared constants for the publisher module.
 * Defines step IDs and other magic strings used across the codebase.
 */

/**
 * Playbook step IDs.
 * These must match the step_id values in the playbook JSON.
 */
export const PLAYBOOK_STEP_IDS = {
  /** Click the write button to open the editor */
  CLICK_WRITE: 'click-write',
  /** Submit the post */
  SUBMIT_POST: 'submit-post',
  /** Confirm loading draft from modal */
  CONFIRM_LOAD_DRAFT_MODAL: 'confirm-load-draft-modal',
} as const;

export type PlaybookStepId = typeof PLAYBOOK_STEP_IDS[keyof typeof PLAYBOOK_STEP_IDS];

/**
 * Publisher decision outcomes.
 */
export const PUBLISHER_DECISIONS = {
  GAP_POLICY: 'gap_policy',
  OBSERVER_ERROR: 'observer_error',
  MANUAL_OVERRIDE_DISABLED: 'manual_override_disabled',
  PUBLISHED_VERIFIED: 'published_verified',
  DRY_RUN: 'dry_run',
  PUBLISHER_ERROR: 'publisher_error',
  RATE_LIMITED: 'rate_limited',
} as const;

export type PublisherDecision = typeof PUBLISHER_DECISIONS[keyof typeof PUBLISHER_DECISIONS];

/**
 * The platform allows one post per hour. Both the publisher's pre-flight gate
 * (lib/publisher/cooldownGate.ts) and the scheduler's post-publish scheduling
 * branch (lib/scheduler/run.ts) derive their timing from this single value so
 * the two cannot drift apart.
 */
export const PUBLISH_COOLDOWN_WINDOW_MS = 60 * 60 * 1000;

/** PUBLISH_COOLDOWN_WINDOW_MS expressed in whole minutes. */
export const PUBLISH_COOLDOWN_WINDOW_MINUTES = PUBLISH_COOLDOWN_WINDOW_MS / 60_000;
