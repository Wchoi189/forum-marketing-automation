import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityLog, PublisherHistoryEntry } from "../../contracts/models.ts";
import type { TrendInsightsPayload } from "../../lib/trendInsights.ts";
import { buildAdvisorContext, callGrokAdvisor, setAdvisorCache, getAdvisorCache } from "../../lib/aiAdvisor.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTrend(overrides: Partial<TrendInsightsPayload> = {}): TrendInsightsPayload {
  return {
    windowDays: 7,
    referenceBaseIntervalMinutes: 60,
    trendAdaptiveEnabled: true,
    recentSnapshotCount: 10,
    pairSampleCount: 9,
    avgNewPostsPerHour: 8,
    volatility: 0.3,
    confidence: 0.7,
    confidenceReason: "empirical_window",
    trendMultiplier: 1,
    multiplierBand: "balanced",
    recommendedIntervalMinutesQuiet: 108,
    recommendedIntervalMinutesActive: 48,
    hourlyProfile: Array.from({ length: 24 }, (_, hour) => ({ hour, avgNewPostsPerHour: 5 })),
    explanation: "test",
    precedenceNote: "test",
    sovPercent: 10,
    sovFactor: 1,
    ...overrides,
  };
}

function makeLog(ts = "2026-04-11T00:00:00.000Z"): ActivityLog {
  return {
    timestamp: ts,
    current_gap_count: 3,
    gap_threshold_min: 5,
    last_post_timestamp: ts,
    top_competitor_names: [],
    view_count_of_last_post: 100,
    status: "safe",
    all_posts: [],
  };
}

function makeHistoryEntries(n: number): PublisherHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
    success: i % 3 !== 2,
    force: false,
    message: "ok",
    decision: (i % 3 === 2 ? "gap_policy" : "published_verified") as PublisherHistoryEntry["decision"],
  }));
}

const baseControls = {
  baseIntervalMinutes: 60,
  scheduleJitterPercent: 15,
  enabled: true,
  trendAdaptiveEnabled: true,
};

// ---------------------------------------------------------------------------
// buildAdvisorContext
// ---------------------------------------------------------------------------

test("buildAdvisorContext — produces valid context shape from fixture inputs", () => {
  const trend = makeTrend();
  const history = makeHistoryEntries(10);
  const log = makeLog();

  const ctx = buildAdvisorContext(trend, history, log, baseControls);

  assert.ok(typeof ctx.meta.contextBuiltAt === "string", "contextBuiltAt is a string");
  assert.ok(ctx.meta.currentHour >= 0 && ctx.meta.currentHour <= 23, "currentHour in 0–23");

  assert.ok(typeof ctx.trend.avgNewPostsPerHour === "number");
  assert.ok(typeof ctx.trend.sovPercent === "number");
  assert.ok(Array.isArray(ctx.trend.hourlyProfile));

  assert.equal(ctx.recentRuns.entries.length, 10);
  assert.ok(ctx.recentRuns.successRate >= 0 && ctx.recentRuns.successRate <= 1);
  assert.ok(ctx.recentRuns.gapPolicyRate >= 0 && ctx.recentRuns.gapPolicyRate <= 1);
  assert.ok(ctx.recentRuns.errorRate >= 0 && ctx.recentRuns.errorRate <= 1);

  assert.equal(ctx.currentBoard?.current_gap_count, 3);
  assert.equal(ctx.currentBoard?.status, "safe");

  assert.equal(ctx.controls.intervalMinutes, 60);
  assert.equal(ctx.controls.schedulerEnabled, true);
});

test("buildAdvisorContext — handles empty history", () => {
  const ctx = buildAdvisorContext(makeTrend(), [], makeLog(), baseControls);
  assert.equal(ctx.recentRuns.entries.length, 0);
  assert.equal(ctx.recentRuns.successRate, 0);
  assert.equal(ctx.recentRuns.gapPolicyRate, 0);
  assert.equal(ctx.recentRuns.errorRate, 0);
});

test("buildAdvisorContext — handles null latestLog", () => {
  const ctx = buildAdvisorContext(makeTrend(), makeHistoryEntries(5), null, baseControls);
  assert.equal(ctx.currentBoard, null);
});

test("buildAdvisorContext — caps history at 10 entries", () => {
  const ctx = buildAdvisorContext(makeTrend(), makeHistoryEntries(25), makeLog(), baseControls);
  assert.equal(ctx.recentRuns.entries.length, 10);
});

// ---------------------------------------------------------------------------
// callGrokAdvisor — mocked fetch
// ---------------------------------------------------------------------------

const VALID_RESPONSE = {
  recommendedIntervalMinutes: 45,
  recommendedGapThreshold: 4,
  reasoning: "Board activity is moderate; current SoV is healthy.",
  confidence: "medium",
  signalsUsed: ["avgNewPostsPerHour", "sovPercent"],
};

function makeFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withEnvKey<T>(fn: () => T): T {
  // The module reads ENV at import time, so we patch the module's ENV reference via a local
  // approach: we set process.env before calling and rely on the module having already loaded.
  // Since callGrokAdvisor checks ENV.XAI_API_KEY at call-time (not module-load), patching
  // process.env is not useful here. Instead, we use the already-set XAI_API_KEY from the
  // real ENV (which is set in .env and loaded by dotenv at module init).
  //
  // For unit tests, we directly supply a mock fetch and verify behaviour through return values.
  return fn();
}

test("callGrokAdvisor — happy path returns clamped recommendation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeFetchResponse({
      choices: [{ message: { content: JSON.stringify(VALID_RESPONSE) } }],
    });

  try {
    const ctx = buildAdvisorContext(makeTrend(), makeHistoryEntries(5), makeLog(), baseControls);
    const result = await callGrokAdvisor(ctx);

    assert.ok(result.ok, `Expected ok=true, got: ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(result.recommendation.recommendedIntervalMinutes, 45);
      assert.equal(result.recommendation.recommendedGapThreshold, 4);
      assert.equal(result.recommendation.confidence, "medium");
      assert.ok(Array.isArray(result.recommendation.signalsUsed));
      assert.ok(typeof result.recommendation.generatedAt === "string");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callGrokAdvisor — output clamping: intervalMinutes 9999 → 480, gapThreshold 99 → 50", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...VALID_RESPONSE,
              recommendedIntervalMinutes: 9999,
              recommendedGapThreshold: 99,
            }),
          },
        },
      ],
    });

  try {
    const ctx = buildAdvisorContext(makeTrend(), [], makeLog(), baseControls);
    const result = await callGrokAdvisor(ctx);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.recommendation.recommendedIntervalMinutes, 480);
      assert.equal(result.recommendation.recommendedGapThreshold, 50);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callGrokAdvisor — timeout → returns { ok: false }", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    // Simulate abort by throwing AbortError
    const signal = init?.signal as AbortSignal | undefined;
    if (signal) {
      await new Promise<void>((resolve) => {
        // Wait for the signal to abort or just throw immediately if already aborted
        if (signal.aborted) {
          const err = new DOMException("The operation was aborted.", "AbortError");
          throw err;
        }
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
      const err = new DOMException("The operation was aborted.", "AbortError");
      throw err;
    }
    throw new Error("No signal provided");
  };

  try {
    const ctx = buildAdvisorContext(makeTrend(), [], makeLog(), baseControls);
    const result = await callGrokAdvisor(ctx);

    assert.equal(result.ok, false, "Expected ok=false for timed out call");
    const { reason } = result as { ok: false; reason: string };
    assert.ok(
      reason.includes("timed out") || reason.includes("aborted") || reason.includes("failed"),
      `Expected timeout/abort message, got: ${reason}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callGrokAdvisor — malformed JSON response → returns { ok: false }", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeFetchResponse({
      choices: [{ message: { content: "not valid json {{{{" } }],
    });

  try {
    const ctx = buildAdvisorContext(makeTrend(), [], makeLog(), baseControls);
    const result = await callGrokAdvisor(ctx);

    assert.equal(result.ok, false, "Expected ok=false for malformed JSON");
    const { reason } = result as { ok: false; reason: string };
    assert.ok(
      reason.includes("parse") || reason.includes("JSON"),
      `Expected parse error, got: ${reason}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callGrokAdvisor — schema validation failure → returns { ok: false }", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              // Missing required fields
              recommendedIntervalMinutes: 60,
            }),
          },
        },
      ],
    });

  try {
    const ctx = buildAdvisorContext(makeTrend(), [], makeLog(), baseControls);
    const result = await callGrokAdvisor(ctx);

    assert.equal(result.ok, false, "Expected ok=false for schema validation failure");
    const { reason } = result as { ok: false; reason: string };
    assert.ok(
      reason.includes("schema") || reason.includes("validation"),
      `Expected schema validation error, got: ${reason}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test("setAdvisorCache / getAdvisorCache — stores and retrieves result", () => {
  const result = {
    ok: true as const,
    recommendation: {
      recommendedIntervalMinutes: 60,
      recommendedGapThreshold: 5,
      reasoning: "test",
      confidence: "high" as const,
      signalsUsed: ["sovPercent"],
      generatedAt: new Date().toISOString(),
    },
    contextBuiltAt: new Date().toISOString(),
  };

  setAdvisorCache(result);
  const cached = getAdvisorCache();

  assert.ok(cached !== null);
  assert.ok(typeof cached!.cachedAt === "string");
  assert.deepEqual(cached!.result, result);
});
