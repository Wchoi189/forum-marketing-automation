/**
 * Integration tests for POST /api/nl-command (Sprint 3 — NL Webhook).
 *
 * Strategy:
 *  - All cases use dry_run: true (no mutations; no real bot/browser runs).
 *  - Grok 4 classification is stubbed by replacing globalThis.fetch before each
 *    request. The server runs in-process so the stub is visible to classifyIntent.
 *  - Tests requiring auth send Authorization: Bearer test-secret (NL_WEBHOOK_SECRET
 *    is set to "test-secret" in the test:integration env vars).
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BotDeps = NonNullable<Parameters<typeof createApp>[0]>;

const AUTH_HEADER = "Bearer test-secret";

function makeMockDeps(): BotDeps {
  return {
    runObserver: async () => ({
      timestamp: new Date().toISOString(),
      current_gap_count: 5,
      last_post_timestamp: new Date().toISOString(),
      top_competitor_names: [],
      view_count_of_last_post: 0,
      status: "safe" as const,
      all_posts: [],
    }),
    runPublisher: async () => ({
      success: true,
      message: "ok",
      log: {
        timestamp: new Date().toISOString(),
        current_gap_count: 5,
        last_post_timestamp: new Date().toISOString(),
        top_competitor_names: [],
        view_count_of_last_post: 0,
        status: "safe" as const,
        all_posts: [],
      },
      runId: "test-run-id",
      decision: "published_verified" as const,
      artifactDir: null,
    }),
    getLogs: async () => [],
  };
}

function makeGrokClassificationResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClassification(
  intent: string,
  extractedParams: Record<string, unknown> = {},
  confidence = "high",
  reason = "test classification"
) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            intent,
            extracted_params: extractedParams,
            confidence,
            reason,
          }),
        },
      },
    ],
  };
}

/**
 * Temporarily replaces globalThis.fetch so that calls to api.x.ai return the
 * given classification response; all other URLs (e.g., the test server) use
 * the real fetch with their full init options intact.
 */
async function withGrokMock<T>(
  intent: string,
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("x.ai")) {
      return makeGrokClassificationResponse(makeClassification(intent, params));
    }
    return realFetch(url, init);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
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
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function postNlCommand(
  baseUrl: string,
  body: object,
  auth = AUTH_HEADER
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = auth;
  return fetch(`${baseUrl}/api/nl-command`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("POST /api/nl-command — pause_scheduler intent (dry_run)", async () => {
  await withGrokMock("pause_scheduler", {}, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "pause publishing",
        dry_run: true,
      });
      assert.equal(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["intent"], "pause_scheduler");
      assert.equal(json["dry_run"], true);
      assert.ok(
        String(json["dispatched_to"]).includes("control-panel"),
        `Expected dispatched_to to reference control-panel, got: ${json["dispatched_to"]}`
      );
    });
  });
});

test("POST /api/nl-command — resume_scheduler intent (dry_run)", async () => {
  await withGrokMock("resume_scheduler", {}, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "resume publishing",
        dry_run: true,
      });
      assert.equal(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["intent"], "resume_scheduler");
      assert.equal(json["dry_run"], true);
    });
  });
});

test("POST /api/nl-command — set_interval extracts intervalMinutes (dry_run)", async () => {
  await withGrokMock("set_interval", { intervalMinutes: 45 }, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "set interval to 45 minutes",
        dry_run: true,
      });
      assert.equal(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["intent"], "set_interval");
      assert.equal(json["dry_run"], true);
    });
  });
});

test("POST /api/nl-command — set_gap_threshold extracts observerGapThresholdMin (dry_run)", async () => {
  await withGrokMock("set_gap_threshold", { observerGapThresholdMin: 3 }, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "lower the gap to 3",
        dry_run: true,
      });
      assert.equal(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["intent"], "set_gap_threshold");
      assert.equal(json["dry_run"], true);
    });
  });
});

test("POST /api/nl-command — apply_ai_recommendation intent (dry_run)", async () => {
  await withGrokMock("apply_ai_recommendation", {}, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "apply the AI recommendation",
        dry_run: true,
      });
      assert.equal(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["intent"], "apply_ai_recommendation");
      assert.equal(json["dry_run"], true);
    });
  });
});

test("POST /api/nl-command — status_query intent (dry_run)", async () => {
  await withGrokMock("status_query", {}, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "what's happening",
        dry_run: true,
      });
      assert.equal(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["intent"], "status_query");
      assert.equal(json["dry_run"], true);
    });
  });
});

test("POST /api/nl-command — unknown intent → 422", async () => {
  await withGrokMock("unknown", {}, async () => {
    await withServer(makeMockDeps(), async (baseUrl) => {
      const res = await postNlCommand(baseUrl, {
        message: "do something weird xyz",
        dry_run: true,
      });
      assert.equal(res.status, 422);
      const json = await res.json() as Record<string, unknown>;
      assert.equal(json["error"], "unknown_intent");
    });
  });
});

test("POST /api/nl-command — missing message field → 400", async () => {
  await withServer(makeMockDeps(), async (baseUrl) => {
    const res = await postNlCommand(baseUrl, { source: "test" });
    assert.equal(res.status, 400);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(json["error"], "message_required");
  });
});

test("POST /api/nl-command — wrong bearer token → 401", async () => {
  await withServer(makeMockDeps(), async (baseUrl) => {
    const res = await postNlCommand(
      baseUrl,
      { message: "pause publishing", dry_run: true },
      "Bearer wrong-token"
    );
    assert.equal(res.status, 401);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(json["error"], "unauthorized");
  });
});
