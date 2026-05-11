/**
 * Unit tests for catalog-based product name extraction.
 *
 * Tests the shared product catalog matching and noise rejection
 * that protects the LLM text extraction path from returning page
 * chrome / navigation text as product names.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { getProductNameMap, getCatalogForPrompt, getProductKeywords, matchProductName } from "../../../lib/competitor-intel/extraction/product-catalog.js";

// ── Catalog coverage ──

test("catalog has entries for all major products", () => {
  const canonicals = getProductNameMap().map(([, c]) => c);
  assert.ok(canonicals.includes("YouTube Premium"));
  assert.ok(canonicals.includes("Netflix"));
  assert.ok(canonicals.includes("Disney+"));
  assert.ok(canonicals.includes("WAVVE"));
  assert.ok(canonicals.includes("TVING"));
  assert.ok(canonicals.includes("Gemini"));
  assert.ok(canonicals.includes("Melon"));
});

test("catalog has >= 15 entries", () => {
  assert.ok(getProductNameMap().length >= 15);
});

// ── matchProductName: noise rejection ──

test("matchProductName rejects page navigation text", () => {
  assert.strictEqual(matchProductName("POMPPU 장터 ▼ ▲ | 아이디 · 비번"), null);
  assert.strictEqual(matchProductName("뽐뿌 정보 커뮤니티"), null);
  assert.strictEqual(matchProductName("오픈포럼"), null);
  assert.strictEqual(matchProductName("갤러리 창터"), null);
  assert.strictEqual(matchProductName("홈페이지 바로가기"), null);
});

test("matchProductName rejects login / account text", () => {
  assert.strictEqual(matchProductName("아이디 비번"), null);
  assert.strictEqual(matchProductName("로그인"), null);
  assert.strictEqual(matchProductName("회원가입"), null);
});

test("matchProductName rejects marketing / trust boilerplate", () => {
  assert.strictEqual(matchProductName("검증된 뽐뿌인"), null);
  assert.strictEqual(matchProductName("공식 가격"), null);
  assert.strictEqual(matchProductName("BEST CHOICE"), null);
  assert.strictEqual(matchProductName("새로운 구독의 방식"), null);
});

test("matchProductName rejects contact / instruction text", () => {
  assert.strictEqual(matchProductName("이메일 제출"), null);
  assert.strictEqual(matchProductName("문자/카톡"), null);
  assert.strictEqual(matchProductName("쪽지 주세요"), null);
  assert.strictEqual(matchProductName("카톡 아이디"), null);
});

test("matchProductName rejects vendor trust signals", () => {
  assert.strictEqual(matchProductName("뽐뿌 2012년 가입"), null);
  assert.strictEqual(matchProductName("먹튀하는 신생업체"), null);
});

// ── matchProductName: valid product matching ──

test("matchProductName matches YouTube Premium variants", () => {
  assert.strictEqual(matchProductName("유튜브 프리미엄"), "YouTube Premium");
  assert.strictEqual(matchProductName("유튜브프리미엄"), "YouTube Premium");
  assert.strictEqual(matchProductName("YouTube Premium"), "YouTube Premium");
  assert.strictEqual(matchProductName("유프리"), "YouTube Premium");
  assert.strictEqual(matchProductName("유튜브 프리미엄 가족계정"), "YouTube Premium");
  assert.strictEqual(matchProductName("유튜브 프리미엄 개인계정"), "YouTube Premium");
});

test("matchProductName matches YouTube Premium + Music", () => {
  assert.strictEqual(matchProductName("유튜브 프리미엄 뮤직"), "YouTube Premium + Music");
  assert.strictEqual(matchProductName("유튜브프리미엄뮤직"), "YouTube Premium + Music");
});

test("matchProductName matches Netflix variants", () => {
  assert.strictEqual(matchProductName("넷플릭스"), "Netflix");
  assert.strictEqual(matchProductName("넷플"), "Netflix");
  assert.strictEqual(matchProductName("Netflix"), "Netflix");
});

test("matchProductName matches Disney+ variants", () => {
  assert.strictEqual(matchProductName("디즈니"), "Disney+");
  assert.strictEqual(matchProductName("디즈니플러스"), "Disney+");
  assert.strictEqual(matchProductName("Disney+"), "Disney+");
});

test("matchProductName matches WAVVE variants", () => {
  assert.strictEqual(matchProductName("웨이브"), "WAVVE");
  assert.strictEqual(matchProductName("WAVVE"), "WAVVE");
});

test("matchProductName matches TVING variants", () => {
  assert.strictEqual(matchProductName("티빙"), "TVING");
  assert.strictEqual(matchProductName("TVING"), "TVING");
});

test("matchProductName matches Gemini variants", () => {
  assert.strictEqual(matchProductName("제미나이"), "Gemini");
  assert.strictEqual(matchProductName("Gemini"), "Gemini");
});

test("matchProductName matches Melon", () => {
  assert.strictEqual(matchProductName("멜론"), "Melon");
});

test("matchProductName matches Genie Music", () => {
  assert.strictEqual(matchProductName("지니뮤직"), "Genie Music");
  assert.strictEqual(matchProductName("지니 뮤직"), "Genie Music");
});

test("matchProductName matches Coupang Play", () => {
  assert.strictEqual(matchProductName("쿠팡플레이"), "Coupang Play");
  assert.strictEqual(matchProductName("쿠팡 플레이"), "Coupang Play");
});

test("matchProductName matches Apple Music", () => {
  assert.strictEqual(matchProductName("애플뮤직"), "Apple Music");
  assert.strictEqual(matchProductName("애플 뮤직"), "Apple Music");
});

// ── matchProductName: bundle detection ──

test("matchProductName detects bundles with + separator", () => {
  assert.strictEqual(matchProductName("YouTube Premium + Gemini"), "YouTube Premium + Gemini");
  assert.strictEqual(matchProductName("유튜브 프리미엄 + 제미나이"), "YouTube Premium + Gemini");
});

test("matchProductName detects bundles with & separator", () => {
  assert.strictEqual(matchProductName("YouTube Premium & Gemini"), "YouTube Premium + Gemini");
});

test("matchProductName detects bundles with 패키지 keyword", () => {
  assert.strictEqual(matchProductName("유튜브 프리미엄 + 제미나이 패키지"), "YouTube Premium + Gemini");
});

test("matchProductName returns single match when only one part of bundle is a product", () => {
  assert.strictEqual(matchProductName("YouTube Premium & AS서비스"), "YouTube Premium");
});

// ── LLM prompt helpers ──

test("getCatalogForPrompt has readable entries for LLM prompt", () => {
  const lines = getCatalogForPrompt().split("\n");
  assert.ok(lines.length >= 10);
  assert.ok(lines.every((l) => l.includes('"')));
});

test("getCatalogForPrompt includes all major products", () => {
  const prompt = getCatalogForPrompt();
  assert.ok(prompt.includes("YouTube Premium"));
  assert.ok(prompt.includes("Netflix"));
  assert.ok(prompt.includes("Gemini"));
});

test("getProductKeywords returns non-empty keyword set", () => {
  const keywords = getProductKeywords();
  assert.ok(keywords.length >= 20);
  assert.ok(keywords.includes("유튜브"));
  assert.ok(keywords.includes("Netflix"));
  assert.ok(keywords.includes("Gemini"));
});
