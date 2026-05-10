import test from "node:test";
import assert from "node:assert/strict";
import { parsePpomppuPost } from "../../../lib/competitor-ad-parser/ppomppu-parser.js";

// ---------------------------------------------------------------------------
// Helpers — build minimal HTML with various realistic ppomppu patterns
// ---------------------------------------------------------------------------

function makeHtml(bodyHtml: string): string {
  return `
    <html>
      <head><meta property="og:title" content="Test Ad"></head>
      <body>
        <div id="topTitle"><h1>Test Ad</h1></div>
        <li class="topTitle-name">SharePlan</li>
        <ul class="topTitle-mainbox"><li>등록일 2026-01-15 14:30:00</li></ul>
        <li class="topTitle-link"><a href="https://ppomppu.co.kr/redirector.php?target=${Buffer.from("https://example.com/landing").toString("base64")}">링크</a></li>
        <div class="JS_ContentMain">
          <td class="board-contents">${bodyHtml}</td>
        </div>
      </body>
    </html>
  `;
}

// ---------------------------------------------------------------------------
// Issue 1: Navigation / boilerplate text should NOT become product names
// ---------------------------------------------------------------------------

test("parsePpomppuPost: navigation text does not become product name", () => {
  const bodyHtml = `
    <p>PPOMPPU 장터 블루 정보 커뮤니티 포럼 오픈포럼 컬러리 장터 뉴스 상담실 회원가입 아이디 비번 찾기 로그인</p>
    <p>OTT멤버십 입니다. 해외구매대행</p>
    <p>1. 유튜브 프리미엄 고객님의 계정에 충전</p>
    <p>12개월 49,000원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  const names = result.products.map((p) => p.name);
  for (const name of names) {
    assert.ok(
      !name.includes("PPOMPPU") || name.includes("YouTube"),
      `Navigation text became product name: "${name}"`
    );
    assert.ok(
      !name.includes("회원가입") && !name.includes("상담실"),
      `Boilerplate became product name: "${name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 2: Product names should be concise, not full paragraphs
// ---------------------------------------------------------------------------

test("parsePpomppuPost: product name should not be a full paragraph", () => {
  const bodyHtml = `
    <p>유프리 홈페이지 바로가기 검증된 뽐뿌인에게 신청하세요 뽐뿌 가입 2009년 유튜브 프리미엄 호스트 운영 6년차 먹튀하는 신생업체에 또 당하지 마시고안전하고 확실한 곳에서 시작하세요</p>
    <p>1년 55,000원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  for (const p of result.products) {
    // Names should not contain long boilerplate sentences
    assert.ok(
      p.name.length < 60,
      `Product name too long (${p.name.length} chars): "${p.name}"`
    );
    assert.ok(
      !p.name.includes("뽐뿌 가입"),
      `Long paragraph text leaked into product name: "${p.name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 3: Promotional / decorative text should not become product names
// ---------------------------------------------------------------------------

test("parsePpomppuPost: decorative text does not become product name", () => {
  const bodyHtml = `
    <p><b>💎 BEST VALUE 이용권 Netflix Premium ₩34,900</b></p>
    <p>이용권 Netflix Premium ₩18,900</p>
    <p>3개월 18,900원</p>
    <p>6개월 34,900원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  const names = result.products.map((p) => p.name);
  for (const name of names) {
    assert.ok(
      !name.includes("BEST VALUE"),
      `Decorative text became product name: "${name}"`
    );
    assert.ok(
      !name.includes("💎"),
      `Emoji leaked into product name: "${name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 4: Fragment text with colons/parentheses should not become names
// ---------------------------------------------------------------------------

test("parsePpomppuPost: fragment text does not become product name", () => {
  const bodyHtml = `
    <p>1. 제미나이 프로(Best)🔥 / 런칭기념 한정특가 판매중입니다.</p>
    <p>12개월 19,900원</p>
    <p>18개월 24,900원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  const names = result.products.map((p) => p.name);
  for (const name of names) {
    // Should not contain full sentence fragments as names
    assert.ok(
      !name.includes("런칭기념") || name.includes("Gemini"),
      `Fragment text became product name: "${name}"`
    );
    assert.ok(
      !name.startsWith("(Best)"),
      `Decorative fragment became product name: "${name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 5: Same product should not appear duplicated within one record
// ---------------------------------------------------------------------------

test("parsePpomppuPost: deduplicates products within a record", () => {
  // Realistic pattern where the same price line appears multiple times
  // (e.g. in a highlighted/summary section and a detailed section)
  const bodyHtml = `
    <p><b>유튜브 프리미엄</b></p>
    <p>3개월 15,000원</p>
    <p>6개월 28,000원</p>
    <p><b>유튜브 프리미엄 요약</b></p>
    <p>3개월 15,000원</p>
    <p>6개월 28,000원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  const unique = new Set(result.products.map((p) => `${p.name}|${p.price_krw}|${p.duration_months}`));
  assert.equal(
    unique.size,
    result.products.length,
    `Duplicate products found: ${result.products.length} total but only ${unique.size} unique`
  );
});

// ---------------------------------------------------------------------------
// Issue 6: Product names from non-category paragraphs should be sensible
// ---------------------------------------------------------------------------

test("parsePpomppuPost: non-category product name should not contain navigation or boilerplate", () => {
  const bodyHtml = `
    <p>PPOMPPU 장터 뽐뿌 정보 커뮤니티 포럼 오픈포럼 갤러리 창터 뉴스 상담실 회원가입 아이디 비번찾기 로그인 OTT/멤버십 입니다. 해외구매대행 넷플릭스 프리미엄 개인 공유 모바일/태블릿 만 이용</p>
    <p>1달 4,000원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  for (const p of result.products) {
    // Product name should not contain navigation elements
    assert.ok(
      !p.name.includes("회원가입") && !p.name.includes("상담실") && !p.name.includes("로그인"),
      `Navigation text leaked into product name: "${p.name}"`
    );
    // Should not contain the full PPOMPPU header
    assert.ok(
      !p.name.includes("PPOMPPU") || p.name.includes("Netflix") || p.name.includes("YouTube"),
      `PPOMPPU header leaked into product name: "${p.name}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue 7: Price-only lines should get sensible fallback names
// ---------------------------------------------------------------------------

test("parsePpomppuPost: price-only line gets reasonable fallback name", () => {
  const bodyHtml = `
    <p>12개월 60,000 원</p>
  `;
  const html = makeHtml(bodyHtml);
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  // Should extract something reasonable, not the raw price text
  for (const p of result.products) {
    assert.ok(
      !p.name.includes("60,000") || p.name.includes("YouTube") || p.name.includes("Netflix") || p.name.includes("개월"),
      `Fallback name contains raw price: "${p.name}"`
    );
    assert.ok(
      p.name.length < 40,
      `Fallback name too long: "${p.name}"`
    );
  }
});
