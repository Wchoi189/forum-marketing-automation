import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityLog } from "../../contracts/models.ts";
import { buildBoardStats, buildCompetitorStats } from "../../lib/analytics/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(ts: string, posts: { title: string; author: string; views?: number }[]): ActivityLog {
  return {
    timestamp: ts,
    current_gap_count: 0,
    last_post_timestamp: ts,
    top_competitor_names: [],
    view_count_of_last_post: 0,
    status: "safe",
    all_posts: posts.map((p) => ({
      title: p.title,
      author: p.author,
      views: p.views ?? 0,
      isNotice: false,
      date: ""
    }))
  };
}

const NOW_MS = Date.parse("2026-08-10T00:00:00.000Z");

/** ISO timestamp N hours before NOW_MS. */
function hoursAgo(n: number): string {
  return new Date(NOW_MS - n * 60 * 60 * 1000).toISOString();
}

const OURS = { ourAuthorSubstring: "shareplan" };

// ---------------------------------------------------------------------------
// buildCompetitorStats
// ---------------------------------------------------------------------------

test("buildCompetitorStats: counts a post once per snapshot, but once per snapshot it appears in", () => {
  const logs = [
    makeLog(hoursAgo(1), [{ title: "a", author: "alice", views: 10 }]),
    makeLog(hoursAgo(2), [{ title: "a", author: "alice", views: 6 }])
  ];
  const rows = buildCompetitorStats(logs, { ...OURS, nowMs: NOW_MS });
  const alice = rows.find((r) => r.author === "alice");
  assert.equal(alice?.frequency, 2);
  assert.equal(alice?.avgViews, 8);
});

test("buildCompetitorStats: duplicate title+author inside one snapshot counts once", () => {
  const logs = [
    makeLog(hoursAgo(1), [
      { title: "a", author: "alice", views: 10 },
      { title: "a", author: "alice", views: 999 }
    ])
  ];
  const rows = buildCompetitorStats(logs, { ...OURS, nowMs: NOW_MS });
  assert.equal(rows.find((r) => r.author === "alice")?.frequency, 1);
});

test("buildCompetitorStats: snapshots older than a week are excluded", () => {
  const logs = [makeLog(hoursAgo(24 * 8), [{ title: "a", author: "alice" }])];
  const rows = buildCompetitorStats(logs, { ...OURS, nowMs: NOW_MS });
  assert.deepEqual(rows, [{ author: "SharePlan", frequency: 0, avgViews: 0 }]);
});

test("buildCompetitorStats: sorted by frequency, descending", () => {
  const logs = [
    makeLog(hoursAgo(1), [{ title: "a", author: "alice" }, { title: "b", author: "bob" }]),
    makeLog(hoursAgo(2), [{ title: "b", author: "bob" }])
  ];
  const rows = buildCompetitorStats(logs, { ...OURS, nowMs: NOW_MS });
  assert.deepEqual(rows.map((r) => r.author), ["bob", "alice", "SharePlan"]);
});

test("buildCompetitorStats: our row replaces the tenth competitor when the top ten omits us", () => {
  const competitors = Array.from({ length: 12 }, (_, i) => ({
    title: `t${i}`,
    author: `author-${String(i).padStart(2, "0")}`
  }));
  // Each author appears in a decreasing number of snapshots, so rank == index.
  const logs = competitors.map((_, i) => makeLog(hoursAgo(i + 1), competitors.slice(0, 12 - i)));
  const rows = buildCompetitorStats(logs, { ...OURS, nowMs: NOW_MS });
  assert.equal(rows.length, 10);
  assert.equal(rows[9].author, "SharePlan");
  assert.equal(rows[8].author, "author-08");
});

test("buildCompetitorStats: our own row is kept in place when we are already in the top ten", () => {
  const logs = [
    makeLog(hoursAgo(1), [{ title: "a", author: "shareplan_kr" }, { title: "b", author: "bob" }]),
    makeLog(hoursAgo(2), [{ title: "a", author: "shareplan_kr" }])
  ];
  const rows = buildCompetitorStats(logs, { ...OURS, nowMs: NOW_MS });
  assert.deepEqual(rows.map((r) => r.author), ["shareplan_kr", "bob"]);
});

test("buildCompetitorStats: ourAuthorSubstring is matched case-insensitively", () => {
  const logs = [makeLog(hoursAgo(1), [{ title: "a", author: "SharePlan_KR" }])];
  const rows = buildCompetitorStats(logs, { ourAuthorSubstring: "SHAREPLAN", nowMs: NOW_MS });
  assert.deepEqual(rows.map((r) => r.author), ["SharePlan_KR"]);
});

test("buildCompetitorStats: a different ourAuthorSubstring identifies a different author", () => {
  const logs = [makeLog(hoursAgo(1), [{ title: "a", author: "acme_store" }])];
  const rows = buildCompetitorStats(logs, { ourAuthorSubstring: "acme", nowMs: NOW_MS });
  assert.deepEqual(rows.map((r) => r.author), ["acme_store"]);
});

// ---------------------------------------------------------------------------
// buildBoardStats
// ---------------------------------------------------------------------------

test("buildBoardStats: fewer than two snapshots → zeroes", () => {
  assert.deepEqual(buildBoardStats([], OURS), { turnoverRate: 0, shareOfVoice: 0 });
  assert.deepEqual(
    buildBoardStats([makeLog(hoursAgo(1), [{ title: "a", author: "alice" }])], OURS),
    { turnoverRate: 0, shareOfVoice: 0 }
  );
});

test("buildBoardStats: turnover is new posts per hour between the two newest snapshots", () => {
  const logs = [
    makeLog(hoursAgo(0), [
      { title: "new1", author: "alice" },
      { title: "new2", author: "bob" },
      { title: "old", author: "carol" }
    ]),
    makeLog(hoursAgo(2), [{ title: "old", author: "carol" }])
  ];
  assert.equal(buildBoardStats(logs, OURS).turnoverRate, "1.0");
});

test("buildBoardStats: identical timestamps → turnover 0, not a division by zero", () => {
  const ts = hoursAgo(1);
  const logs = [
    makeLog(ts, [{ title: "new", author: "alice" }]),
    makeLog(ts, [{ title: "old", author: "carol" }])
  ];
  assert.equal(buildBoardStats(logs, OURS).turnoverRate, 0);
});

test("buildBoardStats: share of voice is our share of the newest snapshot, rounded", () => {
  const logs = [
    makeLog(hoursAgo(0), [
      { title: "a", author: "shareplan_kr" },
      { title: "b", author: "bob" },
      { title: "c", author: "carol" }
    ]),
    makeLog(hoursAgo(1), [])
  ];
  assert.equal(buildBoardStats(logs, OURS).shareOfVoice, 33);
});

test("buildBoardStats: empty newest snapshot → share of voice 0", () => {
  const logs = [makeLog(hoursAgo(0), []), makeLog(hoursAgo(1), [])];
  assert.equal(buildBoardStats(logs, OURS).shareOfVoice, 0);
});

test("buildBoardStats: share of voice follows ourAuthorSubstring, not a hardcoded name", () => {
  const logs = [
    makeLog(hoursAgo(0), [{ title: "a", author: "acme_store" }, { title: "b", author: "bob" }]),
    makeLog(hoursAgo(1), [])
  ];
  assert.equal(buildBoardStats(logs, { ourAuthorSubstring: "acme" }).shareOfVoice, 50);
  assert.equal(buildBoardStats(logs, OURS).shareOfVoice, 0);
});
