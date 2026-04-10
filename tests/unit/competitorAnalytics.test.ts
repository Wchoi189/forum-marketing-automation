import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityLog } from "../../contracts/models.ts";
import type { CompetitorAnalyticsQuery } from "../../lib/competitorAnalytics.ts";
import {
  buildCompetitorAnalyticsPayload,
  parseAnalyticsQuery
} from "../../lib/competitorAnalytics.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PostRecord = {
  title: string;
  author: string;
  views: number;
  isNotice: boolean;
  date?: string;
};

function makeLog(ts: string, posts: PostRecord[]): ActivityLog {
  return {
    timestamp: ts,
    current_gap_count: 5,
    last_post_timestamp: ts,
    top_competitor_names: [],
    view_count_of_last_post: 0,
    status: "safe",
    all_posts: posts.map((p) => ({
      title: p.title,
      author: p.author,
      views: p.views,
      isNotice: p.isNotice,
      date: p.date ?? ""
    }))
  };
}

/**
 * Builds a sequence of consecutive ActivityLog snapshots.
 * Each snapshot's posts accumulate: snapshot[i] contains all posts up to
 * and including that timestamp so consecutive comparisons produce the right
 * new-post events.
 */
function buildLogs(snapshots: Array<{ ts: string; newPosts: PostRecord[] }>): ActivityLog[] {
  const cumulative: PostRecord[] = [];
  return snapshots.map(({ ts, newPosts }) => {
    cumulative.push(...newPosts);
    return makeLog(ts, [...cumulative]);
  });
}

function makeQuery(overrides: Partial<CompetitorAnalyticsQuery> = {}): CompetitorAnalyticsQuery {
  return {
    fromMs: Date.parse("2026-01-01T00:00:00.000Z"),
    toMs: Date.parse("2026-12-31T23:59:59.999Z"),
    bucket: "day",
    excludeNotices: false,
    authorFilter: null,
    focusAuthor: null,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// T-001 — postsPerActiveDay: active-day deduplication via postDateParsedMs
// ---------------------------------------------------------------------------

test("T-001: postsPerActiveDay groups by calendar day from parsed post date", () => {
  // Alice posts 3 times: 2 on 2026-04-01, 1 on 2026-04-02
  // We build snapshot pairs so extractNewPostEvents sees each post as new.
  const logs = buildLogs([
    { ts: "2026-04-01T09:00:00.000Z", newPosts: [] }, // baseline — no posts yet
    {
      ts: "2026-04-01T10:00:00.000Z",
      newPosts: [{ title: "Post-A1", author: "alice", views: 10, isNotice: false, date: "2026-04-01T10:00:00.000Z" }]
    },
    {
      ts: "2026-04-01T14:00:00.000Z",
      newPosts: [{ title: "Post-A2", author: "alice", views: 10, isNotice: false, date: "2026-04-01T14:00:00.000Z" }]
    },
    {
      ts: "2026-04-02T10:00:00.000Z",
      newPosts: [{ title: "Post-A3", author: "alice", views: 10, isNotice: false, date: "2026-04-02T10:00:00.000Z" }]
    }
  ]);

  const payload = buildCompetitorAnalyticsPayload(logs, makeQuery());
  const row = payload.summary.find((r) => r.author === "alice");
  assert.ok(row, "alice should appear in summary");
  assert.equal(row.postsInRange, 3, "postsInRange should be 3");
  assert.equal(row.activeDays, 2, "activeDays should be 2 (two distinct ISO dates)");
  assert.equal(row.postsPerActiveDay, 1.5, "postsPerActiveDay should be 3/2 = 1.5");
});

// ---------------------------------------------------------------------------
// T-002 — avgViewsPerPost: notice posts excluded from denominator regardless
//          of excludeNotices query param
// ---------------------------------------------------------------------------

test("T-002: avgViewsPerPost excludes notice posts from denominator when excludeNotices=false", () => {
  // Bob: 5 notice posts (0 views) + 10 regular posts (50 views each)
  const noticePosts: PostRecord[] = Array.from({ length: 5 }, (_, i) => ({
    title: `Notice-${i}`,
    author: "bob",
    views: 0,
    isNotice: true,
    date: `2026-04-01T0${i}:00:00.000Z`
  }));
  const regularPosts: PostRecord[] = Array.from({ length: 10 }, (_, i) => ({
    title: `Regular-${i}`,
    author: "bob",
    views: 50,
    isNotice: false,
    date: `2026-04-02T${String(i).padStart(2, "0")}:00:00.000Z`
  }));

  // Build logs: one baseline empty snapshot, then add all posts in one shot
  const logs = [
    makeLog("2026-04-01T00:00:00.000Z", []),
    makeLog("2026-04-03T00:00:00.000Z", [...noticePosts, ...regularPosts])
  ];

  // excludeNotices=false → notices included in postsInRange but not in avgViews denominator
  const payload = buildCompetitorAnalyticsPayload(logs, makeQuery({ excludeNotices: false }));
  const row = payload.summary.find((r) => r.author === "bob");
  assert.ok(row, "bob should appear in summary");
  assert.equal(row.postsInRange, 15, "postsInRange = 15 (notice + regular)");
  assert.equal(row.avgViewsPostCount, 10, "avgViewsPostCount = 10 (non-notice only)");
  assert.equal(row.avgViewsPerPost, 50, "avgViewsPerPost = 500 views / 10 posts = 50");
});

// ---------------------------------------------------------------------------
// T-003 — avgViewsPerPost baseline: author with only regular posts
// ---------------------------------------------------------------------------

test("T-003: avgViewsPostCount equals postsInRange when author has no notice posts", () => {
  const posts: PostRecord[] = Array.from({ length: 4 }, (_, i) => ({
    title: `Post-${i}`,
    author: "carol",
    views: 100,
    isNotice: false,
    date: `2026-04-0${i + 1}T10:00:00.000Z`
  }));

  const logs = [
    makeLog("2026-04-01T00:00:00.000Z", []),
    makeLog("2026-04-05T00:00:00.000Z", posts)
  ];

  const payload = buildCompetitorAnalyticsPayload(logs, makeQuery());
  const row = payload.summary.find((r) => r.author === "carol");
  assert.ok(row, "carol should appear in summary");
  assert.equal(row.postsInRange, 4);
  assert.equal(row.avgViewsPostCount, 4, "avgViewsPostCount === postsInRange when no notices");
  assert.equal(row.avgViewsPerPost, 100);
});

// ---------------------------------------------------------------------------
// T-004 — focusAuthor heatmap cell tagging
// ---------------------------------------------------------------------------

test("T-004a: heatmap cells only contain focusAuthor when focusAuthor is set", () => {
  const logs = [
    makeLog("2026-04-01T00:00:00.000Z", []),
    makeLog("2026-04-02T10:00:00.000Z", [
      { title: "A-post", author: "alice", views: 5, isNotice: false, date: "2026-04-02T10:00:00.000Z" },
      { title: "B-post", author: "bob", views: 5, isNotice: false, date: "2026-04-02T12:00:00.000Z" }
    ])
  ];

  const payload = buildCompetitorAnalyticsPayload(logs, makeQuery({ focusAuthor: "alice" }));
  assert.ok(payload.heatmap.cells.length > 0, "should have at least one cell");
  for (const cell of payload.heatmap.cells) {
    assert.equal(
      cell.author?.trim().toLowerCase(),
      "alice",
      `cell.author should be "alice" but got "${cell.author}"`
    );
  }
});

test("T-004b: heatmap cells contain both authors when focusAuthor is null", () => {
  const logs = [
    makeLog("2026-04-01T00:00:00.000Z", []),
    makeLog("2026-04-02T10:00:00.000Z", [
      { title: "A-post", author: "alice", views: 5, isNotice: false, date: "2026-04-02T10:00:00.000Z" },
      { title: "B-post", author: "bob", views: 5, isNotice: false, date: "2026-04-02T12:00:00.000Z" }
    ])
  ];

  const payload = buildCompetitorAnalyticsPayload(logs, makeQuery({ focusAuthor: null }));
  const authors = new Set(payload.heatmap.cells.map((c) => c.author));
  assert.ok(authors.has("alice"), "alice should appear in heatmap cells");
  assert.ok(authors.has("bob"), "bob should appear in heatmap cells");
});

// ---------------------------------------------------------------------------
// T-005 — parseAnalyticsQuery: validation error cases
// ---------------------------------------------------------------------------

test("T-005a: parseAnalyticsQuery returns error when from is not a valid date", () => {
  const result = parseAnalyticsQuery({ query: { from: "not-a-date", to: "2026-04-10" } });
  assert.ok("error" in result, "should return an error object");
});

test("T-005b: parseAnalyticsQuery returns error when from is later than to", () => {
  const result = parseAnalyticsQuery({ query: { from: "2026-04-10", to: "2026-04-01" } });
  assert.ok("error" in result, "should return an error when from > to");
});

test("T-005c: parseAnalyticsQuery returns valid query for well-formed params", () => {
  const result = parseAnalyticsQuery({
    query: { from: "2026-04-01", to: "2026-04-10", bucket: "week", excludeNotices: "true" }
  });
  assert.ok(!("error" in result), "should not return an error");
  if ("error" in result) return; // narrow type
  assert.equal(typeof result.fromMs, "number");
  assert.equal(typeof result.toMs, "number");
  assert.ok(result.fromMs < result.toMs);
  assert.equal(result.bucket, "week");
  assert.equal(result.excludeNotices, true);
});

// ---------------------------------------------------------------------------
// T-006 — parseAnalyticsQuery: default 3-day window
// ---------------------------------------------------------------------------

test("T-006: parseAnalyticsQuery defaults to 3-day window, bucket=day, excludeNotices=false", () => {
  const before = Date.now();
  const result = parseAnalyticsQuery({ query: {} });
  const after = Date.now();

  assert.ok(!("error" in result), "no params should not return an error");
  if ("error" in result) return;

  const expected3dAgo = before - 3 * 24 * 60 * 60 * 1000;
  assert.ok(
    Math.abs(result.fromMs - expected3dAgo) < 2000,
    `fromMs should be within 2s of now-3days (got delta ${Math.abs(result.fromMs - expected3dAgo)}ms)`
  );
  assert.ok(result.toMs >= before && result.toMs <= after + 100, "toMs should be approximately now");
  assert.equal(result.bucket, "day");
  assert.equal(result.excludeNotices, false);
  assert.equal(result.authorFilter, null);
  assert.equal(result.focusAuthor, null);
});
