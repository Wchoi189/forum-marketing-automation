import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { createApp, startScheduler } from "../../server.ts";
import { validateRuntimeContracts } from "../../config/runtime-validation.ts";
import type { ActivityLog, Post } from "../../contracts/models.ts";
import { applyScheduleJitter } from "../../lib/scheduleJitter.ts";

type BotDeps = NonNullable<Parameters<typeof createApp>[0]>;

const MOCK_RUN_ID = "00000000-0000-4000-8000-000000000099";

function mockPublisherSuccess(log: ActivityLog) {
  return {
    success: true,
    message: "ok",
    log,
    runId: MOCK_RUN_ID,
    decision: "published_verified" as const,
    artifactDir: null as string | null
  };
}

function mockPublisherFailure(message: string, log: ActivityLog, decision: "gap_policy" | "publisher_error" = "gap_policy") {
  return {
    success: false,
    message,
    log,
    runId: MOCK_RUN_ID,
    decision,
    artifactDir: null as string | null
  };
}

function createLog(status: "safe" | "unsafe" | "error", error?: string): ActivityLog {
  return {
    timestamp: new Date().toISOString(),
    current_gap_count: status === "safe" ? 8 : 1,
    last_post_timestamp: "2026-03-31 10:00:00",
    top_competitor_names: ["alpha", "beta"],
    view_count_of_last_post: 120,
    status,
    all_posts: [
      { title: "A", author: "alpha", date: "10:00", views: 10, isNotice: false },
      { title: "B", author: "beta", date: "10:05", views: 20, isNotice: false }
    ],
    ...(error ? { error } : {})
  };
}

async function withServer(
  deps: BotDeps,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createApp(deps);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function assertActivityLogShape(log: ActivityLog): void {
  assert.equal(typeof log.timestamp, "string");
  assert.equal(typeof log.current_gap_count, "number");
  assert.equal(typeof log.last_post_timestamp, "string");
  assert.ok(Array.isArray(log.top_competitor_names));
  assert.equal(typeof log.view_count_of_last_post, "number");
  assert.ok(["safe", "unsafe", "error"].includes(log.status));
  assert.ok(Array.isArray(log.all_posts));
  if (log.gap_threshold_min !== undefined) {
    assert.equal(typeof log.gap_threshold_min, "number");
  }
}

test("POST /api/run-observer returns contract-aligned success payload", async () => {
  const observerLog = createLog("safe");
  const deps: BotDeps = {
    runObserver: async () => observerLog,
    runPublisher: async () => mockPublisherSuccess(observerLog),
    getLogs: async () => [observerLog]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/run-observer`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assertActivityLogShape(body.log as ActivityLog);
  });
});

test("POST /api/run-publisher blocks unsafe non-force path", async () => {
  const unsafeLog = createLog("unsafe");
  let capturedForce = false;
  const deps: BotDeps = {
    runObserver: async () => unsafeLog,
    runPublisher: async (force?: boolean) => {
      capturedForce = Boolean(force);
      return {
        ...mockPublisherFailure("[Publisher] Gap is too small to publish (safety / gap policy)", unsafeLog, "gap_policy"),
        runId: "00000000-0000-4000-8000-000000000001"
      };
    },
    getLogs: async () => [unsafeLog]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/run-publisher`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: false })
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(String(body.error), /\[Publisher\].*Gap/);
    assert.equal(capturedForce, false);
    assertActivityLogShape(body.log as ActivityLog);
    assert.equal(body.runId, "00000000-0000-4000-8000-000000000001");
    assert.equal(body.decision, "gap_policy");
  });
});

test("POST /api/run-publisher preserves low-confidence manual-review message", async () => {
  const manualReviewMessage = "MANUAL_REVIEW_REQUIRED: parse confidence 0.72 is below 0.80";
  const unsafeLog = createLog("unsafe", manualReviewMessage);
  const deps: BotDeps = {
    runObserver: async () => unsafeLog,
    runPublisher: async () => mockPublisherFailure(manualReviewMessage, unsafeLog, "gap_policy"),
    getLogs: async () => [unsafeLog]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/run-publisher`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: false })
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /MANUAL_REVIEW_REQUIRED/);
    assert.equal(body.message, manualReviewMessage);
    assertActivityLogShape(body.log as ActivityLog);
  });
});

test("POST /api/run-publisher supports manual override force path", async () => {
  const unsafeLog = createLog("unsafe");
  let capturedForce = false;
  const deps: BotDeps = {
    runObserver: async () => unsafeLog,
    runPublisher: async (force?: boolean) => {
      capturedForce = Boolean(force);
      return {
        success: true,
        message: "Publication simulated successfully (DRY_RUN_MODE=true)",
        log: unsafeLog,
        runId: MOCK_RUN_ID,
        decision: "dry_run" as const,
        artifactDir: null
      };
    },
    getLogs: async () => [unsafeLog]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/run-publisher`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(capturedForce, true);
    assertActivityLogShape(body.log as ActivityLog);
  });
});

test("scheduler uses lock to avoid overlapping runs", async () => {
  const safeLog = createLog("safe");
  let runCount = 0;
  let release: (() => void) | null = null;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });

  const deps: BotDeps = {
    runObserver: async () => safeLog,
    runPublisher: async () => {
      runCount += 1;
      await blocker;
      return mockPublisherSuccess(safeLog);
    },
    getLogs: async () => [safeLog]
  };

  const scheduler = startScheduler(deps, 10);
  const firstRun = scheduler.runNow();
  const secondRun = scheduler.runNow();
  await new Promise((resolve) => setTimeout(resolve, 25));
  release?.();
  await Promise.all([firstRun, secondRun]);
  scheduler.stop();

  assert.equal(runCount, 1);
});

function trendLogsSteadyRate(): ActivityLog[] {
  const base = {
    current_gap_count: 8,
    last_post_timestamp: "2026-03-31 10:00:00",
    top_competitor_names: ["alpha"],
    view_count_of_last_post: 100,
    status: "safe" as const,
    all_posts: [] as ActivityLog["all_posts"]
  };
  const post = (title: string) => ({
    title,
    author: "alpha",
    date: "10:00",
    views: 10,
    isNotice: false
  });
  return [
    {
      ...base,
      timestamp: "2026-04-04T10:00:00.000Z",
      all_posts: [post("p1"), post("p2")]
    },
    {
      ...base,
      timestamp: "2026-04-04T11:00:00.000Z",
      all_posts: [post("p1"), post("p2"), post("p3")]
    },
    {
      ...base,
      timestamp: "2026-04-04T12:00:00.000Z",
      all_posts: [post("p1"), post("p2"), post("p3"), post("p4")]
    },
    {
      ...base,
      timestamp: "2026-04-04T13:00:00.000Z",
      all_posts: [post("p1"), post("p2"), post("p3"), post("p4"), post("p5")]
    }
  ];
}

test("GET /api/trend-insights returns contract-shaped payload", async () => {
  const logs = trendLogsSteadyRate();
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => logs
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/trend-insights`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    assert.equal(body.windowDays, 7);
    assert.equal(typeof body.trendMultiplier, "number");
    assert.equal(body.confidenceReason, "empirical_window");
    assert.ok(Array.isArray(body.hourlyProfile));
    assert.equal((body.hourlyProfile as unknown[]).length, 24);
    const first = (body.hourlyProfile as { hour: number; avgNewPostsPerHour: number }[])[0];
    assert.equal(typeof first.hour, "number");
    assert.equal(typeof first.avgNewPostsPerHour, "number");
    assert.equal(body.trendMultiplier, 1.6);
  });
});

test("GET /api/trend-insights trendAdaptiveEnabled=false forces multiplier 1", async () => {
  const logs = trendLogsSteadyRate();
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => logs
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/trend-insights?trendAdaptiveEnabled=false`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.trendMultiplier, 1);
    assert.equal(body.confidenceReason, "adaptive_disabled");
    assert.equal(body.multiplierBand, "unknown");
  });
});

test("isPublishSuccessUrl accepts final view/list URLs and rejects write_ok interim", async () => {
  const { isPublishSuccessUrl } = await import("../../bot.js");
  const boardId = "gonggu";

  assert.equal(
    isPublishSuccessUrl("https://www.ppomppu.co.kr/zboard/view.php?id=gonggu&no=201742&page=1", boardId),
    true
  );
  assert.equal(isPublishSuccessUrl("https://www.ppomppu.co.kr/zboard/zboard.php?id=gonggu", boardId), true);

  assert.equal(
    isPublishSuccessUrl(
      "https://www.ppomppu.co.kr/zboard/unlimit_write_ok.php?id=gonggu&no=201742",
      boardId
    ),
    false
  );

  assert.equal(
    isPublishSuccessUrl("https://www.ppomppu.co.kr/zboard/view.php?id=other&no=1", boardId),
    false
  );
  assert.equal(
    isPublishSuccessUrl("https://www.ppomppu.co.kr/zboard/write.php?id=gonggu", boardId),
    false
  );
});

test("GET /api/control-panel includes publisher.draftItemIndex", async () => {
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => [createLog("safe")]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/control-panel`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { publisher?: { draftItemIndex?: number } };
    assert.ok(body.publisher);
    assert.equal(typeof body.publisher?.draftItemIndex, "number");
    assert.ok(body.publisher!.draftItemIndex >= 1);
  });
});

test("POST /api/control-panel updates publisher.draftItemIndex", async () => {
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => [createLog("safe")]
  };

  await withServer(deps, async (baseUrl) => {
    const reset = await fetch(`${baseUrl}/api/control-panel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publisher: { draftItemIndex: 1 } })
    });
    assert.equal(reset.status, 200);

    const patch = await fetch(`${baseUrl}/api/control-panel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publisher: { draftItemIndex: 3 } })
    });
    assert.equal(patch.status, 200);
    const patched = (await patch.json()) as { publisher: { draftItemIndex: number } };
    assert.equal(patched.publisher.draftItemIndex, 3);

    const getRes = await fetch(`${baseUrl}/api/control-panel`);
    const body = (await getRes.json()) as { publisher: { draftItemIndex: number } };
    assert.equal(body.publisher.draftItemIndex, 3);

    await fetch(`${baseUrl}/api/control-panel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publisher: { draftItemIndex: 1 } })
    });
  });
});

function analyticsFixtureLogs(): ActivityLog[] {
  const p0: Post = { title: "A", author: "alpha", date: "10:00", views: 5, isNotice: false };
  const t0 = "2026-02-01T10:00:00.000Z";
  const t1 = "2026-02-01T14:00:00.000Z";
  return [
    { ...createLog("safe"), timestamp: t0, all_posts: [p0] },
    {
      ...createLog("safe"),
      timestamp: t1,
      all_posts: [
        p0,
        { title: "B", author: "beta", date: "12:00", views: 1, isNotice: false }
      ]
    }
  ];
}

test("GET /api/analytics/competitors returns EDA payload", async () => {
  const logs = analyticsFixtureLogs();
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => logs
  };

  await withServer(deps, async (baseUrl) => {
    const from = encodeURIComponent("2026-02-01T00:00:00.000Z");
    const to = encodeURIComponent("2026-02-10T23:59:59.999Z");
    const res = await fetch(`${baseUrl}/api/analytics/competitors?from=${from}&to=${to}&bucket=day`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      dataHealth: { snapshotCount: number };
      timeSeries: unknown[];
      seriesAuthors: string[];
      summary: { author: string }[];
      heatmap: { mode: string; cells: unknown[] };
      botSignals: { author: string; heuristicTier: string }[];
      disclaimer: string;
    };
    assert.ok(body.dataHealth);
    assert.equal(body.dataHealth.snapshotCount, 2);
    assert.ok(Array.isArray(body.timeSeries));
    assert.ok(Array.isArray(body.summary));
    const beta = body.summary.find((s) => s.author === "beta");
    assert.ok(beta);
    assert.ok(Array.isArray(body.botSignals));
    assert.ok(body.disclaimer.length > 10);
  });
});

test("GET /api/analytics/competitors rejects invalid range", async () => {
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => []
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/analytics/competitors?from=${encodeURIComponent("2026-06-10T00:00:00.000Z")}&to=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`
    );
    assert.equal(res.status, 400);
  });
});

test("applyScheduleJitter respects bounds for uniform mode", async () => {
  assert.equal(applyScheduleJitter(60, 10, "uniform", () => 0), 54);
  assert.equal(applyScheduleJitter(60, 10, "uniform", () => 1 - Number.EPSILON), 66);
  assert.equal(applyScheduleJitter(60, 20, "none", () => 0.5), 60);
});

test("GET /api/publisher-history returns an array", async () => {
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => [createLog("safe")]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/publisher-history`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
  });
});

test("GET /api/control-panel includes schedule jitter fields", async () => {
  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => [createLog("safe")]
  };

  await withServer(deps, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/control-panel`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      observer: {
        gapThresholdMin: number;
        gapPersistedOverride: number | null;
        gapThresholdSpecBaseline: number;
        gapUsesEnvOverride: boolean;
      };
      autoPublisher: {
        scheduleJitterPercent: number;
        scheduleJitterMode: string;
        targetPublishIntervalMinutes: number;
      };
    };
    assert.equal(typeof body.observer.gapThresholdMin, "number");
    assert.ok(body.observer.gapPersistedOverride === null || typeof body.observer.gapPersistedOverride === "number");
    assert.equal(typeof body.observer.gapThresholdSpecBaseline, "number");
    assert.equal(typeof body.observer.gapUsesEnvOverride, "boolean");
    assert.equal(typeof body.autoPublisher.scheduleJitterPercent, "number");
    assert.ok(body.autoPublisher.scheduleJitterMode === "none" || body.autoPublisher.scheduleJitterMode === "uniform");
    assert.equal(typeof body.autoPublisher.targetPublishIntervalMinutes, "number");
  });
});

test("POST /api/control-panel persists gapPersistedOverride and GET reflects it", async () => {
  const root = process.env.PROJECT_ROOT || "/parent/marketing-automation";
  const rcPath = path.join(root, "artifacts", "runtime-controls.json");
  let hadFile = false;
  let prior = "";
  try {
    prior = await fs.readFile(rcPath, "utf-8");
    hadFile = true;
  } catch {
    hadFile = false;
  }

  const deps: BotDeps = {
    runObserver: async () => createLog("safe"),
    runPublisher: async () => mockPublisherSuccess(createLog("safe")),
    getLogs: async () => [createLog("safe")]
  };

  try {
    await withServer(deps, async (baseUrl) => {
      const get0 = await fetch(`${baseUrl}/api/control-panel`);
      assert.equal(get0.status, 200);
      const before = (await get0.json()) as Record<string, unknown>;

      const post = await fetch(`${baseUrl}/api/control-panel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset: before.preset,
          observer: { ...(before.observer as object), gapPersistedOverride: 9 },
          publisher: before.publisher,
          autoPublisher: before.autoPublisher
        })
      });
      assert.equal(post.status, 200);
      const after = (await post.json()) as {
        observer: { gapPersistedOverride: number | null; gapThresholdMin: number };
      };
      assert.equal(after.observer.gapPersistedOverride, 9);
      assert.equal(after.observer.gapThresholdMin, 9);

      const get1 = await fetch(`${baseUrl}/api/control-panel`);
      const roundTrip = (await get1.json()) as { observer: { gapPersistedOverride: number | null } };
      assert.equal(roundTrip.observer.gapPersistedOverride, 9);

      const clear = await fetch(`${baseUrl}/api/control-panel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset: before.preset,
          observer: { ...(before.observer as object), gapPersistedOverride: null },
          publisher: before.publisher,
          autoPublisher: before.autoPublisher
        })
      });
      assert.equal(clear.status, 200);
    });
  } finally {
    if (hadFile) {
      await fs.writeFile(rcPath, prior, "utf-8");
    } else {
      await fs.rm(rcPath, { force: true }).catch(() => null);
    }
  }
});

test("runtime validation fails when workflow fixture violates schema", async () => {
  const workflowPath = path.join(
    process.env.PROJECT_ROOT || "/parent/marketing-automation",
    ".planning/spec-kit/manifest/workflow.ppomppu-gonggu-v1.json"
  );
  const original = await fs.readFile(workflowPath, "utf-8");

  try {
    const brokenWorkflow = JSON.parse(original) as Record<string, unknown>;
    delete brokenWorkflow.publisher_sequence;
    await fs.writeFile(workflowPath, JSON.stringify(brokenWorkflow, null, 2));
    await assert.rejects(
      () => validateRuntimeContracts(),
      /workflow\.ppomppu-gonggu-v1\.json schema mismatch/
    );
  } finally {
    await fs.writeFile(workflowPath, original);
  }
});
