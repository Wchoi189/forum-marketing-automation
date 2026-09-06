/**
 * tests/unit/nextAttemptAdaptive.test.ts
 *
 * R2 / SDU-002 — the scheduler decision table, part 2: the adaptive path, block
 * deadlines, totality and inputsUsed.
 *
 * Split from nextAttempt.test.ts only to stay inside the 500-line file budget.
 * Together the two files are one specification.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { nextAttemptAt, BLOCK_BUFFER_MINUTES } from "../../lib/scheduler/index.js";
import type { SchedulerTickOutcome } from "../../lib/scheduler/index.js";
import { PUBLISH_COOLDOWN_WINDOW_MINUTES } from "../../lib/publisher/index.js";

import { MINUTE, atHour, controlsWith, inputWith, minutesOut } from "./nextAttemptFixtures.js";

// ---------------------------------------------------------------------------
// Adaptive path — each multiplier and dial
// ---------------------------------------------------------------------------

test("adaptive: quiet hours stretch the interval", () => {
  const now = atHour(4);
  const result = nextAttemptAt(
    inputWith({
      now,
      controls: controlsWith({ quietHoursStart: 3, quietHoursEnd: 5, quietHoursMultiplier: 1.8 }),
    })
  );
  assert.strictEqual(result.reason, "adaptive");
  assert.strictEqual(minutesOut(result, now), 108); // 60 * 1.8
  assert.ok(result.inputsUsed.includes("quietHoursMultiplier"));
});

test("adaptive: active hours compress the interval", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      controls: controlsWith({ activeHoursStart: 8, activeHoursEnd: 23, activeHoursMultiplier: 0.8 }),
    })
  );
  assert.strictEqual(minutesOut(result, now), 48); // 60 * 0.8
  assert.ok(result.inputsUsed.includes("activeHoursMultiplier"));
});

test("adaptive: overlapping quiet and active windows multiply, they do not shadow", () => {
  const now = atHour(4);
  const result = nextAttemptAt(
    inputWith({
      now,
      controls: controlsWith({
        quietHoursStart: 3,
        quietHoursEnd: 5,
        quietHoursMultiplier: 1.8,
        activeHoursStart: 0,
        activeHoursEnd: 23,
        activeHoursMultiplier: 0.5,
      }),
    })
  );
  assert.strictEqual(minutesOut(result, now), 54); // 60 * 1.8 * 0.5
});

test("adaptive: outside every window the base interval is used unchanged", () => {
  const now = atHour(6);
  const result = nextAttemptAt(
    inputWith({
      now,
      controls: controlsWith({
        quietHoursStart: 3,
        quietHoursEnd: 5,
        quietHoursMultiplier: 1.8,
        activeHoursStart: 8,
        activeHoursEnd: 23,
        activeHoursMultiplier: 0.8,
      }),
    })
  );
  assert.strictEqual(minutesOut(result, now), 60);
  assert.deepStrictEqual(result.inputsUsed, ["baseIntervalMinutes"]);
});

const MULTIPLIER_TABLE: Array<{
  name: string;
  multipliers: { trend: number; sov: number; opportunity: number };
  expectedMinutes: number;
}> = [
  { name: "all neutral", multipliers: { trend: 1, sov: 1, opportunity: 1 }, expectedMinutes: 60 },
  { name: "trend alone", multipliers: { trend: 1.5, sov: 1, opportunity: 1 }, expectedMinutes: 90 },
  { name: "sov alone", multipliers: { trend: 1, sov: 0.8, opportunity: 1 }, expectedMinutes: 48 },
  { name: "opportunity alone", multipliers: { trend: 1, sov: 1, opportunity: 1.2 }, expectedMinutes: 72 },
  { name: "trend x sov", multipliers: { trend: 1.5, sov: 0.8, opportunity: 1 }, expectedMinutes: 72 },
  { name: "trend x opportunity", multipliers: { trend: 1.5, sov: 1, opportunity: 1.2 }, expectedMinutes: 108 },
  { name: "sov x opportunity", multipliers: { trend: 1, sov: 0.8, opportunity: 1.2 }, expectedMinutes: 58 },
  { name: "all three", multipliers: { trend: 1.5, sov: 0.8, opportunity: 1.25 }, expectedMinutes: 90 },
  // Combined product 3.0 clamps to COMBINED_MULTIPLIER_MAX = 2.0
  { name: "product above the ceiling clamps to 2.0", multipliers: { trend: 2, sov: 1.5, opportunity: 1 }, expectedMinutes: 120 },
  // Combined product 0.24 clamps to COMBINED_MULTIPLIER_MIN = 0.5
  { name: "product below the floor clamps to 0.5", multipliers: { trend: 0.4, sov: 0.6, opportunity: 1 }, expectedMinutes: 30 },
];

for (const row of MULTIPLIER_TABLE) {
  test(`adaptive multipliers: ${row.name}`, () => {
    const now = atHour(12);
    const result = nextAttemptAt(
      inputWith({
        now,
        controls: controlsWith({ trendAdaptiveEnabled: true }),
        multipliers: row.multipliers,
      })
    );
    assert.strictEqual(result.reason, "adaptive");
    assert.strictEqual(minutesOut(result, now), row.expectedMinutes);
  });
}

test("adaptive: trendAdaptiveEnabled=false ignores every multiplier", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      controls: controlsWith({ trendAdaptiveEnabled: false }),
      multipliers: { trend: 2, sov: 2, opportunity: 2 },
    })
  );
  assert.strictEqual(minutesOut(result, now), 60);
  assert.ok(!result.inputsUsed.includes("trendAdaptiveEnabled"));
});

test("adaptive: a positive targetPublishIntervalMinutes blends halfway toward the target", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({ now, controls: controlsWith({ targetPublishIntervalMinutes: 120 }) })
  );
  assert.strictEqual(minutesOut(result, now), 90); // round(60 * 0.5 + 120 * 0.5)
  assert.ok(result.inputsUsed.includes("targetPublishIntervalMinutes"));
});

test("adaptive: targetPublishIntervalMinutes=0 disables the blend", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({ now, controls: controlsWith({ targetPublishIntervalMinutes: 0 }) })
  );
  assert.strictEqual(minutesOut(result, now), 60);
  assert.ok(!result.inputsUsed.includes("targetPublishIntervalMinutes"));
});

test("adaptive: the effective interval is clamped into [1, 1440]", () => {
  const now = atHour(12);
  const huge = nextAttemptAt(
    inputWith({ now, controls: controlsWith({ baseIntervalMinutes: 1440, activeHoursStart: 0, activeHoursEnd: 23, activeHoursMultiplier: 5 }) })
  );
  assert.strictEqual(minutesOut(huge, now), 1440);

  const tiny = nextAttemptAt(
    inputWith({ now, controls: controlsWith({ baseIntervalMinutes: 1, activeHoursStart: 0, activeHoursEnd: 23, activeHoursMultiplier: 0.2 }) })
  );
  assert.strictEqual(minutesOut(tiny, now), 1);
});

// ---------------------------------------------------------------------------
// Jitter — only on the adaptive path, and only with an injected source
// ---------------------------------------------------------------------------

test("jitter is applied to the adaptive interval when a random source is supplied", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      controls: controlsWith({ scheduleJitterPercent: 20, scheduleJitterMode: "uniform" }),
      random: () => 1, // maximum positive slack: factor = 1 + 0.20
    })
  );
  assert.strictEqual(minutesOut(result, now), 72);
  assert.ok(result.inputsUsed.includes("scheduleJitterPercent"));
});

test("jitter is not applied without a random source, so the function stays deterministic", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({ now, controls: controlsWith({ scheduleJitterPercent: 20, scheduleJitterMode: "uniform" }) })
  );
  assert.strictEqual(minutesOut(result, now), 60);
});

test("jitter never touches a non-adaptive reason", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "success", cooldownApplies: true },
      controls: controlsWith({ scheduleJitterPercent: 50, scheduleJitterMode: "uniform" }),
      random: () => 1,
    })
  );
  assert.strictEqual(minutesOut(result, now), PUBLISH_COOLDOWN_WINDOW_MINUTES + 1);
  assert.strictEqual(result.jitterPercent, 0);
});

// ---------------------------------------------------------------------------
// Block deadlines — R1 invariant: an active block is never shortened
// ---------------------------------------------------------------------------

test("R1 invariant: an active publish block extends a shorter candidate", () => {
  const now = atHour(12);
  const blockedUntil = new Date(now + 40 * MINUTE).toISOString();
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "gap_skip" }, // wants 3 minutes
      blocks: { publishBlockedUntil: blockedUntil, maintenanceBlockedUntil: null },
    })
  );
  assert.strictEqual(result.reason, "block_deadline_clamp");
  assert.strictEqual(minutesOut(result, now), 40 + BLOCK_BUFFER_MINUTES);
  assert.strictEqual(result.clamp?.field, "publishBlockedUntil");
  assert.strictEqual(result.clamp?.discardedReason, "gap_recheck");
  assert.ok(result.inputsUsed.includes("publishBlockedUntil"));
});

test("R1 invariant: a block that expires sooner than the candidate never shortens it", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "success", cooldownApplies: true }, // wants 61 minutes
      blocks: {
        publishBlockedUntil: new Date(now + 5 * MINUTE).toISOString(),
        maintenanceBlockedUntil: null,
      },
    })
  );
  assert.strictEqual(result.reason, "post_publish_cooldown");
  assert.strictEqual(minutesOut(result, now), PUBLISH_COOLDOWN_WINDOW_MINUTES + 1);
  assert.strictEqual(result.clamp, null);
});

test("the later of two active blocks wins", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "gap_skip" },
      blocks: {
        publishBlockedUntil: new Date(now + 20 * MINUTE).toISOString(),
        maintenanceBlockedUntil: new Date(now + 50 * MINUTE).toISOString(),
      },
    })
  );
  assert.strictEqual(result.clamp?.field, "maintenanceBlockedUntil");
  assert.strictEqual(minutesOut(result, now), 50 + BLOCK_BUFFER_MINUTES);
});

test("an unparseable block timestamp is ignored rather than producing NaN", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "gap_skip" },
      blocks: { publishBlockedUntil: "not-a-date", maintenanceBlockedUntil: null },
    })
  );
  assert.strictEqual(result.reason, "gap_recheck");
  assert.strictEqual(minutesOut(result, now), 3);
});

test("an already-expired block is ignored", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "gap_skip" },
      blocks: { publishBlockedUntil: new Date(now - 90 * MINUTE).toISOString(), maintenanceBlockedUntil: null },
    })
  );
  assert.strictEqual(result.reason, "gap_recheck");
  assert.strictEqual(result.clamp, null);
});

test("a block clamps the adaptive path too, not only the fixed-interval reasons", () => {
  const now = atHour(12);
  const result = nextAttemptAt(
    inputWith({
      now,
      lastOutcome: { type: "normal" }, // wants 60 minutes
      blocks: { publishBlockedUntil: new Date(now + 120 * MINUTE).toISOString(), maintenanceBlockedUntil: null },
    })
  );
  assert.strictEqual(result.reason, "block_deadline_clamp");
  assert.strictEqual(minutesOut(result, now), 121);
  assert.strictEqual(result.clamp?.discardedReason, "adaptive");
});

// ---------------------------------------------------------------------------
// Totality and purity
// ---------------------------------------------------------------------------

test("the function is total: every outcome variant returns a finite future time", () => {
  const now = atHour(12);
  const everyOutcome: SchedulerTickOutcome[] = [
    { type: "rate_limited", remainingMinutes: 10 },
    { type: "system_maintenance", remainingMinutes: 10 },
    { type: "gap_skip" },
    { type: "gap_skip", gapInfo: { currentGap: 1, requiredGap: 4 } },
    { type: "success", cooldownApplies: true },
    { type: "success", cooldownApplies: false },
    { type: "already_running" },
    { type: "unexpected_error", consecutiveFailures: 1 },
    { type: "normal" },
  ];

  for (const lastOutcome of everyOutcome) {
    for (const blocks of [
      { publishBlockedUntil: null, maintenanceBlockedUntil: null },
      { publishBlockedUntil: new Date(now + 999 * MINUTE).toISOString(), maintenanceBlockedUntil: null },
    ]) {
      const result = nextAttemptAt(inputWith({ now, lastOutcome, blocks }));
      assert.ok(Number.isFinite(result.at), `${lastOutcome.type} produced a non-finite time`);
      assert.ok(result.at > now, `${lastOutcome.type} produced a non-future time`);
      assert.ok(result.inputsUsed.length > 0, `${lastOutcome.type} reported no inputs`);
      assert.ok(Number.isFinite(result.nextMinutes) && result.nextMinutes >= 1);
    }
  }
});

test("the function is pure: identical input yields an identical result", () => {
  const build = () => inputWith({ now: atHour(9), controls: controlsWith({ trendAdaptiveEnabled: true }) });
  assert.deepStrictEqual(nextAttemptAt(build()), nextAttemptAt(build()));
});

test("the function does not mutate its input", () => {
  const input = inputWith({ lastOutcome: { type: "unexpected_error", consecutiveFailures: 2 } });
  const snapshot = JSON.parse(JSON.stringify(input));
  nextAttemptAt(input);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(input)), snapshot);
});

// ---------------------------------------------------------------------------
// inputsUsed — the answer to "which settings produced this interval?"
// ---------------------------------------------------------------------------

const INPUTS_USED_TABLE: Array<{ outcome: SchedulerTickOutcome; expected: string[] }> = [
  { outcome: { type: "already_running" }, expected: ["ALREADY_RUNNING_RETRY_MINUTES"] },
  { outcome: { type: "rate_limited", remainingMinutes: 5 }, expected: ["outcome.remainingMinutes"] },
  { outcome: { type: "system_maintenance", remainingMinutes: 5 }, expected: ["outcome.remainingMinutes"] },
  {
    outcome: { type: "unexpected_error", consecutiveFailures: 2 },
    expected: ["ERROR_BACKOFF_MINUTES", "outcome.consecutiveFailures"],
  },
  { outcome: { type: "success", cooldownApplies: true }, expected: ["PUBLISH_COOLDOWN_WINDOW_MINUTES"] },
  { outcome: { type: "gap_skip" }, expected: ["gapRecheckIntervalMinutes"] },
];

for (const row of INPUTS_USED_TABLE) {
  test(`inputsUsed names the settings behind ${row.outcome.type}`, () => {
    const result = nextAttemptAt(inputWith({ lastOutcome: row.outcome }));
    assert.deepStrictEqual(result.inputsUsed, row.expected);
  });
}

test("inputsUsed on the adaptive path lists only the dials that actually applied", () => {
  const result = nextAttemptAt(
    inputWith({
      now: atHour(4),
      controls: controlsWith({
        quietHoursStart: 3,
        quietHoursEnd: 5,
        quietHoursMultiplier: 1.8,
        activeHoursStart: 8,
        activeHoursEnd: 23,
        activeHoursMultiplier: 0.8,
        trendAdaptiveEnabled: true,
        targetPublishIntervalMinutes: 120,
      }),
      multipliers: { trend: 1.2, sov: 1, opportunity: 1 },
    })
  );

  assert.deepStrictEqual(result.inputsUsed, [
    "baseIntervalMinutes",
    "quietHoursStart",
    "quietHoursEnd",
    "quietHoursMultiplier",
    "trendAdaptiveEnabled",
    "multipliers.trend",
    "multipliers.sov",
    "multipliers.opportunity",
    "targetPublishIntervalMinutes",
  ]);
  // The active-hours window does not contain 04:00, so its dials are absent.
  assert.ok(!result.inputsUsed.includes("activeHoursMultiplier"));
});
