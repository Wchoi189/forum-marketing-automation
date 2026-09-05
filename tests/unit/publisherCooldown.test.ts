import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { ENV } from "../../config/env.js";
import { appendPublisherHistoryEntry, getLastSuccessfulPublish, runPublisher } from "../../lib/publisher/index.js";
import { setPublisherControls } from "../../lib/state/index.js";

test("getLastSuccessfulPublish retrieves newest verified publish and skips errors", async () => {
  const testDir = path.join(ENV.ARTIFACTS_DIR, "publisher-history");
  await fs.mkdir(testDir, { recursive: true });

  const now = Date.now();
  const t1 = new Date(now - 45 * 60 * 1000).toISOString(); // 45m ago - verified publish
  const t2 = new Date(now - 30 * 60 * 1000).toISOString(); // 30m ago - rate_limited skip
  const t3 = new Date(now - 10 * 60 * 1000).toISOString(); // 10m ago - publisher_error

  await appendPublisherHistoryEntry({
    at: t1,
    success: true,
    force: false,
    message: "Published verified post",
    runId: "run-success-1",
    decision: "published_verified",
  });

  await appendPublisherHistoryEntry({
    at: t2,
    success: false,
    force: false,
    message: "Rate limited skip",
    runId: "run-rate-limited-1",
    decision: "rate_limited",
  });

  await appendPublisherHistoryEntry({
    at: t3,
    success: false,
    force: false,
    message: "Some error",
    runId: "run-error-1",
    decision: "publisher_error",
  });

  const lastPublish = await getLastSuccessfulPublish(20);
  assert.ok(lastPublish, "Expected last publish to be found");
  assert.strictEqual(lastPublish.runId, "run-success-1");
  assert.strictEqual(lastPublish.decision, "published_verified");
  assert.strictEqual(lastPublish.success, true);
});

/**
 * RTG-001 regression guard.
 *
 * The rate-limit gates must short-circuit before runObserver() launches
 * Chromium. Asserted with an injected spy, not by log inspection: if the gates
 * ever drift back below the observer call, observerCalls becomes 1.
 */
test("publisher run during an active cooldown never invokes the observer", async () => {
  const blockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  setPublisherControls({ publishBlockedUntil: blockedUntil });

  let observerCalls = 0;
  try {
    const result = await runPublisher(false, {
      runObserver: async () => {
        observerCalls += 1;
        throw new Error("observer must not run while a cooldown is active");
      },
    });

    assert.strictEqual(observerCalls, 0, "Observer (and therefore Chromium) must not be launched");
    assert.strictEqual(result.decision, "rate_limited");
    assert.strictEqual(result.artifactDir, null, "No browser artifacts should be created");
    assert.ok(
      (result.cooldownRemainingMinutes ?? 0) >= 29,
      `Expected ~30 minutes remaining, got ${result.cooldownRemainingMinutes}`
    );
  } finally {
    setPublisherControls({ publishBlockedUntil: null });
  }
});

/**
 * RTG-004 regression guard (publisher half).
 *
 * The concurrency guard used to report `publisher_error`, which the scheduler
 * counts as a failure. It is a benign overlap and gets its own decision.
 */
test("an overlapping publisher run is reported as already_running, not publisher_error", async () => {
  let releaseObserver: (() => void) | null = null;
  const observerReached = new Promise<void>((resolve) => {
    releaseObserver = resolve;
  });

  const first = runPublisher(true, {
    runObserver: async () => {
      releaseObserver?.();
      // Fail the in-flight run rather than proceeding into the browser flow.
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("observer stub");
    },
  });

  await observerReached;
  const overlapping = await runPublisher(false);

  assert.strictEqual(overlapping.decision, "already_running");
  assert.strictEqual(overlapping.success, false);
  assert.strictEqual(overlapping.artifactDir, null);

  const firstResult = await first;
  assert.strictEqual(firstResult.decision, "publisher_error");
});
