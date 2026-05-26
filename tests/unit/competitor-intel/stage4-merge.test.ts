import test from "node:test";
import assert from "node:assert/strict";
import { mergeProducts } from "../../../lib/competitor-intel/pipeline/stage4-merge/index.js";
import type { Stage1Output } from "../../../lib/competitor-intel/pipeline/stage1-classify/types.js";
import type { Stage2Output } from "../../../lib/competitor-intel/pipeline/stage2-filter/types.js";
import type { Stage3Output } from "../../../lib/competitor-intel/pipeline/stage3-llm/types.js";
import type { CleanBlock } from "../../../lib/competitor-intel/pipeline/stage2-filter/types.js";

function makeStage1(postType: Stage1Output["postType"] = "direct_offer"): Stage1Output {
  return { postType, classifierConfidence: 0.9, classifierEvidence: { excerpt: "t", reasoning: "t" }, skipExtraction: false };
}

function makeStage2(cleanBlocks: CleanBlock[] = [], overrides: Partial<Stage2Output> = {}): Stage2Output {
  return {
    cleanBlocks,
    filterReasons: [],
    signalScore: 0.8,
    llmRequired: false,
    contentForLlm: "",
    ...overrides,
  };
}

function makeStage3(llmProducts: Stage3Output["llmProducts"] = [], skipped = false): Stage3Output {
  return { llmProducts, skipped, promptContext: "", llmConfidence: 0.8 };
}

function makeCleanBlock(text: string): CleanBlock {
  return {
    text,
    lineIndex: 0,
    hasPrice: true,
    hasDuration: true,
    hasProductKeyword: true,
  };
}

// TC-4.1: Cheerio wins — stage2 has 3 products, stage3 LLM skipped
test("TC-4.1 cheerio wins: finalProducts from stage2 cleanBlocks, source=cheerio", () => {
  const cleanBlocks: CleanBlock[] = [
    makeCleanBlock("유튜브 프리미엄 1개월 4,000원"),
    makeCleanBlock("유튜브 프리미엄 3개월 11,000원"),
    makeCleanBlock("넷플릭스 1개월 6,500원"),
  ];
  const stage2 = makeStage2(cleanBlocks);
  const stage3 = makeStage3([], true); // skipped

  const result = mergeProducts(makeStage1(), stage2, stage3);

  assert.ok(result.finalProducts.length > 0, "must have finalProducts");
  assert.ok(result.finalProducts.every((p) => p.source === "cheerio"), "all products from cheerio");
  assert.ok(result.confidenceBreakdown.overall > 0, "overall confidence > 0");
  assert.ok(result.mergeLog?.some((l) => l.includes("cheerio_source")), "mergeLog has cheerio_source");
});

// TC-4.2: LLM wins — stage2 cleanBlocks sparse, stage3 has 3 catalog-matching products
test("TC-4.2 llm wins: finalProducts from stage3, source=llm", () => {
  const stage2 = makeStage2([]); // no clean blocks
  const stage3 = makeStage3([
    { name: "YouTube Premium", price: 4000, duration: 1, confidence: 0.9, evidence: "유튜브 프리미엄 1달" },
    { name: "Netflix", price: 6500, duration: 1, confidence: 0.9, evidence: "넷플릭스 1달" },
    { name: "Disney+", price: 5000, duration: 1, confidence: 0.9, evidence: "디즈니 플러스 1달" },
  ]);

  const result = mergeProducts(makeStage1(), stage2, stage3);

  assert.ok(result.finalProducts.length >= 2, `must have >= 2 LLM products, got ${result.finalProducts.length}`);
  assert.ok(result.finalProducts.every((p) => p.source === "llm"), "all products from llm");
});

// TC-4.3: Mixed sources — both cheerio and LLM have same product → confidence=0.9, source=mixed
test("TC-4.3 mixed sources: same product from both → source=mixed, confidence=0.9", () => {
  const cleanBlocks: CleanBlock[] = [makeCleanBlock("유튜브 프리미엄 1개월 4,000원")];
  const stage2 = makeStage2(cleanBlocks);
  const stage3 = makeStage3([
    { name: "YouTube Premium", price: 4000, duration: 1, confidence: 0.9, evidence: "유튜브 프리미엄 1달" },
  ]);

  const result = mergeProducts(makeStage1(), stage2, stage3);

  const mixedProduct = result.finalProducts.find((p) => p.source === "mixed");
  assert.ok(mixedProduct, "must have a mixed-source product");
  assert.strictEqual(mixedProduct.confidence, 0.9);
});

// TC-4.4: Catalog rejection — generic names rejected
test("TC-4.4 catalog rejection: non-catalog products rejected, finalProducts excludes generic", () => {
  const stage2 = makeStage2([]);
  const stage3 = makeStage3([
    { name: "OTT 구독", price: 5000, duration: 1, confidence: 0.7, evidence: "OTT 구독 1달" },
    { name: "YouTube Premium", price: 4000, duration: 1, confidence: 0.9, evidence: "유튜브 1달" },
  ]);

  const result = mergeProducts(makeStage1(), stage2, stage3);

  const genericProduct = result.finalProducts.find((p) => p.name === "OTT 구독");
  assert.ok(!genericProduct, "OTT 구독 must be rejected");
  assert.ok(result.rejectedProducts && result.rejectedProducts.length > 0, "rejectedProducts populated");

  const ytProduct = result.finalProducts.find((p) => p.name.includes("YouTube") || p.name.includes("유튜브"));
  assert.ok(ytProduct, "YouTube Premium must survive");
});

// TC-4.5: Both sources empty → finalProducts=[], overall=0
test("TC-4.5 both sources empty: finalProducts=[], overall=0", () => {
  const result = mergeProducts(makeStage1(), makeStage2([]), makeStage3([], true));

  assert.strictEqual(result.finalProducts.length, 0);
  assert.strictEqual(result.confidenceBreakdown.overall, 0);
});

// Shape sanity: Stage4Output required fields
test("Stage4Output shape sanity: required fields always present", () => {
  const result = mergeProducts(makeStage1(), makeStage2([]), makeStage3([], true));

  assert.ok(Array.isArray(result.finalProducts));
  assert.ok(Array.isArray(result.sourceAttribution));
  assert.ok(typeof result.confidenceBreakdown === "object");
  assert.ok(typeof result.confidenceBreakdown.overall === "number");
  assert.ok(Array.isArray(result.confidenceBreakdown.perProduct));
  assert.ok(Array.isArray(result.warnings));
});
