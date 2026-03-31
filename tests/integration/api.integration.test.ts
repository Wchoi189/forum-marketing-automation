import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp, startScheduler } from "../../server.ts";
import type { ActivityLog } from "../../contracts/models.ts";

type BotDeps = NonNullable<Parameters<typeof createApp>[0]>;

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
}

test("POST /api/run-observer returns contract-aligned success payload", async () => {
  const observerLog = createLog("safe");
  const deps: BotDeps = {
    runObserver: async () => observerLog,
    runPublisher: async () => ({ success: true, message: "ok", log: observerLog }),
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
      return { success: false, message: "Gap is too small", log: unsafeLog };
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
    assert.equal(body.error, "Gap is too small");
    assert.equal(capturedForce, false);
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
      return { success: true, message: "Publication simulated successfully (DRY_RUN_MODE=true)", log: unsafeLog };
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
      return { success: true, message: "ok", log: safeLog };
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
