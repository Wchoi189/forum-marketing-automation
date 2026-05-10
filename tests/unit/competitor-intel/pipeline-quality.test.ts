import test from "node:test";
import assert from "node:assert/strict";
import { extractProductsFromText, extractTextBlocks } from "../../../lib/competitor-intel/extraction/pipeline.js";
import type { EvidenceSource } from "../../../lib/competitor-intel/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlocks(texts: string[]): EvidenceSource[] {
  return texts.map((t, i) => ({ type: "html" as const, excerpt: t, source_block: `path-${i}` }));
}

// ---------------------------------------------------------------------------
// Issue 1: Full paragraph text should not become product names
// ---------------------------------------------------------------------------

test("extractProductsFromText: paragraph text does not become product name", () => {
  const blocks = makeBlocks([
    "유프리 홈페이지 바로가기 검증된 뽐뿌인에게 신청하세요 뽐뿌 가입 2009년 유튜브 프리미엄 호스트 운영 6년차",
    "1년 55,000원",
  ]);
  const { products } = extractProductsFromText(blocks);

  for (const p of products) {
    assert.ok(
      p.name.length < 50,
      `Product name too long (${p.name.length} chars): "${p.name}"`
    );
    assert.ok(
      !p.name.includes("뽐뿌 가입") && !p.name.includes("홈페이지 바로가기"),
      `Boilerplate text became product name: "${p.name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 2: Navigation header should not become product name
// ---------------------------------------------------------------------------

test("extractProductsFromText: navigation header not in product name", () => {
  const blocks = makeBlocks([
    "PPOMPPU 장터 뽐뿌 정보 커뮤니티 포럼 오픈포럼 갤러리 창터 뉴스 상담실 회원가입 아이디 비번찾기 로그인 OTT/멤버십 입니다",
    "1달 4,000원",
  ]);
  const { products } = extractProductsFromText(blocks);

  for (const p of products) {
    assert.ok(
      !p.name.includes("회원가입") && !p.name.includes("상담실") && !p.name.includes("로그인"),
      `Navigation text became product name: "${p.name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 3: Decorative / emoji text not in product names
// ---------------------------------------------------------------------------

test("extractProductsFromText: decorative text not in product name", () => {
  const blocks = makeBlocks([
    "BEST VALUE 이용권 Netflix Premium ₩34,900",
  ]);
  const { products } = extractProductsFromText(blocks);

  for (const p of products) {
    assert.ok(
      !p.name.includes("BEST VALUE"),
      `Decorative text became product name: "${p.name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 4: Same product should not be duplicated
// ---------------------------------------------------------------------------

test("extractProductsFromText: deduplicates within result", () => {
  const blocks = makeBlocks([
    "유튜브 프리미엄 3개월 15,000원",
    "유튜브 프리미엄 3개월 15,000원",
    "넷플릭스 1개월 8,000원",
    "넷플릭스 1개월 8,000원",
  ]);
  const { products } = extractProductsFromText(blocks);

  const unique = new Set(products.map((p) => `${p.name}|${p.price_krw}|${p.duration_months}`));
  assert.equal(
    unique.size,
    products.length,
    `Duplicate products found: ${products.length} total but only ${unique.size} unique`
  );
});

// ---------------------------------------------------------------------------
// Issue 5: Fragment text should not become product name
// ---------------------------------------------------------------------------

test("extractProductsFromText: fragment text does not become product name", () => {
  const blocks = makeBlocks([
    "1. 제미나이 프로(Best) / 런칭기념 한정특가 판매중입니다.",
    "12개월 19,900원",
  ]);
  const { products } = extractProductsFromText(blocks);

  for (const p of products) {
    assert.ok(
      !p.name.startsWith("(Best)"),
      `Fragment became product name: "${p.name}"`
    );
    assert.ok(
      !p.name.includes("런칭기념") || p.name.includes("Gemini"),
      `Fragment text became product name: "${p.name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 6: extractTextBlocks should clamp properly and not produce junk
// ---------------------------------------------------------------------------

test("extractTextBlocks: clamps text to 160 chars", () => {
  const longText = "a".repeat(500);
  const nodes = [{ text: longText, name: "", path: "/test", children: [] }];
  const blocks = extractTextBlocks(nodes as any);

  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].excerpt.length <= 160, `Block excerpt too long: ${blocks[0].excerpt.length}`);
});
