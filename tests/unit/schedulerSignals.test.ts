import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { PublisherHistoryEntry } from "../../contracts/models.ts";
import {
  buildSchedulerAdaptationWindows,
  buildSchedulerSignalTimeline,
  classifySchedulerSignal,
  summarizeSchedulerSignals,
} from "../../lib/schedulerSignals.ts";

type FixturePayload = {
  id: string;
  description: string;
  entries: PublisherHistoryEntry[];
};

function readFixture(name: string): FixturePayload {
  const filePath = path.join(process.cwd(), "tests", "fixtures", "scheduler-signals", `${name}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as FixturePayload;
}

test("classifySchedulerSignal marks gap_policy as non-eligible gap_recheck", () => {
  const classified = classifySchedulerSignal({
    at: "2026-04-01T00:00:00.000Z",
    success: false,
    decision: "gap_policy",
  });

  assert.ok(classified);
  assert.equal(classified?.primaryClass, "gap_recheck");
  assert.equal(classified?.adaptationEligible, false);
  assert.deepEqual(classified?.classes, ["gap_recheck"]);
});

test("recheck-heavy fixture keeps isolated multiplier stable despite skip volume", () => {
  const fixture = readFixture("fixture-recheck-heavy");
  const summary = summarizeSchedulerSignals(fixture.entries, {
    windowDays: 30,
    nowMs: Date.parse("2026-04-30T00:00:00.000Z"),
  });

  assert.ok(summary.gapRecheckCount > summary.publishAttemptCount);
  assert.ok(summary.isolatedMultiplier <= 1);
  assert.ok(summary.baselineMultiplier >= summary.isolatedMultiplier);

  const timeline = buildSchedulerSignalTimeline(fixture.entries, {
    windowDays: 30,
    nowMs: Date.parse("2026-04-30T00:00:00.000Z"),
  });
  const windows = buildSchedulerAdaptationWindows(timeline, 4);
  const skipHeavyWindows = windows.filter((window) => window.gapRecheckCount / window.totalSignalCount >= 0.5);
  assert.ok(skipHeavyWindows.length > 0, "expected skip-heavy windows in fixture");
  assert.ok(skipHeavyWindows.every((window) => window.isolatedMultiplier <= 1));
});

test("opportunity-shift fixture produces degraded adaptation window", () => {
  const fixture = readFixture("fixture-opportunity-shift");
  const timeline = buildSchedulerSignalTimeline(fixture.entries, {
    windowDays: 30,
    nowMs: Date.parse("2026-04-30T00:00:00.000Z"),
  });
  const windows = buildSchedulerAdaptationWindows(timeline, 6);

  assert.ok(windows.length >= 2, "expected multiple adaptation windows");
  const degraded = windows.find((window) => window.reason === "opportunity_degraded");
  assert.ok(degraded, "expected at least one degraded opportunity window");
  assert.ok((degraded?.isolatedMultiplier ?? 0) > 1);
});
