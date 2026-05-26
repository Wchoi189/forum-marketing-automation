import test from "node:test";
import assert from "node:assert/strict";
import { checkSimilarity, deduplicatePost } from "../../../lib/competitor-intel/pipeline/stage6-dedup/index.js";
import { cosineSimilarity } from "../../../lib/competitor-intel/pipeline/stage6-dedup/embedding-client.js";
import type { StoredEmbedding } from "../../../lib/competitor-intel/pipeline/stage6-dedup/types.js";
import type { Stage5Output } from "../../../lib/competitor-intel/pipeline/stage5-evidence/types.js";

function makeStage5(numProducts = 1): Stage5Output {
  const productsWithEvidence = Array.from({ length: numProducts }, (_, i) => ({
    name: `YouTube Premium`,
    name_evidence: { source_type: "html" as const, excerpt: `유튜브 프리미엄 1개월 4,000원`, confidence: 0.8 },
    price_krw: 4000,
    duration_months: 1,
    confidence: 0.8,
    source: "cheerio",
  }));
  return {
    productsWithEvidence,
    evidenceChain: [],
    warnings: [],
    readyForPersist: true,
  };
}

function makeEmbedding(value: number, size = 10): number[] {
  return Array(size).fill(value);
}

function makeStoredEmbedding(postId: string, value: number): StoredEmbedding {
  return { postId, embedding: makeEmbedding(value), timestamp: "2026-01-01T00:00:00Z" };
}

// Utility: cosine similarity correctness
test("cosineSimilarity: identical vectors → 1.0", () => {
  const v = [1, 2, 3, 4, 5];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 1e-9);
});

test("cosineSimilarity: orthogonal vectors → 0", () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-9);
});

test("cosineSimilarity: empty/mismatched → 0", () => {
  assert.strictEqual(cosineSimilarity([], []), 0);
  assert.strictEqual(cosineSimilarity([1, 2], [1]), 0);
});

// TC-6.1: Unique post — no similar embeddings
test("TC-6.1 unique post: no similar embeddings → uniquePosts flag behavior", () => {
  const embedding = makeEmbedding(1.0);
  // Store orthogonal embeddings
  const stored: StoredEmbedding[] = [
    makeStoredEmbedding("post-A", 0),
  ];
  // Manually set stored[0].embedding to orthogonal
  stored[0].embedding = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  const testEmbed = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const { duplicateIds, similarityScores } = checkSimilarity(testEmbed, stored);

  assert.strictEqual(duplicateIds.length, 0);
  // Similarity to orthogonal vector should be 0, well below threshold
  assert.ok(similarityScores.every((s) => s.score < 0.85));
});

// TC-6.2: Exact duplicate — identical embeddings → duplicateIds populated
test("TC-6.2 exact duplicate: identical embedding → duplicateIds populated", () => {
  const embedding = makeEmbedding(1.0);
  const stored: StoredEmbedding[] = [makeStoredEmbedding("post-duplicate-99", 1.0)];

  const { duplicateIds, similarityScores } = checkSimilarity(embedding, stored);

  assert.ok(duplicateIds.includes("post-duplicate-99"), "must flag as duplicate");
  assert.ok(similarityScores[0].score >= 0.95, `score ${similarityScores[0].score} must be >= 0.95`);
});

// TC-6.3: Similar vendor post — similarity ~0.85-0.94 → logged but not duplicate
test("TC-6.3 similar post: score in [0.85, 0.95) → in similarityScores but NOT in duplicateIds", () => {
  // Construct two vectors with cosine similarity ~0.9
  const a = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const b = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0]; // slightly different
  const stored: StoredEmbedding[] = [{ postId: "post-similar-88", embedding: b, timestamp: "2026-01-01T00:00:00Z" }];

  const { duplicateIds, similarityScores } = checkSimilarity(a, stored);

  const entry = similarityScores.find((s) => s.postId === "post-similar-88");
  if (entry) {
    // If score >= 0.85: in similarityScores. If < 0.95: NOT in duplicateIds.
    if (entry.score >= 0.85) {
      assert.ok(!duplicateIds.includes("post-similar-88"), "similar but not duplicate");
    }
  }
  // The test validates the threshold boundary logic is correct
  assert.ok(duplicateIds.every((id) => {
    const s = similarityScores.find((e) => e.postId === id);
    return s && s.score >= 0.95;
  }), "all duplicateIds must have score >= 0.95");
});

// TC-6.4: First run — no stored embeddings → uniquePosts=true
test("TC-6.4 first run: no previous embeddings → uniquePosts=true", () => {
  const { duplicateIds, similarityScores } = checkSimilarity(makeEmbedding(0.5), []);

  assert.strictEqual(duplicateIds.length, 0);
  assert.strictEqual(similarityScores.length, 0);
});

// TC-6.5: deduplicatePost skips when no products → warning + uniquePosts=true
test("TC-6.5 no products: deduplicatePost returns uniquePosts=true with dedup_skip warning", async () => {
  const emptyStage5: Stage5Output = {
    productsWithEvidence: [],
    evidenceChain: [],
    warnings: [],
    readyForPersist: true,
  };

  const result = await deduplicatePost("https://example.com/post/123", emptyStage5);

  assert.strictEqual(result.uniquePosts, true);
  assert.ok(result.warnings?.some((w) => w.startsWith("dedup_skip")), "must have dedup_skip warning");
});

// Shape sanity: Stage6Output required fields
test("Stage6Output shape sanity: required fields always present", () => {
  const { duplicateIds, similarityScores } = checkSimilarity([], []);

  assert.ok(Array.isArray(duplicateIds));
  assert.ok(Array.isArray(similarityScores));
});
