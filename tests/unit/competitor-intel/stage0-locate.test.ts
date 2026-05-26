import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { locateElements } from "../../../lib/competitor-intel/pipeline/stage0-locate/index.js";

const RAW_HTML = {
  TC01: "/parent/marketing-automation/artifacts/competitor-ads/live-20260511/raw_html/551b849c00f1.html",
  TC02: "/parent/marketing-automation/artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/0aea7978e7b3.html",
  TC03: "/parent/marketing-automation/artifacts/competitor-ads/test-pipeline-1page-v2/raw_html/eb67ebba985c.html",
};

// TC-0.1: Standard post (구독트리) — price patterns, reduction >= 0.6
test("TC-0.1 standard post: titleText non-empty, bodyText has prices, reductionRatio >= 0.6", async () => {
  const html = fs.readFileSync(RAW_HTML.TC01, "utf-8");
  const result = await locateElements(html, "https://ppomppu.co.kr/post/551b849c00f1");

  assert.ok(result.titleText.length > 0, "titleText must be non-empty");
  assert.ok(result.bodyText.length > 0, "bodyText must be non-empty");
  const pricePattern = /[\d,]+\s*원|₩\s*[\d,]+|\d{1,3}(?:,\d{3})+/;
  assert.ok(pricePattern.test(result.bodyText), "bodyText must contain price patterns");
  assert.ok(result.reductionRatio >= 0.6, `reductionRatio ${result.reductionRatio.toFixed(3)} must be >= 0.6`);
});

// TC-0.2: SharePlan noise post — reduction >= 0.95
test("TC-0.2 SharePlan noise post: titleText non-empty, bodyText non-empty, reductionRatio >= 0.95", async () => {
  const html = fs.readFileSync(RAW_HTML.TC02, "utf-8");
  const result = await locateElements(html, "https://ppomppu.co.kr/post/0aea7978e7b3");

  assert.ok(result.titleText.length > 0, "titleText must be non-empty");
  assert.ok(result.bodyText.length > 0, "bodyText must be non-empty");
  assert.ok(
    result.reductionRatio >= 0.95,
    `reductionRatio ${result.reductionRatio.toFixed(3)} must be >= 0.95`,
  );
});

// TC-0.3: Implicit name post (기프티콩~) — title has 유튜브 프리미엄
test("TC-0.3 implicit name post: titleText contains 유튜브 프리미엄", async () => {
  const html = fs.readFileSync(RAW_HTML.TC03, "utf-8");
  const result = await locateElements(html, "https://ppomppu.co.kr/post/eb67ebba985c");

  assert.ok(result.titleText.length > 0, "titleText must be non-empty");
  assert.ok(result.bodyText.length > 0, "bodyText must be non-empty");
  assert.ok(
    result.titleText.includes("유튜브 프리미엄") || result.titleText.includes("YouTube Premium") || result.titleText.toLowerCase().includes("youtube"),
    `titleText "${result.titleText}" must reference YouTube Premium`,
  );
});

// TC-0.4: Fallback — script-only body → trafilatura returns empty → Cheerio fallback
test("TC-0.4 trafilatura empty → Cheerio fallback used", async () => {
  const minimalHtml = `<html><head><meta property="og:title" content="Test Title"/></head><body><script>var d={}</script></body></html>`;

  const result = await locateElements(minimalHtml, "https://example.com/test");

  assert.ok(
    result.warnings?.includes("trafilatura_empty_fallback_used"),
    `warnings must include 'trafilatura_empty_fallback_used', got: ${JSON.stringify(result.warnings)}`,
  );
  assert.strictEqual(result.debugInfo?.tool, "cheerio", "debugInfo.tool must be 'cheerio'");
});

// Sanity: output shape always has required fields
test("Stage0Output always has required fields", async () => {
  const html = fs.readFileSync(RAW_HTML.TC01, "utf-8");
  const result = await locateElements(html, "https://ppomppu.co.kr/post/551b849c00f1");

  assert.ok(typeof result.titleText === "string");
  assert.ok(typeof result.bodyText === "string");
  assert.ok(typeof result.reductionRatio === "number");
  assert.ok(result.reductionRatio >= 0 && result.reductionRatio <= 1);
});
