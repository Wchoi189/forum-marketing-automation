import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityLog } from "../../contracts/models.ts";
import {
  shareOfVoiceMultiplierFromSoV,
  computeShareOfVoice
} from "../../lib/trendInsights.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(ts: string, posts: { title: string; author: string }[]): ActivityLog {
  return {
    timestamp: ts,
    current_gap_count: 0,
    last_post_timestamp: ts,
    top_competitor_names: [],
    view_count_of_last_post: 0,
    status: "safe",
    all_posts: posts.map((p) => ({ title: p.title, author: p.author, views: 0, isNotice: false, date: "" }))
  };
}

/** Returns an ISO timestamp N days ago from now. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// shareOfVoiceMultiplierFromSoV — 7 boundary cases
// ---------------------------------------------------------------------------

test("shareOfVoiceMultiplierFromSoV: zero SoV → 0.75 (publish more)", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(0), 0.75);
});

test("shareOfVoiceMultiplierFromSoV: boundary 5% → 0.75", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(5), 0.75);
});

test("shareOfVoiceMultiplierFromSoV: just above lower threshold (6%) → 1.00", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(6), 1.00);
});

test("shareOfVoiceMultiplierFromSoV: mid range (15%) → 1.00", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(15), 1.00);
});

test("shareOfVoiceMultiplierFromSoV: just below upper threshold (19%) → 1.00", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(19), 1.00);
});

test("shareOfVoiceMultiplierFromSoV: boundary 20% → 1.20", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(20), 1.20);
});

test("shareOfVoiceMultiplierFromSoV: high SoV (50%) → 1.20 (slow down)", () => {
  assert.equal(shareOfVoiceMultiplierFromSoV(50), 1.20);
});

// ---------------------------------------------------------------------------
// computeShareOfVoice — 5 scenario cases
// ---------------------------------------------------------------------------

test("computeShareOfVoice: empty log → 0 (neutral)", () => {
  assert.equal(computeShareOfVoice([], 7, "shareplan"), 0);
});

test("computeShareOfVoice: half posts ours → 50", () => {
  const logs = [
    makeLog(daysAgo(1), [
      { title: "a", author: "shareplan_user" },
      { title: "b", author: "other_user" }
    ])
  ];
  assert.equal(computeShareOfVoice(logs, 7, "shareplan"), 50);
});

test("computeShareOfVoice: none ours → 0 (floor multiplier)", () => {
  const logs = [
    makeLog(daysAgo(1), [
      { title: "a", author: "other_user" },
      { title: "b", author: "another_user" }
    ])
  ];
  assert.equal(computeShareOfVoice(logs, 7, "shareplan"), 0);
});

test("computeShareOfVoice: all posts ours → 100 (ceiling multiplier)", () => {
  const logs = [
    makeLog(daysAgo(1), [
      { title: "a", author: "shareplan_user" },
      { title: "b", author: "Shareplan_Admin" }
    ])
  ];
  assert.equal(computeShareOfVoice(logs, 7, "shareplan"), 100);
});

test("computeShareOfVoice: logs outside window excluded → 0", () => {
  const logs = [
    makeLog(daysAgo(10), [
      { title: "a", author: "shareplan_user" },
      { title: "b", author: "other_user" }
    ])
  ];
  // window is 7 days, log is 10 days old → excluded
  assert.equal(computeShareOfVoice(logs, 7, "shareplan"), 0);
});
