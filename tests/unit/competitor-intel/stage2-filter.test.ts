import test from "node:test";
import assert from "node:assert/strict";
import { filterNoise } from "../../../lib/competitor-intel/pipeline/stage2-filter/index.js";
import type { Stage0Output } from "../../../lib/competitor-intel/pipeline/stage0-locate/types.js";
import type { Stage1Output } from "../../../lib/competitor-intel/pipeline/stage1-classify/types.js";

function makeStage0(bodyText: string, titleText = "Test Post"): Stage0Output {
  return {
    titleText,
    bodyText,
    reductionRatio: 0.5,
    debugInfo: { originalChars: bodyText.length * 2, cleanChars: bodyText.length, reductionPct: 50, tool: "trafilatura" },
  };
}

function makeStage1(postType: Stage1Output["postType"] = "direct_offer"): Stage1Output {
  return {
    postType,
    classifierConfidence: 0.9,
    classifierEvidence: { excerpt: "test", reasoning: "test" },
    skipExtraction: postType === "affiliate" || postType === "promo_code",
  };
}

// TC-2.1: 3 clean product blocks → signalScore high, llmRequired=false
test("TC-2.1 clean products: signalScore >= 0.85, llmRequired=false", () => {
  const body = [
    "유튜브 프리미엄 1개월 4,000원",
    "유튜브 프리미엄 3개월 11,000원",
    "넷플릭스 프리미엄 1개월 6,500원",
  ].join("\n");

  const result = filterNoise(makeStage0(body), makeStage1("direct_offer"));

  assert.strictEqual(result.cleanBlocks.length, 3, "all 3 blocks kept");
  assert.ok(result.signalScore >= 0.85, `signalScore ${result.signalScore} must be >= 0.85`);
  assert.strictEqual(result.llmRequired, false);
  assert.ok(result.contentForLlm.length > 0, "contentForLlm must be non-empty");
});

// TC-2.2: SharePlan-style heavy noise → signalScore < 0.3, llmRequired=true
test("TC-2.2 heavy noise: signalScore < 0.5, llmRequired=true, removedBlocks populated", () => {
  const body = [
    "본 게시물의 저작권은 공유플랜에 있습니다",
    "원본 식별자: SP-20240101000000-ABCDEF",
    "무단 복제 및 재배포는 저작권법에 의해 처벌받을 수 있습니다",
    "All Rights Reserved 793-08-03288",
    "본 게시물의 저작권은 공유플랜에 있습니다",
    "원본 식별자: SP-20240101000001-BCDEF1",
    "무단 복제 및 재배포는 저작권법에 의해 처벌받을 수 있습니다",
    "원본 식별자: SP-20240101000002-CDEF12",
    "원본 식별자: SP-20240101000003-DEF123",
    "원본 식별자: SP-20240101000004-EF1234",
    "원본 식별자: SP-20240101000005-F12345",
    "원본 식별자: SP-20240101000006-123456",
    "원본 식별자: SP-20240101000007-234567",
    "원본 식별자: SP-20240101000008-345678",
    "원본 식별자: SP-20240101000009-456789",
  ].join("\n");

  const result = filterNoise(makeStage0(body), makeStage1("direct_offer"));

  assert.ok(result.signalScore < 0.5, `signalScore ${result.signalScore} must be < 0.5`);
  assert.strictEqual(result.llmRequired, true);
  assert.ok(result.removedBlocks && result.removedBlocks.length > 0, "removedBlocks must be populated");
});

// TC-2.3: Mixed content — products + FAQ + payment info
test("TC-2.3 mixed content: product blocks kept, FAQ/payment removed, filterReasons present", () => {
  const body = [
    "유튜브 프리미엄 1개월 4,000원",
    "넷플릭스 구독 1개월 6,500원",
    "Q. 배송은 얼마나 걸리나요?",
    "A. 보통 1-2일 소요됩니다",
    "계좌번호 000-0000-0000",
    "쪽지 주세요",
  ].join("\n");

  const result = filterNoise(makeStage0(body), makeStage1("direct_offer"));

  const productBlocks = result.cleanBlocks.filter((b) => b.hasProductKeyword || b.hasPrice);
  assert.ok(productBlocks.length >= 2, `must have >= 2 product blocks, got ${productBlocks.length}`);
  assert.ok(result.filterReasons.length > 0, "filterReasons must be populated");
  assert.ok(result.removedBlocks && result.removedBlocks.length > 0, "removed blocks for FAQ/payment");
});

// TC-2.4: Partial noise — block with license text BUT includes price → preserved, filterReason='partial_noise'
test("TC-2.4 partial noise: license+price block preserved with filterReason=partial_noise", () => {
  const body = [
    "구독플레이스 유튜브 프리미엄 1개월 17,000원 본 게시물의 저작권은",
    "일반 상품 설명",
  ].join("\n");

  const result = filterNoise(makeStage0(body), makeStage1("direct_offer"));

  const partialBlock = result.cleanBlocks.find((b) => b.filterReason === "partial_noise");
  assert.ok(partialBlock, "must have a block with filterReason=partial_noise");
  assert.ok(partialBlock.hasPrice, "partial_noise block must have hasPrice=true");
});

// TC-2.5: Affiliate post type → skip=true, cleanBlocks=[], signalScore=0
test("TC-2.5 affiliate skip: skip=true, cleanBlocks empty, llmRequired=false", () => {
  const body = "GamsGo에서 할인된 가격으로 유튜브 프리미엄을 구매하세요";

  const result = filterNoise(makeStage0(body), makeStage1("affiliate"));

  assert.strictEqual(result.skip, true);
  assert.strictEqual(result.cleanBlocks.length, 0);
  assert.strictEqual(result.signalScore, 0);
  assert.strictEqual(result.llmRequired, false);
});

// TC-2.6: Promo code post type → skip=true
test("TC-2.6 promo_code skip: skip=true", () => {
  const body = "SALE20 코드 사용시 20% 할인";

  const result = filterNoise(makeStage0(body), makeStage1("promo_code"));

  assert.strictEqual(result.skip, true);
  assert.strictEqual(result.cleanBlocks.length, 0);
});

// TC-2.7: LLM required when signalScore < 0.85
test("TC-2.7 llmRequired=true when signalScore < 0.85", () => {
  // Only product keywords, no prices → low signal
  const body = [
    "유튜브 구독 서비스",
    "넷플릭스 계정 판매",
    "이런저런 내용들입니다",
  ].join("\n");

  const result = filterNoise(makeStage0(body), makeStage1("direct_offer"));

  assert.ok(result.signalScore < 0.85, `signalScore ${result.signalScore} should be < 0.85`);
  assert.strictEqual(result.llmRequired, true);
});

// Shape sanity: Stage2Output always has required fields
test("Stage2Output shape sanity: required fields always present", () => {
  const result = filterNoise(
    makeStage0("유튜브 프리미엄 1개월 4,000원"),
    makeStage1("direct_offer"),
  );

  assert.ok(Array.isArray(result.cleanBlocks));
  assert.ok(Array.isArray(result.filterReasons));
  assert.ok(typeof result.signalScore === "number");
  assert.ok(typeof result.llmRequired === "boolean");
  assert.ok(typeof result.contentForLlm === "string");
});
