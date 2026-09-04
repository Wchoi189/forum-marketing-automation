import test from "node:test";
import assert from "node:assert/strict";
import { startScheduler } from "../../lib/scheduler/index.js";
import type { BotDeps } from "../../lib/scheduler/index.js";
import type { PublisherRunResult } from "../../lib/publisher/index.js";

function createMockDeps(publisherImpl: () => Promise<PublisherRunResult>): BotDeps {
  return {
    runObserver: async () => ({
      timestamp: new Date().toISOString(),
      status: "safe",
      current_gap_count: 5,
      last_post_timestamp: "10:00",
      top_competitor_names: [],
      view_count_of_last_post: 0,
      all_posts: [],
    }),
    runPublisher: publisherImpl,
    getLogs: async () => [],
    getPublisherHistory: async () => [],
  };
}

test("scheduler schedules next tick for remainingMinutes + 1 on rate_limited", async () => {
  let publisherCalls = 0;
  const deps = createMockDeps(async () => {
    publisherCalls += 1;
    return {
      success: false,
      message: "Rate limited",
      runId: "run-rate-limited",
      decision: "rate_limited",
      artifactDir: null,
      cooldownRemainingMinutes: 45,
    };
  });

  const scheduler = startScheduler(deps, 10);
  try {
    await scheduler.runNow();
    const state = await scheduler.getState();

    assert.strictEqual(publisherCalls, 1);
    assert.ok(state.nextTickEta, "Expected nextTickEta to be set");
    const nextTickMs = new Date(state.nextTickEta).getTime();
    const expectedApproxMs = Date.now() + 46 * 60 * 1000; // 45m + 1m buffer
    const diffSeconds = Math.abs(nextTickMs - expectedApproxMs) / 1000;

    assert.ok(diffSeconds < 5, `Expected next tick near 46 minutes, got diff of ${diffSeconds}s`);
  } finally {
    scheduler.stop();
  }
});

test("scheduler applies progressive exponential backoff (15m -> 30m -> 60m) on unexpected errors", async () => {
  let publisherCalls = 0;
  const deps = createMockDeps(async () => {
    publisherCalls += 1;
    return {
      success: false,
      message: "Unexpected error",
      runId: `run-err-${publisherCalls}`,
      decision: "publisher_error",
      artifactDir: null,
    };
  });

  const scheduler = startScheduler(deps, 10);
  try {
    // 1st failure -> 15 min
    await scheduler.runNow();
    let state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 1);
    let nextTickMs = new Date(state.nextTickEta!).getTime();
    let diffSeconds = Math.abs(nextTickMs - (Date.now() + 15 * 60 * 1000)) / 1000;
    assert.ok(diffSeconds < 5, `1st failure should back off ~15m, got diff of ${diffSeconds}s`);

    // 2nd failure -> 30 min
    await scheduler.runNow();
    state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 2);
    nextTickMs = new Date(state.nextTickEta!).getTime();
    diffSeconds = Math.abs(nextTickMs - (Date.now() + 30 * 60 * 1000)) / 1000;
    assert.ok(diffSeconds < 5, `2nd failure should back off ~30m, got diff of ${diffSeconds}s`);

    // 3rd failure -> 60 min
    await scheduler.runNow();
    state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 3);
    nextTickMs = new Date(state.nextTickEta!).getTime();
    diffSeconds = Math.abs(nextTickMs - (Date.now() + 60 * 60 * 1000)) / 1000;
    assert.ok(diffSeconds < 5, `3rd failure should back off ~60m, got diff of ${diffSeconds}s`);
  } finally {
    scheduler.stop();
  }
});

test("scheduler resets consecutiveFailures on successful publish", async () => {
  let decision: PublisherRunResult["decision"] = "publisher_error";
  const deps = createMockDeps(async () => ({
    success: decision === "published_verified",
    message: "status",
    runId: "run-test",
    decision,
    artifactDir: null,
  }));

  const scheduler = startScheduler(deps, 10);
  try {
    // Error
    await scheduler.runNow();
    let state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 1);

    // Success
    decision = "published_verified";
    await scheduler.runNow();
    state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 0);
  } finally {
    scheduler.stop();
  }
});

test("scheduler schedules next tick directly for maintenanceRemainingMinutes on system_maintenance", async () => {
  let publisherCalls = 0;
  const deps = createMockDeps(async () => {
    publisherCalls += 1;
    return {
      success: false,
      message: "Platform maintenance active",
      runId: "run-maint",
      decision: "system_maintenance",
      artifactDir: null,
      maintenanceRemainingMinutes: 125,
    };
  });

  const scheduler = startScheduler(deps, 10);
  try {
    await scheduler.runNow();
    const state = await scheduler.getState();

    assert.strictEqual(publisherCalls, 1);
    // Maintenance is expected downtime, consecutiveFailures must remain 0
    assert.strictEqual(state.consecutiveFailures, 0);
    assert.ok(state.nextTickEta, "Expected nextTickEta to be set");
    const nextTickMs = new Date(state.nextTickEta).getTime();
    const expectedApproxMs = Date.now() + 125 * 60 * 1000;
    const diffSeconds = Math.abs(nextTickMs - expectedApproxMs) / 1000;

    assert.ok(diffSeconds < 5, `Expected next tick near 125 minutes, got diff of ${diffSeconds}s`);
  } finally {
    scheduler.stop();
  }
});

test("scheduler preserves zero consecutiveFailures on repeated system_maintenance ticks", async () => {
  let publisherCalls = 0;
  const deps = createMockDeps(async () => {
    publisherCalls += 1;
    return {
      success: false,
      message: "Platform maintenance active",
      runId: `run-maint-${publisherCalls}`,
      decision: "system_maintenance",
      artifactDir: null,
      maintenanceRemainingMinutes: 30,
    };
  });

  const scheduler = startScheduler(deps, 10);
  try {
    await scheduler.runNow();
    let state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 0);

    await scheduler.runNow();
    state = await scheduler.getState();
    assert.strictEqual(state.consecutiveFailures, 0);
  } finally {
    scheduler.stop();
  }
});

