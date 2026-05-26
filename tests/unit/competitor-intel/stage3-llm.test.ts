import test from "node:test";
import assert from "node:assert/strict";
import { extractWithLlm, parseExtractResponse } from "../../../lib/competitor-intel/pipeline/stage3-llm/index.js";
import type { Stage0Output } from "../../../lib/competitor-intel/pipeline/stage0-locate/types.js";
import type { Stage1Output } from "../../../lib/competitor-intel/pipeline/stage1-classify/types.js";
import type { Stage2Output } from "../../../lib/competitor-intel/pipeline/stage2-filter/types.js";

function makeStage0(titleText: string, bodyText = ""): Stage0Output {
  return { titleText, bodyText, reductionRatio: 0.5 };
}

function makeStage1(postType: Stage1Output["postType"] = "direct_offer"): Stage1Output {
  return {
    postType,
    classifierConfidence: 0.9,
    classifierEvidence: { excerpt: "test", reasoning: "test" },
    skipExtraction: false,
  };
}

function makeStage2(overrides: Partial<Stage2Output> = {}): Stage2Output {
  return {
    cleanBlocks: [],
    filterReasons: [],
    signalScore: 0.5,
    llmRequired: true,
    contentForLlm: "유튜브 프리미엄 1개월 4,000원",
    ...overrides,
  };
}

// TC-3.1: Skip when llmRequired=false → skipped=true, no LLM call
test("TC-3.1 skip when llmRequired=false: skipped=true, llmProducts empty", async () => {
  const stage2 = makeStage2({ llmRequired: false });
  const result = await extractWithLlm(makeStage0("title"), makeStage1(), stage2);

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.llmProducts.length, 0);
  assert.strictEqual(result.llmConfidence, 0);
});

// TC-3.1b: Skip when stage2.skip=true → skipped=true
test("TC-3.1b skip when stage2.skip=true: skipped=true", async () => {
  const stage2 = makeStage2({ skip: true, llmRequired: true });
  const result = await extractWithLlm(makeStage0("title"), makeStage1(), stage2);

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.llmProducts.length, 0);
});

// TC-3.2: Implicit name resolution — LLM response maps implicit title name to catalog
test("TC-3.2 implicit name resolution: YouTube Premium from title resolved to catalog", () => {
  const raw = JSON.stringify({
    products: [
      { name: "유튜브 프리미엄", duration_months: 1, price_krw: 4000, evidence: "가족계정 1개월 4,000원" },
    ],
  });
  const { llmProducts, warnings } = parseExtractResponse(raw, "유튜브 프리미엄 1달 이벤트");

  assert.ok(llmProducts.length >= 1, "must find at least 1 product");
  const product = llmProducts[0];
  assert.ok(
    product.name === "YouTube Premium" || product.name.includes("YouTube") || product.name.includes("유튜브"),
    `name '${product.name}' must resolve to a YouTube Premium variant`,
  );
  assert.ok(!warnings.some((w) => w.startsWith("extract_zod_error")), "no Zod errors");
});

// TC-3.3: Catalog rejection — generic 'OTT 구독' name rejected
test("TC-3.3 catalog rejection: 'OTT 구독' not in catalog → filtered out", () => {
  const raw = JSON.stringify({
    products: [
      { name: "OTT 구독", duration_months: 1, price_krw: 5000, evidence: "OTT 구독 1달" },
      { name: "YouTube Premium", duration_months: 1, price_krw: 4000, evidence: "유튜브 프리미엄 1달" },
    ],
  });
  const { llmProducts, warnings } = parseExtractResponse(raw, "OTT 구독 판매");

  const junkProduct = llmProducts.find((p) => p.name === "OTT 구독");
  assert.ok(!junkProduct, "OTT 구독 must be rejected by catalog filter");

  const ytProduct = llmProducts.find((p) => p.name.includes("YouTube") || p.name.includes("유튜브"));
  assert.ok(ytProduct, "YouTube Premium must pass catalog filter");

  assert.ok(warnings.some((w) => w.startsWith("catalog_rejected")), "must have catalog_rejected warning");
});

// TC-3.4: Cross-pairing fix — shared (price, duration) with close-variant names → deduplicated
test("TC-3.4 cross-pairing: same price+duration + close names → keep only first", () => {
  const raw = JSON.stringify({
    products: [
      { name: "YouTube Premium 가족계정", duration_months: 1, price_krw: 4000, evidence: "가족계정 1달" },
      { name: "YouTube Premium 개인계정", duration_months: 1, price_krw: 4000, evidence: "개인계정 1달" },
    ],
  });
  const { llmProducts } = parseExtractResponse(raw, "YouTube Premium 계정 판매");

  assert.ok(llmProducts.length <= 1, `cross-pairing should reduce to 1, got ${llmProducts.length}`);
});

// TC-3.5: Malformed JSON → empty products + warning
test("TC-3.5 malformed JSON: empty products + parse_error warning", () => {
  const { llmProducts, warnings } = parseExtractResponse("죄송합니다, 제품을 찾지 못했습니다", "title");

  assert.strictEqual(llmProducts.length, 0);
  assert.ok(warnings.length > 0, "must have at least one warning");
});

// TC-3.6: Products without price → filtered out (Zod requires price_krw)
test("TC-3.6 no price → product filtered by Zod schema", () => {
  const raw = JSON.stringify({
    products: [
      { name: "Netflix", evidence: "넷플릭스" },
    ],
  });
  const { llmProducts } = parseExtractResponse(raw, "title");

  assert.strictEqual(llmProducts.length, 0, "product without price must be filtered");
});

// Shape sanity: Stage3Output required fields
test("Stage3Output shape sanity: required fields present when skipped", async () => {
  const result = await extractWithLlm(
    makeStage0("title"),
    makeStage1(),
    makeStage2({ llmRequired: false }),
  );

  assert.ok(typeof result.skipped === "boolean");
  assert.ok(Array.isArray(result.llmProducts));
  assert.ok(typeof result.llmConfidence === "number");
  assert.ok(typeof result.promptContext === "string");
});

// TC-3.7: LLM returns top-level array instead of {products: [...]} → normalized
test("TC-3.7 top-level array response → normalized to {products:[]}", () => {
  const raw = JSON.stringify([
    { name: "Netflix", price_krw: 15000, duration_months: 1, confidence: 0.9, evidence: "넷플릭스 1개월" },
  ]);
  const { llmProducts, warnings } = parseExtractResponse(raw, "넷플릭스 구독");
  assert.strictEqual(warnings.length, 0, `unexpected warnings: ${warnings.join(", ")}`);
  assert.strictEqual(llmProducts.length, 1, "array-format response should yield 1 product");
  assert.strictEqual(llmProducts[0].name, "Netflix");
});

// TC-3.8: LLM uses "product_name" key instead of "name" → normalized
test("TC-3.8 product_name alias → renamed to name", () => {
  const raw = JSON.stringify({
    products: [
      { product_name: "YouTube Premium", price_krw: 17000, duration_months: 3, confidence: 0.85, evidence: "유튜브 프리미엄" },
    ],
  });
  const { llmProducts, warnings } = parseExtractResponse(raw, "유튜브 프리미엄");
  assert.strictEqual(warnings.length, 0, `unexpected warnings: ${warnings.join(", ")}`);
  assert.strictEqual(llmProducts.length, 1, "product_name alias should produce 1 product");
  assert.strictEqual(llmProducts[0].name, "YouTube Premium");
});

// TC-3.9: LLM returns top-level array with product_name → both normalizations applied
test("TC-3.9 top-level array + product_name alias → both normalized", () => {
  const raw = `\`\`\`json\n${JSON.stringify([
    { product_name: "YouTube Premium", price_krw: 17000, duration_months: 3 },
  ])}\n\`\`\``;
  const { llmProducts, warnings } = parseExtractResponse(raw, "유튜브 프리미엄 3개월");
  assert.strictEqual(warnings.length, 0, `unexpected warnings: ${warnings.join(", ")}`);
  assert.strictEqual(llmProducts.length, 1);
  assert.strictEqual(llmProducts[0].name, "YouTube Premium");
});
