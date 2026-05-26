import test from "node:test";
import assert from "node:assert/strict";
import { attachEvidence } from "../../../lib/competitor-intel/pipeline/stage5-evidence/index.js";
import type { Stage1Output } from "../../../lib/competitor-intel/pipeline/stage1-classify/types.js";
import type { Stage2Output, CleanBlock } from "../../../lib/competitor-intel/pipeline/stage2-filter/types.js";
import type { Stage3Output } from "../../../lib/competitor-intel/pipeline/stage3-llm/types.js";
import type { Stage4Output, FinalProduct } from "../../../lib/competitor-intel/pipeline/stage4-merge/types.js";

function makeStage1(postType: Stage1Output["postType"] = "direct_offer"): Stage1Output {
  return { postType, classifierConfidence: 0.9, classifierEvidence: { excerpt: "유튜브 1달 4000원", reasoning: "direct" }, skipExtraction: false };
}

function makeStage2(cleanBlocks: CleanBlock[] = []): Stage2Output {
  return { cleanBlocks, filterReasons: [], signalScore: 0.8, llmRequired: false, contentForLlm: "" };
}

function makeStage3(skipped: boolean, llmProducts: Stage3Output["llmProducts"] = []): Stage3Output {
  return { llmProducts, skipped, promptContext: "prompt context here...", llmConfidence: 0.8 };
}

function makeStage4(finalProducts: FinalProduct[]): Stage4Output {
  return {
    finalProducts,
    sourceAttribution: finalProducts.map((p, i) => ({
      productId: `${p.name}|${p.price ?? ""}|${p.duration ?? ""}`,
      sources: [p.source],
      votes: 1,
    })),
    confidenceBreakdown: { overall: 0.8, perProduct: finalProducts.map(() => 0.8) },
    warnings: [],
  };
}

function makeCleanBlock(text: string): CleanBlock {
  return { text, lineIndex: 0, hasPrice: true, hasDuration: true, hasProductKeyword: true };
}

// TC-5.1: Full evidence chain — product with name, price, duration, all from Cheerio
test("TC-5.1 full evidence chain: name_evidence, price_evidence, duration_evidence all attached", () => {
  const cleanBlocks: CleanBlock[] = [
    makeCleanBlock("유튜브 프리미엄 1개월 4,000원"),
  ];
  const stage2 = makeStage2(cleanBlocks);
  const stage3 = makeStage3(true); // skipped
  const stage4 = makeStage4([
    { name: "YouTube Premium", price: 4000, duration: 1, source: "cheerio", confidence: 0.8 },
  ]);

  const result = attachEvidence(stage4, makeStage1(), stage2, stage3);

  assert.strictEqual(result.productsWithEvidence.length, 1);
  const pwev = result.productsWithEvidence[0];
  assert.ok(pwev.name_evidence, "name_evidence must be present");
  assert.ok(pwev.price_evidence, "price_evidence must be present");
  assert.ok(pwev.duration_evidence, "duration_evidence must be present");
  assert.strictEqual(result.readyForPersist, true);
});

// TC-5.2: Missing evidence — product with price but no matching block → warning + lowered confidence
test("TC-5.2 missing evidence: warning added when no matching block", () => {
  const stage2 = makeStage2([]); // no blocks
  const stage3 = makeStage3(true);
  const stage4 = makeStage4([
    { name: "YouTube Premium", price: 4000, duration: 1, source: "cheerio", confidence: 0.8 },
  ]);

  const result = attachEvidence(stage4, makeStage1(), stage2, stage3);

  assert.ok(result.warnings.some((w) => w.includes("name_evidence")), "must have evidence warning");
  assert.ok(result.productsWithEvidence[0].name_evidence, "name_evidence must still exist (fallback)");
});

// TC-5.3: LLM evidence — product from LLM, evidence.source_type='llm'
test("TC-5.3 LLM evidence: source_type=llm, llm_prompt_context attached", () => {
  const stage2 = makeStage2([]);
  const stage3 = makeStage3(false, [
    { name: "Netflix", price: 6500, duration: 1, confidence: 0.9, evidence: "넷플릭스 1달 6,500원" },
  ]);
  const stage4 = makeStage4([
    { name: "Netflix", price: 6500, duration: 1, source: "llm", confidence: 0.8 },
  ]);

  const result = attachEvidence(stage4, makeStage1(), stage2, stage3);

  const pwev = result.productsWithEvidence[0];
  assert.strictEqual(pwev.name_evidence.source_type, "llm");
  assert.ok(pwev.name_evidence.llm_prompt_context, "llm_prompt_context must be attached");
  assert.ok(result.evidenceChain.some((e) => e.source === "llm"), "evidenceChain must have llm entry");
});

// TC-5.4: Mixed evidence — source=mixed, name from LLM, price can come from HTML or LLM
test("TC-5.4 mixed evidence: name_evidence.source_type=llm for mixed product", () => {
  const cleanBlocks: CleanBlock[] = [makeCleanBlock("유튜브 프리미엄 1개월 4,000원")];
  const stage2 = makeStage2(cleanBlocks);
  const stage3 = makeStage3(false, [
    { name: "YouTube Premium", price: 4000, duration: 1, confidence: 0.9, evidence: "YouTube Premium 1달 4,000원" },
  ]);
  const stage4 = makeStage4([
    { name: "YouTube Premium", price: 4000, duration: 1, source: "mixed", confidence: 0.9 },
  ]);

  const result = attachEvidence(stage4, makeStage1(), stage2, stage3);

  const pwev = result.productsWithEvidence[0];
  assert.strictEqual(pwev.name_evidence.source_type, "llm", "mixed product name_evidence source should be llm");
  assert.strictEqual(pwev.source, "mixed");
});

// TC-5.5: Evidence chain count — each product field that has evidence gets an entry
test("TC-5.5 evidence chain: populated with correct field entries", () => {
  const cleanBlocks: CleanBlock[] = [makeCleanBlock("넷플릭스 1개월 6,500원")];
  const stage2 = makeStage2(cleanBlocks);
  const stage3 = makeStage3(true);
  const stage4 = makeStage4([
    { name: "Netflix", price: 6500, duration: 1, source: "cheerio", confidence: 0.8 },
  ]);

  const result = attachEvidence(stage4, makeStage1(), stage2, stage3);

  const nameEntries = result.evidenceChain.filter((e) => e.field === "name");
  assert.ok(nameEntries.length >= 1, "must have name entry in evidenceChain");
  assert.ok(result.auditTrail && result.auditTrail.length > 0, "auditTrail populated");
});

// TC-5.6: productsWithEvidence.length === stage4.finalProducts.length
test("TC-5.6 productsWithEvidence count equals finalProducts count", () => {
  const cleanBlocks: CleanBlock[] = [
    makeCleanBlock("유튜브 프리미엄 1개월 4,000원"),
    makeCleanBlock("넷플릭스 1개월 6,500원"),
  ];
  const stage4 = makeStage4([
    { name: "YouTube Premium", price: 4000, duration: 1, source: "cheerio", confidence: 0.8 },
    { name: "Netflix", price: 6500, duration: 1, source: "cheerio", confidence: 0.8 },
  ]);

  const result = attachEvidence(stage4, makeStage1(), makeStage2(cleanBlocks), makeStage3(true));

  assert.strictEqual(result.productsWithEvidence.length, stage4.finalProducts.length);
  assert.strictEqual(result.readyForPersist, true);
});

// Shape sanity: Stage5Output required fields
test("Stage5Output shape sanity: required fields always present", () => {
  const result = attachEvidence(makeStage4([]), makeStage1(), makeStage2(), makeStage3(true));

  assert.ok(Array.isArray(result.productsWithEvidence));
  assert.ok(Array.isArray(result.evidenceChain));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(typeof result.readyForPersist === "boolean");
});
