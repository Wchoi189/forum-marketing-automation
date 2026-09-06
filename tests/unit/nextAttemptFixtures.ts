/**
 * tests/unit/nextAttemptFixtures.ts
 *
 * Shared fixtures for the R2 scheduler decision table. Not a test file: the
 * suite glob is tests/unit/*.test.ts, so this module is imported, never executed
 * on its own.
 *
 * The table is split across nextAttempt.test.ts (outcomes, error backoff) and
 * nextAttemptAdaptive.test.ts (the adaptive dials, blocks, totality) only to stay
 * inside the 500-line file budget. Together they are one specification.
 */

import type { NextAttemptInput } from "../../lib/scheduler/index.js";
import type { AutoPublisherControls } from "../../lib/scheduler/index.js";

export const MINUTE = 60_000;

/**
 * A local-time timestamp. Built with the Date(y, m, d, h) constructor so the
 * hour the scheduler reads back is `hour` in every timezone the suite runs in.
 */
export function atHour(hour: number): number {
  return new Date(2026, 0, 15, hour, 0, 0, 0).getTime();
}

/**
 * Controls with every adaptive dial neutral. Each test turns on only the dial
 * it is exercising, so an unexpected interaction shows up as a failure in the
 * test that owns the other dial.
 */
export function controlsWith(patch: Partial<AutoPublisherControls> = {}): AutoPublisherControls {
  return {
    enabled: true,
    baseIntervalMinutes: 60,
    quietHoursStart: 0,
    quietHoursEnd: 0,
    quietHoursMultiplier: 1,
    activeHoursStart: 0,
    activeHoursEnd: 0,
    activeHoursMultiplier: 1,
    trendAdaptiveEnabled: false,
    trendWindowDays: 7,
    trendRecalibrationDays: 7,
    scheduleJitterPercent: 0,
    scheduleJitterMode: "none",
    targetPublishIntervalMinutes: 0,
    gapRecheckIntervalMinutes: 3,
    ...patch,
  };
}

export function inputWith(patch: Partial<NextAttemptInput> = {}): NextAttemptInput {
  return {
    now: atHour(12),
    lastOutcome: { type: "normal" },
    blocks: { publishBlockedUntil: null, maintenanceBlockedUntil: null },
    controls: controlsWith(),
    multipliers: { trend: 1, sov: 1, opportunity: 1 },
    ...patch,
  };
}

/** Minutes from `now` to the returned attempt time. */
export function minutesOut(result: { at: number }, now: number): number {
  return (result.at - now) / MINUTE;
}
