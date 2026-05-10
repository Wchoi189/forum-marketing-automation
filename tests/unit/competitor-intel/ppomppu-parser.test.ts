import test from "node:test";
import assert from "node:assert/strict";
import { parsePpomppuPost } from "../../../lib/competitor-ad-parser/ppomppu-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHtml(overrides: {
  title?: string;
  vendor?: string;
  date?: string;
  bodyHtml?: string;
  imageSrcs?: string[];
} = {}): string {
  const {
    title = "OTT 구독 공유",
    vendor = "SharePlan",
    date = "2026-01-15 14:30:00",
    bodyHtml = "",
    imageSrcs = [],
  } = overrides;

  const images = imageSrcs.map((src) => `<img class="clickWide" src="${src}">`).join("");

  return `
    <html>
      <head><meta property="og:title" content="${title}"></head>
      <body>
        <div id="topTitle"><h1>${title}</h1></div>
        <li class="topTitle-name">${vendor}</li>
        <ul class="topTitle-mainbox"><li>등록일 ${date}</li></ul>
        <li class="topTitle-link"><a href="https://ppomppu.co.kr/redirector.php?target=${Buffer.from("https://example.com/landing").toString("base64")}">링크</a></li>
        <div class="JS_ContentMain">
          <td class="board-contents">
            ${bodyHtml}
            ${images}
          </td>
        </div>
      </body>
    </html>
  `;
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

test("parsePpomppuPost: extracts title from h1", () => {
  const html = makeHtml({ title: "넷플릭스 가족共享" });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.title, "넷플릭스 가족共享");
});

test("parsePpomppuPost: falls back to og:title when h1 empty", () => {
  const html = makeHtml({ title: "" });
  // og:title will be empty too, so title should be empty
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.title, "");
  assert.ok(result.warnings.includes("Missing title"));
});

// ---------------------------------------------------------------------------
// Vendor extraction
// ---------------------------------------------------------------------------

test("parsePpomppuPost: extracts vendor name", () => {
  const html = makeHtml({ vendor: "SharePlan_Admin" });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.ok(result.vendor.includes("SharePlan"));
});

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

test("parsePpomppuPost: parses Korean date format", () => {
  const html = makeHtml({ date: "2026-01-15 14:30:00" });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.ok(result.posted_at.startsWith("2026-01-15"));
  assert.ok(result.posted_at_raw.includes("2026"));
});

test("parsePpomppuPost: missing date → empty strings", () => {
  const html = makeHtml({ date: "" });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.posted_at, "");
  assert.equal(result.posted_at_raw, "");
  assert.ok(result.warnings.includes("Missing posted date"));
});

// ---------------------------------------------------------------------------
// Landing URL extraction
// ---------------------------------------------------------------------------

test("parsePpomppuPost: decodes base64 landing URL", () => {
  const html = makeHtml();
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.landing_url, "https://example.com/landing");
});

// ---------------------------------------------------------------------------
// Product extraction
// ---------------------------------------------------------------------------

test("parsePpomppuPost: extracts products with price and duration", () => {
  const bodyHtml = `
    <p>유튜브 프리미엄</p>
    <p>3개월 15,000원 (기존 계정에 적용 가능)</p>
    <p>넷플릭스</p>
    <p>1개월 8,000원</p>
  `;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  assert.ok(result.products.length >= 2, `Expected >= 2 products, got ${result.products.length}`);
  const yt = result.products.find((p) => p.name.includes("YouTube") || p.name.includes("유튜브"));
  assert.ok(yt !== undefined);
  assert.equal(yt?.price_krw, 15000);
  assert.equal(yt?.duration_months, 3);
});

test("parsePpomppuPost: calculates price_per_month_krw", () => {
  const bodyHtml = `
    <p>넷플릭스</p>
    <p>3개월 45,000원</p>
  `;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  const netflix = result.products.find((p) => p.name.includes("Netflix") || p.name.includes("넷플릭스"));
  assert.ok(netflix !== undefined);
  assert.equal(netflix?.price_per_month_krw, 15000);
});

test("parsePpomppuPost: marks '판매 중단' products", () => {
  const bodyHtml = `
    <p>웨이브</p>
    <p>판매중단</p>
  `;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");

  const stopped = result.products.find((p) => p.constraints === "판매 중단");
  // "판매중단" without a price gets recorded as a product with "판매 중단" constraint
  // Name falls back to currentProductName or default
  assert.ok(stopped !== undefined, `Expected a '판매 중단' product, got: ${JSON.stringify(result.products)}`);
});

// ---------------------------------------------------------------------------
// Account type classification
// ---------------------------------------------------------------------------

test("parsePpomppuPost: detects direct_login account type", () => {
  const bodyHtml = `<p>직접 로그인 가능</p>`;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.account_type, "direct_login");
});

test("parsePpomppuPost: detects family_share account type", () => {
  const bodyHtml = `<p>가족 공유 초대 가능</p>`;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.account_type, "family_share");
});

test("parsePpomppuPost: detects group_invite account type", () => {
  const bodyHtml = `<p>파티 초대 환영</p>`;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.account_type, "group_invite");
});

// ---------------------------------------------------------------------------
// Trust signals
// ---------------------------------------------------------------------------

test("parsePpomppuPost: extracts trust signals", () => {
  const bodyHtml = `<p>누적후기 5,000+ 개, 복구 200 개 진행</p>`;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.ok(result.trust_signals.length > 0, "Expected trust signals");
});

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

test("parsePpomppuPost: extracts image URLs from content", () => {
  const html = makeHtml({
    imageSrcs: [
      "https://ppomppu.co.kr/zboard/data/file/123/img1.jpg",
      "https://ppomppu.co.kr/zboard/data/file/123/img2.png",
    ],
  });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.equal(result.image_urls.length, 2);
  assert.ok(result.image_urls[0].includes("img1.jpg"));
});

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

test("parsePpomppuPost: full record → high confidence", () => {
  const bodyHtml = `<p>유튜브 프리미엄</p><p>3개월 15,000원</p>`;
  const html = makeHtml({ bodyHtml });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.ok(result.confidence >= 0.75, `Expected high confidence, got ${result.confidence}`);
});

test("parsePpomppuPost: minimal record → lower confidence", () => {
  const html = makeHtml({
    title: "",
    vendor: "",
    date: "",
    bodyHtml: "",
  });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.ok(result.confidence < 0.5, `Expected low confidence, got ${result.confidence}`);
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

test("parsePpomppuPost: generates warnings for missing fields", () => {
  const html = makeHtml({ title: "", vendor: "", date: "" });
  const result = parsePpomppuPost(html, "https://ppomppu.co.kr/test");
  assert.ok(result.warnings.includes("Missing title"));
  assert.ok(result.warnings.includes("Missing vendor"));
  assert.ok(result.warnings.includes("Missing posted date"));
});
