import test from "node:test";
import assert from "node:assert/strict";
import { convertToLegacyFormat } from "../../../lib/competitor-intel/pipeline/adapter.js";
import type { Stage4Output } from "../../../lib/competitor-intel/pipeline/stage4-merge/types.js";
import type { Stage5Output } from "../../../lib/competitor-intel/pipeline/stage5-evidence/types.js";
import type { PpomppuParsedRecord } from "../../../lib/competitor-ad-parser/ppomppu-parser.js";

function makeLegacyBase(): PpomppuParsedRecord {
  return {
    title: "유튜브 프리미엄 할인 판매",
    vendor: "shareplan",
    posted_at: "2026-01-01T00:00:00.000Z",
    posted_at_raw: "2026.01.01",
    landing_url: null,
    products: [{ name: "YouTube Premium", price_krw: 5000, duration_months: 1 }],
    trust_signals: ["정식 사업자"],
    account_type: "family",
    image_urls: [],
    confidence: 0.7,
    warnings: [],
  };
}

function makeStage4(warnings: string[] = []): Stage4Output {
  return {
    finalProducts: [
      { name: "YouTube Premium", price: 4000, duration: 1, source: "mixed", confidence: 0.9 },
    ],
    sourceAttribution: [{ productId: "YouTube Premium|4000|1", sources: ["cheerio", "llm"], votes: 2 }],
    confidenceBreakdown: { overall: 0.9, perProduct: [0.9] },
    warnings,
  };
}

function makeStage5(numProducts = 1, warnings: string[] = []): Stage5Output {
  return {
    productsWithEvidence: Array.from({ length: numProducts }, (_, i) => ({
      name: "YouTube Premium",
      name_evidence: { source_type: "mixed" as const, excerpt: "유튜브 프리미엄 1달 4,000원", confidence: 0.9 },
      price_krw: 4000,
      duration_months: 1,
      confidence: 0.9,
      source: "mixed",
    })),
    evidenceChain: [],
    warnings,
    readyForPersist: true,
  };
}

// Adapter: pipeline products replace legacy products
test("adapter: pipeline products replace legacy products", () => {
  const result = convertToLegacyFormat(makeStage5(1), makeStage4(), makeLegacyBase());

  assert.strictEqual(result.products.length, 1);
  assert.strictEqual(result.products[0].name, "YouTube Premium");
  assert.strictEqual(result.products[0].price_krw, 4000);
  assert.strictEqual(result.products[0].duration_months, 1);
  assert.strictEqual(result.products[0].price_per_month_krw, 4000);
});

// Adapter: confidence from pipeline
test("adapter: confidence comes from stage4 when products found", () => {
  const result = convertToLegacyFormat(makeStage5(1), makeStage4(), makeLegacyBase());

  assert.strictEqual(result.confidence, 0.9);
});

// Adapter: fallback to legacy products when pipeline empty
test("adapter: fallback to legacy products when pipeline returns no products", () => {
  const emptyStage5: Stage5Output = {
    productsWithEvidence: [],
    evidenceChain: [],
    warnings: [],
    readyForPersist: true,
  };
  const result = convertToLegacyFormat(emptyStage5, makeStage4(), makeLegacyBase());

  assert.ok(result.products.length > 0, "must fall back to legacy products");
  assert.strictEqual(result.products[0].name, "YouTube Premium");
  assert.strictEqual(result.confidence, 0.7, "must use legacy confidence when no pipeline products");
});

// Adapter: metadata preserved from legacy
test("adapter: metadata (vendor, dates, trust_signals) preserved from legacy", () => {
  const result = convertToLegacyFormat(makeStage5(1), makeStage4(), makeLegacyBase());

  assert.strictEqual(result.vendor, "shareplan");
  assert.strictEqual(result.posted_at, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result.trust_signals, ["정식 사업자"]);
  assert.strictEqual(result.account_type, "family");
});

// Adapter: warnings merged from all stages
test("adapter: warnings merged from legacy, stage4, stage5", () => {
  const stage4 = makeStage4(["stage4_warning"]);
  const stage5 = makeStage5(1, ["stage5_warning"]);
  const legacy = makeLegacyBase();
  legacy.warnings = ["legacy_warning"];

  const result = convertToLegacyFormat(stage5, stage4, legacy);

  assert.ok(result.warnings.includes("legacy_warning"), "legacy warnings included");
  assert.ok(result.warnings.includes("stage4_warning"), "stage4 warnings included");
  assert.ok(result.warnings.includes("stage5_warning"), "stage5 warnings included");
});

// Adapter: price_per_month_krw computed correctly
test("adapter: price_per_month_krw = price_krw / duration_months", () => {
  const stage5: Stage5Output = {
    productsWithEvidence: [{
      name: "Netflix",
      name_evidence: { source_type: "html", excerpt: "넷플릭스 3달 18,000원", confidence: 0.8 },
      price_krw: 18000,
      duration_months: 3,
      confidence: 0.8,
      source: "cheerio",
    }],
    evidenceChain: [],
    warnings: [],
    readyForPersist: true,
  };

  const result = convertToLegacyFormat(stage5, makeStage4(), makeLegacyBase());
  assert.strictEqual(result.products[0].price_per_month_krw, 6000);
});

// Shape sanity: output matches PpomppuParsedRecord
test("adapter: output is valid PpomppuParsedRecord shape", () => {
  const result = convertToLegacyFormat(makeStage5(1), makeStage4(), makeLegacyBase());

  assert.ok(typeof result.title === "string");
  assert.ok(typeof result.vendor === "string");
  assert.ok(Array.isArray(result.products));
  assert.ok(typeof result.confidence === "number");
  assert.ok(Array.isArray(result.warnings));
});
