import test from "node:test";
import assert from "node:assert/strict";
import { parseClassifyResponse } from "../../../lib/competitor-intel/pipeline/stage1-classify/index.js";

// TC-1.1: Direct offer — vendor selling directly with price
test("TC-1.1 direct offer: postType=direct_offer, confidence >= 0.9", () => {
  const raw = JSON.stringify({
    postType: "direct_offer",
    confidence: 0.95,
    evidence: {
      excerpt: "유튜브 프리미엄 1달 4000원",
      reasoning: "Vendor posts direct pricing for YouTube Premium subscription",
    },
  });
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "direct_offer");
  assert.ok(result.classifierConfidence >= 0.9, `confidence ${result.classifierConfidence} must be >= 0.9`);
  assert.strictEqual(result.skipExtraction, false);
  assert.ok(result.classifierEvidence.excerpt.length > 0, "excerpt must be non-empty");
  assert.ok(result.classifierEvidence.reasoning.length > 0, "reasoning must be non-empty");
});

// TC-1.2: Affiliate — GamsGo reference → skipExtraction=true, affiliateTarget='GamsGo'
test("TC-1.2 affiliate GamsGo: postType=affiliate, affiliateTarget='GamsGo', skipExtraction=true", () => {
  const raw = JSON.stringify({
    postType: "affiliate",
    confidence: 0.92,
    evidence: {
      excerpt: "GamsGo 프로모션 코드",
      reasoning: "Post directs users to GamsGo external vendor for purchase",
    },
    affiliateTarget: "GamsGo",
  });
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "affiliate");
  assert.strictEqual(result.affiliateTarget, "GamsGo");
  assert.strictEqual(result.skipExtraction, true);
  assert.ok(!result.promoCode, "promoCode must be absent for affiliate");
});

// TC-1.3: Promo code — discount code → skipExtraction=true, promoCode='SALE20'
test("TC-1.3 promo code: postType=promo_code, promoCode='SALE20', skipExtraction=true", () => {
  const raw = JSON.stringify({
    postType: "promo_code",
    confidence: 0.91,
    evidence: {
      excerpt: "SALE20 코드 사용시 20% 할인",
      reasoning: "Post advertises a discount code without direct product pricing",
    },
    promoCode: "SALE20",
  });
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "promo_code");
  assert.strictEqual(result.promoCode, "SALE20");
  assert.strictEqual(result.skipExtraction, true);
  assert.ok(!result.affiliateTarget, "affiliateTarget must be absent for promo_code");
});

// TC-1.4: Comparison — official vs vendor price → referencePrice=14900
test("TC-1.4 comparison: postType=comparison, referencePrice=14900, skipExtraction=false", () => {
  const raw = JSON.stringify({
    postType: "comparison",
    confidence: 0.88,
    evidence: {
      excerpt: "공식 가격 14,900원 vs 우리 9,900원",
      reasoning: "Post explicitly compares official retail price to vendor offer price",
    },
    referencePrice: 14900,
  });
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "comparison");
  assert.strictEqual(result.referencePrice, 14900);
  assert.strictEqual(result.skipExtraction, false);
});

// TC-1.5: Bloated marketing title → direct_offer (intent is to sell)
test("TC-1.5 bloated marketing title: postType=direct_offer, confidence high", () => {
  const raw = JSON.stringify({
    postType: "direct_offer",
    confidence: 0.93,
    evidence: {
      excerpt: "최저가 보장! 정식 사업자! 가족계정!",
      reasoning: "Despite marketing language, post intent is direct subscription sale",
    },
  });
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "direct_offer");
  assert.ok(result.classifierConfidence >= 0.85, `confidence ${result.classifierConfidence} must be >= 0.85`);
  assert.strictEqual(result.skipExtraction, false);
});

// Robustness: markdown-fenced JSON response
test("Robustness: markdown-fenced JSON is unwrapped correctly", () => {
  const raw = "```json\n" + JSON.stringify({
    postType: "affiliate",
    confidence: 0.9,
    evidence: { excerpt: "AllKeyShop 링크", reasoning: "External vendor link" },
    affiliateTarget: "AllKeyShop",
  }) + "\n```";
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "affiliate");
  assert.strictEqual(result.affiliateTarget, "AllKeyShop");
});

// Robustness: malformed JSON → unknown with warning
test("Robustness: malformed LLM output → unknown + warning", () => {
  const result = parseClassifyResponse("Sorry, I cannot classify this post.");

  assert.strictEqual(result.postType, "unknown");
  assert.strictEqual(result.classifierConfidence, 0);
  assert.ok(result.warnings?.some(w => w.startsWith("classify_parse_error")), "must have parse error warning");
});

// Robustness: unknown postType value → coerced to unknown
test("Robustness: unknown postType coerced to 'unknown'", () => {
  const raw = JSON.stringify({
    postType: "reseller",
    confidence: 0.7,
    evidence: { excerpt: "some text", reasoning: "some reason" },
  });
  const result = parseClassifyResponse(raw);

  assert.strictEqual(result.postType, "unknown");
  assert.ok(result.warnings?.some(w => w.includes("classify_unknown_type")), "must have unknown_type warning");
});

// Shape sanity: Stage1Output always has required fields
test("Stage1Output shape sanity: required fields always present", () => {
  const raw = JSON.stringify({
    postType: "direct_offer",
    confidence: 0.85,
    evidence: { excerpt: "test", reasoning: "test reason" },
  });
  const result = parseClassifyResponse(raw);

  assert.ok(typeof result.postType === "string");
  assert.ok(typeof result.classifierConfidence === "number");
  assert.ok(typeof result.classifierEvidence === "object");
  assert.ok(typeof result.classifierEvidence.excerpt === "string");
  assert.ok(typeof result.classifierEvidence.reasoning === "string");
  assert.ok(typeof result.skipExtraction === "boolean");
});
