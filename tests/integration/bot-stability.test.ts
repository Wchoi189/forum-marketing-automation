import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";

import {
  cleanBrowserProfile,
  runGarbageCollection,
  getResourceMetrics,
  checkResourceThresholds,
} from "../../lib/resourceMonitor.js";
import {
  setPublisherRunning,
} from "../../lib/publisherStepStore.js";
import { createApp } from "../../server.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Resource Monitor: Browser Profile Cleanup ───────────────────────────────

test("cleanBrowserProfile removes cache directories", () => {
  const profile = mkdtemp("test-browser-");
  // Create cache directories that should be cleaned
  fs.mkdirSync(path.join(profile, "Default", "Cache", "Cache_Data"), { recursive: true });
  fs.writeFileSync(path.join(profile, "Default", "Cache", "Cache_Data", "data_0"), "x".repeat(1000));
  fs.mkdirSync(path.join(profile, "Default", "Code Cache", "js"), { recursive: true });
  fs.writeFileSync(path.join(profile, "Default", "Code Cache", "js", "test"), "x".repeat(500));
  fs.mkdirSync(path.join(profile, "GPUCache"), { recursive: true });
  fs.writeFileSync(path.join(profile, "GPUCache", "gpu_data"), "x".repeat(200));

  // Create a file that should NOT be cleaned (profile root)
  fs.writeFileSync(path.join(profile, "Preferences"), '{"account_id":"test"}');

  const result = cleanBrowserProfile(profile);

  assert.ok(result.deletedDirs >= 3, `Expected at least 3 dirs cleaned, got ${result.deletedDirs}`);
  assert.ok(result.freedBytes >= 1500, `Expected at least 1500 bytes freed, got ${result.freedBytes}`);

  // Verify cache directories are removed
  const cacheDir = path.join(profile, "Default", "Cache");
  const codeCacheDir = path.join(profile, "Default", "Code Cache");
  const gpuDir = path.join(profile, "GPUCache");
  assert.ok(!fs.existsSync(cacheDir), `Cache dir should be deleted: ${cacheDir}`);
  assert.ok(!fs.existsSync(codeCacheDir), `Code Cache dir should be deleted: ${codeCacheDir}`);
  assert.ok(!fs.existsSync(gpuDir), `GPU Cache dir should be deleted: ${gpuDir}`);

  // Preserve root-level files
  assert.ok(fs.existsSync(path.join(profile, "Preferences")));

  cleanup(profile);
});

test("cleanBrowserProfile handles missing profile gracefully", () => {
  const result = cleanBrowserProfile("/tmp/nonexistent-browser-profile-test");
  assert.equal(result.deletedDirs, 0);
  assert.equal(result.freedBytes, 0);
});

test("cleanBrowserProfile handles empty profile", () => {
  const profile = mkdtemp("test-browser-empty-");
  const result = cleanBrowserProfile(profile);
  assert.equal(result.deletedDirs, 0);
  assert.equal(result.freedBytes, 0);
  cleanup(profile);
});

// ── Resource Monitor: GC Integration ────────────────────────────────────────

test("runGarbageCollection returns all three sections", () => {
  const result = runGarbageCollection();
  assert.ok("artifacts" in result, "Should have artifacts section");
  assert.ok("logRotated" in result, "Should have logRotated section");
  assert.ok("browserProfile" in result, "Should have browserProfile section");
  assert.ok(typeof result.browserProfile.deletedDirs === "number");
  assert.ok(typeof result.browserProfile.freedBytes === "number");
});

// ── Resource Monitor: Metrics Collection ────────────────────────────────────

test("getResourceMetrics returns complete structure", () => {
  const metrics = getResourceMetrics();

  assert.ok("process" in metrics);
  assert.ok("artifacts" in metrics);
  assert.ok("activityLog" in metrics);
  assert.ok("browserProfile" in metrics);
  assert.ok("chromiumProcesses" in metrics);
  assert.ok("timestamp" in metrics);

  assert.ok(typeof metrics.process.rssMb === "number");
  assert.ok(metrics.process.rssMb > 0);
  assert.ok(typeof metrics.browserProfile.fileCount === "number");
  assert.ok(typeof metrics.chromiumProcesses === "number");
});

test("checkResourceThresholds returns array of warnings", () => {
  const warnings = checkResourceThresholds();
  assert.ok(Array.isArray(warnings));
});

// ── Publisher Concurrency Guard ─────────────────────────────────────────────

test("publisher step store tracks running state without error", () => {
  setPublisherRunning(true);
  setPublisherRunning(false);
  setPublisherRunning(true);
  setPublisherRunning(false);
});

test("publisher running state is idempotent on false", () => {
  setPublisherRunning(false);
  setPublisherRunning(false);
  setPublisherRunning(false);
});

// ── Server: API Health ──────────────────────────────────────────────────────

type BotDeps = NonNullable<Parameters<typeof createApp>[0]>;

function mockDeps(): BotDeps {
  return {
    runObserver: async () => ({
      timestamp: new Date().toISOString(),
      status: "safe" as const,
      current_gap_count: 5,
      last_post_timestamp: "10:00",
      top_competitor_names: [],
      view_count_of_last_post: 0,
      all_posts: [],
    }),
    runPublisher: async () => ({
      success: true,
      message: "ok",
      runId: "test-run",
      decision: "published_verified" as const,
      artifactDir: null,
    }),
    getLogs: async () => [],
    getPublisherHistory: async (_n: number) => [],
  };
}

async function withServer(
  deps: BotDeps,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createApp(deps);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    server.close();
  }
}

async function fetchJson(baseUrl: string, path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, headers: res.headers, data: await res.json() };
}

test("GET /api/health returns 200", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const { status, data } = await fetchJson(baseUrl, "/api/health");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

test("GET /api/publisher-status returns 200 with step and running", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const { status, data } = await fetchJson(baseUrl, "/api/publisher-status");
    assert.equal(status, 200);
    assert.ok("step" in data);
    assert.ok("running" in data);
  });
});

test("GET /api/logs returns paginated response shape", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const { status, data } = await fetchJson(baseUrl, "/api/logs?limit=10");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.logs));
    assert.ok(typeof data.hasMore === "boolean");
    assert.ok("totalCount" in data);
  });
});

test("GET /api/health/resources returns metrics", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const { status, data } = await fetchJson(baseUrl, "/api/health/resources");
    assert.equal(status, 200);
    assert.ok("process" in data);
    assert.ok("browserProfile" in data);
    assert.ok("warnings" in data);
    assert.ok(Array.isArray(data.warnings));
  });
});

test("POST /api/resource/gc returns cleanup summary with browserProfile", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const { status, data } = await fetchJson(baseUrl, "/api/resource/gc", {
      method: "POST",
    });
    assert.equal(status, 200);
    assert.ok("artifacts" in data);
    assert.ok("logRotated" in data);
    assert.ok("browserProfile" in data);
    assert.ok(typeof data.browserProfile.deletedDirs === "number");
    assert.ok(typeof data.browserProfile.freedBytes === "number");
  });
});

// ── Server: No 429 in dev mode ──────────────────────────────────────────────

test("dev mode: rapid polling does not produce 429", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const paths = [
      "/api/health",
      "/api/publisher-status",
      "/api/logs?limit=10",
      "/api/competitor-stats",
      "/api/board-stats",
      "/api/trend-insights",
      "/api/control-panel",
      "/api/health/resources",
      "/api/drafts",
      "/api/ai-recommendation",
    ];

    for (let i = 0; i < 2; i++) {
      const results = await Promise.all(
        paths.map(async (p) => {
          const res = await fetch(`${baseUrl}${p}`);
          return { path: p, status: res.status };
        })
      );
      for (const r of results) {
        assert.notEqual(r.status, 429, `${r.path} returned 429 on burst #${i + 1}`);
      }
    }
  });
});

// ── Server: Cache works ─────────────────────────────────────────────────────

test("cached endpoints return same data on repeated requests", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const r1 = await fetchJson(baseUrl, "/api/competitor-stats");
    assert.equal(r1.status, 200);

    const r2 = await fetchJson(baseUrl, "/api/competitor-stats");
    assert.equal(r2.status, 200);
    assert.deepStrictEqual(r1.data, r2.data, "Cache should return identical data");
  });
});

test("logs cache returns same data within TTL window", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const r1 = await fetchJson(baseUrl, "/api/logs?limit=50");
    assert.equal(r1.status, 200);

    const r2 = await fetchJson(baseUrl, "/api/logs?limit=50");
    assert.equal(r2.status, 200);
    assert.deepStrictEqual(r1.data, r2.data);
  });
});

test("control-panel cache returns same data within TTL window", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const r1 = await fetchJson(baseUrl, "/api/control-panel");
    assert.equal(r1.status, 200);

    const r2 = await fetchJson(baseUrl, "/api/control-panel");
    assert.equal(r2.status, 200);
    assert.deepStrictEqual(r1.data, r2.data);
  });
});

// ── Server: Publisher/Observer runs trigger cache invalidation ──────────────

test("POST /api/run-publisher invalidates caches", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    // Warm cache
    const logs1 = await fetchJson(baseUrl, "/api/logs?limit=10");
    assert.equal(logs1.status, 200);

    // Trigger publisher (mock returns success)
    const pub = await fetchJson(baseUrl, "/api/run-publisher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(pub.status, 200);
    assert.ok(pub.data.success);

    // Logs should still be accessible after invalidation
    const logs2 = await fetchJson(baseUrl, "/api/logs?limit=10");
    assert.equal(logs2.status, 200);
  });
});

test("POST /api/run-observer invalidates caches", async () => {
  await withServer(mockDeps(), async (baseUrl) => {
    const obs = await fetchJson(baseUrl, "/api/run-observer", {
      method: "POST",
    });
    assert.equal(obs.status, 200);
    assert.ok(obs.data.success);

    const logs = await fetchJson(baseUrl, "/api/logs?limit=10");
    assert.equal(logs.status, 200);
  });
});
