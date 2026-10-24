/**
 * tests/unit/nextAttempt.test.ts
 *
 * R2 / SDU-002 — the scheduler decision table, part 1: outcome to interval.
 *
 * This file and nextAttemptAdaptive.test.ts are one specification;
 * lib/scheduler/nextAttempt.ts is its implementation. Neither constructs a clock,
 * a store or a scheduler: every input is passed explicitly, so a failure here is a
 * decision-table failure and never a timing flake.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { nextAttemptAt, ERROR_BACKOFF_MINUTES, ALREADY_RUNNING_RETRY_MINUTES, SESSION_RECHECK_MINUTES } from "../../lib/scheduler/index.js";
import type { SchedulerTickOutcome, AutoPublisherControls } from "../../lib/scheduler/index.js";
import { PUBLISH_COOLDOWN_WINDOW_MINUTES } from "../../lib/publisher/index.js";

import { atHour, controlsWith, inputWith, minutesOut } from "./nextAttemptFixtures.js";

// ---------------------------------------------------------------------------
// Outcome x reason x interval — the core table
// ---------------------------------------------------------------------------

const OUTCOME_TABLE: Array<{
  name: string;
  outcome: SchedulerTickOutcome;
  controls?: Partial<AutoPublisherControls>;
  expectedMinutes: number;
  expectedReason: string;
}> = [
  {
    name: "already_running retries in one minute and never enters backoff",
    outcome: { type: "already_running" },
    expectedMinutes: ALREADY_RUNNING_RETRY_MINUTES,
    expectedReason: "already_running",
  },
  {
    name: "rate_limited waits the reported remainder plus a one-minute buffer",
    outcome: { type: "rate_limited", remainingMinutes: 27 },
    expectedMinutes: 28,
    expectedReason: "rate_limited_cooldown",
  },
  {
    name: "rate_limited floors a non-positive remainder at one minute",
    outcome: { type: "rate_limited", remainingMinutes: 0 },
    expectedMinutes: 2,
    expectedReason: "rate_limited_cooldown",
  },
  {
    name: "system_maintenance uses the reported remainder as-is (parser adds its own buffer)",
    outcome: { type: "system_maintenance", remainingMinutes: 30 },
    expectedMinutes: 30,
    expectedReason: "system_maintenance",
  },
  {
    name: "R1 invariant: a verified publish waits the full platform cooldown plus a buffer",
    outcome: { type: "success", cooldownApplies: true },
    expectedMinutes: PUBLISH_COOLDOWN_WINDOW_MINUTES + 1,
    expectedReason: "post_publish_cooldown",
  },
  {
    name: "a dry run submits nothing, so it keeps the gap-recheck pace",
    outcome: { type: "success", cooldownApplies: false },
    expectedMinutes: 3,
    expectedReason: "gap_recheck",
  },
  {
    name: "gap_skip rechecks at the configured gap interval",
    outcome: { type: "gap_skip" },
    expectedMinutes: 3,
    expectedReason: "gap_recheck",
  },
  {
    name: "gap_recheck honours a non-default gapRecheckIntervalMinutes",
    outcome: { type: "gap_skip" },
    controls: { gapRecheckIntervalMinutes: 7 },
    expectedMinutes: 7,
    expectedReason: "gap_recheck",
  },
  {
    name: "SL-002: a dead session parks at the recheck interval instead of entering the error ladder",
    outcome: { type: "session_lost" },
    expectedMinutes: SESSION_RECHECK_MINUTES,
    expectedReason: "session_required",
  },
  {
    name: "SL-002: the park ignores the adaptive dials and gap interval",
    outcome: { type: "session_lost" },
    controls: { gapRecheckIntervalMinutes: 7, baseIntervalMinutes: 240, scheduleJitterMode: "uniform", scheduleJitterPercent: 50 },
    expectedMinutes: SESSION_RECHECK_MINUTES,
    expectedReason: "session_required",
  },
  {
    name: "normal falls through to the adaptive path",
    outcome: { type: "normal" },
    expectedMinutes: 60,
    expectedReason: "adaptive",
  },
];

for (const row of OUTCOME_TABLE) {
  test(`decision table: ${row.name}`, () => {
    const now = atHour(12);
    const result = nextAttemptAt(
      inputWith({ now, lastOutcome: row.outcome, controls: controlsWith(row.controls) })
    );
    assert.strictEqual(result.reason, row.expectedReason);
    assert.strictEqual(minutesOut(result, now), row.expectedMinutes);
  });
}

// ---------------------------------------------------------------------------
// Error backoff — each step
// ---------------------------------------------------------------------------

test("error backoff walks 15 -> 30 -> 60 and then holds at 60", () => {
  const now = atHour(12);
  const expected = [
    [1, ERROR_BACKOFF_MINUTES[0]],
    [2, ERROR_BACKOFF_MINUTES[1]],
    [3, ERROR_BACKOFF_MINUTES[2]],
    [4, ERROR_BACKOFF_MINUTES[2]],
    [99, ERROR_BACKOFF_MINUTES[2]],
  ] as const;

  for (const [failures, minutes] of expected) {
    const result = nextAttemptAt(
      inputWith({ now, lastOutcome: { type: "unexpected_error", consecutiveFailures: failures } })
    );
    assert.strictEqual(result.reason, "error_backoff", `failures=${failures}`);
    assert.strictEqual(minutesOut(result, now), minutes, `failures=${failures}`);
  }
});

test("error backoff treats a zero failure count as the first step rather than indexing off the end", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({ now, lastOutcome: { type: "unexpected_error", consecutiveFailures: 0 } })
  );
  assert.strictEqual(minutesOut(result, now), ERROR_BACKOFF_MINUTES[0]);
});

// ---------------------------------------------------------------------------
// SL-002 — session park
// ---------------------------------------------------------------------------

test("SL-002: the session park is never jittered, even with a randomness source", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "session_lost" },
      controls: controlsWith({ scheduleJitterMode: "uniform", scheduleJitterPercent: 50 }),
      random: () => 0.99,
    })
  );
  assert.strictEqual(result.reason, "session_required");
  assert.strictEqual(result.jitterPercent, 0);
  assert.strictEqual(minutesOut(result, now), SESSION_RECHECK_MINUTES);
});

test("SL-002: a later block deadline still clamps the session recheck", () => {
  const now = atHour(12);
  const blockedUntil = new Date(now + 90 * 60_000).toISOString();
  const result = nextAttemptAt(
    inputWith({ now, lastOutcome: { type: "session_lost" }, blocks: { publishBlockedUntil: null, maintenanceBlockedUntil: blockedUntil } })
  );
  assert.strictEqual(result.reason, "block_deadline_clamp");
  assert.strictEqual(result.clamp?.discardedReason, "session_required");
});
