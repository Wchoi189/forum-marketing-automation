/**
 * lib/scheduler/nextAttempt.ts
 *
 * The only code in the system that decides when the publisher next runs.
 *
 * `nextAttemptAt` is pure and total: it reads no clock, performs no I/O, holds no
 * closure state, and is defined for every combination of its inputs. Everything the
 * caller needs in order to arm a timer and log the decision is in the return value,
 * so `scheduleNext` does no scheduling arithmetic of its own.
 *
 * The decision table lives in tests/unit/nextAttempt.test.ts. That file is the
 * specification; this one is its implementation.
 */

import { clamp } from '../utils.js';
import { applyScheduleJitter, clampScheduleMinutes } from '../scheduleJitter.js';
import type { ScheduleJitterMode } from '../scheduleJitter.js';
import { COMBINED_MULTIPLIER_MIN, COMBINED_MULTIPLIER_MAX } from '../analytics/index.js';
import { PUBLISH_COOLDOWN_WINDOW_MINUTES } from '../publisher/index.js';

import { isHourInRange } from './presets.js';
import type { AutoPublisherControls, SchedulerTickOutcome } from './types.js';

/**
 * Why the returned time was chosen. These strings are an operational contract: the
 * run log is grepped for them during deployment verification, so renaming one is a
 * breaking change to the observability surface, not a refactor.
 */
export type AttemptReason =
  | 'rate_limited_cooldown'
  | 'post_publish_cooldown'
  | 'system_maintenance'
  | 'error_backoff'
  | 'gap_recheck'
  | 'already_running'
  | 'adaptive'
  | 'block_deadline_clamp'
  | 'session_required';

/** Backoff ladder for consecutive unexpected failures. The last step repeats. */
export const ERROR_BACKOFF_MINUTES = [15, 30, 60] as const;

/** A benign overlap with a manual run is retried almost immediately. */
export const ALREADY_RUNNING_RETRY_MINUTES = 1;

/**
 * SL-002: how often a parked scheduler re-reads the session record. The recheck is
 * in-memory only (no browser, no observer); an import ends the park within one interval.
 */
export const SESSION_RECHECK_MINUTES = 10;

/**
 * Slack added past a cooldown or block deadline so a tick does not land on the exact
 * boundary and bounce straight back into the same gate.
 */
export const BLOCK_BUFFER_MINUTES = 1;

/** Field names of the two block deadlines, in the order they are examined. */
export const BLOCK_FIELDS = ['publishBlockedUntil', 'maintenanceBlockedUntil'] as const;
export type BlockField = (typeof BLOCK_FIELDS)[number];

export type NextAttemptInput = {
  /** Reference time in epoch ms. The function never reads a clock of its own. */
  now: number;
  lastOutcome: SchedulerTickOutcome;
  blocks: Record<BlockField, string | null>;
  controls: AutoPublisherControls;
  /** Adaptive multipliers computed elsewhere; ignored when trendAdaptiveEnabled is false. */
  multipliers: { trend: number; sov: number; opportunity: number };
  /**
   * Randomness source for schedule jitter, in [0, 1). Omit it and no jitter is
   * applied, which is what keeps the function deterministic under test.
   */
  random?: () => number;
};

export type NextAttempt = {
  /** Epoch ms at which the next tick should fire. */
  at: number;
  reason: AttemptReason;
  /** Setting names that actually influenced `at`. Logged so the run log is self-explaining. */
  inputsUsed: string[];
  /** Interval before jitter and before any block clamp, for the log line. */
  baseMinutes: number;
  /** Final interval in minutes, matching `at`. */
  nextMinutes: number;
  /** Jitter actually applied. Zero on every non-adaptive reason. */
  jitterPercent: number;
  jitterMode: ScheduleJitterMode;
  /** Set when a block deadline overrode the candidate schedule. */
  clamp: {
    field: BlockField;
    blockedUntilMs: number;
    discardedReason: AttemptReason;
    discardedMinutes: number;
  } | null;
};

type Candidate = {
  reason: AttemptReason;
  baseMinutes: number;
  nextMinutes: number;
  inputsUsed: string[];
  jitterPercent: number;
  jitterMode: ScheduleJitterMode;
};

/**
 * The adaptive interval: base interval scaled by the hour-of-day windows and the
 * combined trend/SoV/opportunity multiplier, optionally blended toward a target.
 *
 * This is the path F-06 reported as unreachable. It is now the default branch rather
 * than a branch a healthy system never enters.
 */
function adaptiveCandidate(input: NextAttemptInput): Candidate {
  const { controls, multipliers } = input;
  const inputsUsed = ['baseIntervalMinutes'];
  const hour = new Date(input.now).getHours();

  let multiplier = 1;

  if (isHourInRange(hour, controls.quietHoursStart, controls.quietHoursEnd) && controls.quietHoursMultiplier !== 1) {
    multiplier *= controls.quietHoursMultiplier;
    inputsUsed.push('quietHoursStart', 'quietHoursEnd', 'quietHoursMultiplier');
  }

  if (isHourInRange(hour, controls.activeHoursStart, controls.activeHoursEnd) && controls.activeHoursMultiplier !== 1) {
    multiplier *= controls.activeHoursMultiplier;
    inputsUsed.push('activeHoursStart', 'activeHoursEnd', 'activeHoursMultiplier');
  }

  if (controls.trendAdaptiveEnabled) {
    // Clamped in two stages, matching how the factors were accumulated before the
    // extraction: trend x SoV first, then the isolated opportunity signal.
    const trendAndSov = clamp(multipliers.trend * multipliers.sov, COMBINED_MULTIPLIER_MIN, COMBINED_MULTIPLIER_MAX);
    const combined = clamp(trendAndSov * multipliers.opportunity, COMBINED_MULTIPLIER_MIN, COMBINED_MULTIPLIER_MAX);
    if (combined !== 1) {
      multiplier *= combined;
      inputsUsed.push('trendAdaptiveEnabled', 'multipliers.trend', 'multipliers.sov', 'multipliers.opportunity');
    }
  }

  let effective = clampScheduleMinutes(controls.baseIntervalMinutes * multiplier);

  if (controls.targetPublishIntervalMinutes > 0) {
    effective = clampScheduleMinutes(effective * 0.5 + controls.targetPublishIntervalMinutes * 0.5);
    inputsUsed.push('targetPublishIntervalMinutes');
  }

  // Jitter only exists to decorrelate our posting times; it is deliberately absent
  // from every deadline-driven reason, where slack would either waste a run or
  // undershoot a platform gate.
  let nextMinutes = effective;
  let jitterPercent = 0;
  let jitterMode: ScheduleJitterMode = 'none';
  if (input.random && controls.scheduleJitterMode !== 'none' && controls.scheduleJitterPercent > 0) {
    nextMinutes = applyScheduleJitter(effective, controls.scheduleJitterPercent, controls.scheduleJitterMode, input.random);
    jitterPercent = controls.scheduleJitterPercent;
    jitterMode = controls.scheduleJitterMode;
    inputsUsed.push('scheduleJitterPercent', 'scheduleJitterMode');
  }

  return { reason: 'adaptive', baseMinutes: effective, nextMinutes, inputsUsed, jitterPercent, jitterMode };
}

/** A schedule driven by a deadline rather than by the adaptive dials. */
function fixed(reason: AttemptReason, minutes: number, inputsUsed: string[]): Candidate {
  const nextMinutes = Math.max(1, Math.round(minutes));
  return { reason, baseMinutes: nextMinutes, nextMinutes, inputsUsed, jitterPercent: 0, jitterMode: 'none' };
}

function candidateFor(input: NextAttemptInput): Candidate {
  const outcome = input.lastOutcome;

  switch (outcome.type) {
    case 'already_running':
      // A manual run is in flight. Come back shortly rather than entering the error
      // backoff - an overlap is not a failure.
      return fixed('already_running', ALREADY_RUNNING_RETRY_MINUTES, ['ALREADY_RUNNING_RETRY_MINUTES']);

    case 'session_lost':
      // SL-002: the bot cannot log itself in (KE-004), so retrying is pointless and
      // the error ladder would only stretch the wait after a person fixes it.
      return fixed('session_required', SESSION_RECHECK_MINUTES, ['SESSION_RECHECK_MINUTES']);

    case 'rate_limited':
      return fixed('rate_limited_cooldown', Math.max(1, outcome.remainingMinutes) + BLOCK_BUFFER_MINUTES, [
        'outcome.remainingMinutes',
      ]);

    case 'system_maintenance':
      // The maintenance notice parser already includes its own buffer.
      return fixed('system_maintenance', Math.max(1, outcome.remainingMinutes), ['outcome.remainingMinutes']);

    case 'unexpected_error': {
      const idx = clamp(outcome.consecutiveFailures - 1, 0, ERROR_BACKOFF_MINUTES.length - 1);
      return fixed('error_backoff', ERROR_BACKOFF_MINUTES[idx] ?? ERROR_BACKOFF_MINUTES[ERROR_BACKOFF_MINUTES.length - 1], [
        'ERROR_BACKOFF_MINUTES',
        'outcome.consecutiveFailures',
      ]);
    }

    case 'success':
      // R1/RTG-002: only a verified publish starts the platform's one-post-per-hour
      // window. A dry run submits nothing, so it keeps the gap-recheck pace.
      return outcome.cooldownApplies
        ? fixed('post_publish_cooldown', PUBLISH_COOLDOWN_WINDOW_MINUTES + BLOCK_BUFFER_MINUTES, [
            'PUBLISH_COOLDOWN_WINDOW_MINUTES',
          ])
        : fixed('gap_recheck', input.controls.gapRecheckIntervalMinutes, ['gapRecheckIntervalMinutes']);

    case 'gap_skip':
      return fixed('gap_recheck', input.controls.gapRecheckIntervalMinutes, ['gapRecheckIntervalMinutes']);

    case 'normal':
      return adaptiveCandidate(input);
  }
}

/**
 * Decide when the publisher should next attempt a run.
 *
 * @returns the chosen time, the reason, and the settings that produced it.
 */
export function nextAttemptAt(input: NextAttemptInput): NextAttempt {
  const candidate = candidateFor(input);
  const candidateDeadlineMs = input.now + candidate.nextMinutes * 60_000;

  // R1/RTG-003: a pending block deadline is state, not a side effect of a setter.
  // Every control-panel save re-enters this function, so clamping here is what stops
  // a save during a cooldown from silently shortening the wait.
  let winner: { field: BlockField; deadlineMs: number; untilMs: number } | null = null;
  for (const field of BLOCK_FIELDS) {
    const raw = input.blocks[field];
    if (!raw) continue;
    const untilMs = new Date(raw).getTime();
    if (!Number.isFinite(untilMs)) continue;
    const deadlineMs = untilMs + BLOCK_BUFFER_MINUTES * 60_000;
    if (deadlineMs <= candidateDeadlineMs) continue;
    if (!winner || deadlineMs > winner.deadlineMs) {
      winner = { field, deadlineMs, untilMs };
    }
  }

  if (!winner) {
    return {
      at: candidateDeadlineMs,
      reason: candidate.reason,
      inputsUsed: candidate.inputsUsed,
      baseMinutes: candidate.baseMinutes,
      nextMinutes: candidate.nextMinutes,
      jitterPercent: candidate.jitterPercent,
      jitterMode: candidate.jitterMode,
      clamp: null,
    };
  }

  const clampedMinutes = Math.max(1, Math.ceil((winner.deadlineMs - input.now) / 60_000));
  return {
    at: winner.deadlineMs,
    reason: 'block_deadline_clamp',
    inputsUsed: [winner.field],
    baseMinutes: clampedMinutes,
    nextMinutes: clampedMinutes,
    jitterPercent: 0,
    jitterMode: 'none',
    clamp: {
      field: winner.field,
      blockedUntilMs: winner.untilMs,
      discardedReason: candidate.reason,
      discardedMinutes: candidate.nextMinutes,
    },
  };
}
