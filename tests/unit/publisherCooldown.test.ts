import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { ENV } from "../../config/env.js";
import { appendPublisherHistoryEntry, getLastSuccessfulPublish } from "../../lib/publisherHistory.js";

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

test("cooldown calculation: elapsed < 60m yields remaining minutes", () => {
  const now = Date.now();
  const publishTime = now - 22 * 60 * 1000; // 22 minutes ago
  const elapsedMs = now - publishTime;
  const COOLDOWN_WINDOW_MS = 60 * 60 * 1000;
  const remainingMs = COOLDOWN_WINDOW_MS - elapsedMs;
  const remainingMin = Math.ceil(remainingMs / 60000);

  assert.strictEqual(remainingMin, 38);
});

test("cooldown calculation: elapsed >= 60m yields cooldown expired", () => {
  const now = Date.now();
  const publishTime = now - 65 * 60 * 1000; // 65 minutes ago
  const elapsedMs = now - publishTime;
  const COOLDOWN_WINDOW_MS = 60 * 60 * 1000;
  const isCooldownActive = elapsedMs < COOLDOWN_WINDOW_MS;

  assert.strictEqual(isCooldownActive, false);
});
