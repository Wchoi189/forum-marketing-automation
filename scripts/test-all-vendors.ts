/**
 * Verify all 5 test vendors through the extraction pipeline.
 * Uses saved HTML files — no live crawling.
 * Ollama LLM text extraction is tested if available; otherwise skipped.
 */

import * as fs from "node:fs";
import * as cheerio from "cheerio";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import { extractContentTextForLlm, productsLookJunk, extractLeafTextBlocks, computeCompletenessScore } from "../lib/competitor-intel/extraction/content-utils.js";
import type { AdProduct } from "../lib/competitor-intel/types.js";

const HTML_DIR =
  "/parent/marketing-automation/artifacts/competitor-ads/test-pipeline-1page-v2/raw_html";

type VendorExpectation = {
  fileId: string;
  vendorName: string;
  expectedFromCheerio: number; // min products from Cheerio parser (may be 0 for complex ads)
  expectedFromLlm: number; // min products from LLM text extraction
  expectedProducts: string[]; // substrings that should appear in product names
};

const VENDORS: VendorExpectation[] = [
  { fileId: "0b80b387d62a", vendorName: "구독플레이스", expectedFromCheerio: 0, expectedFromLlm: 1, expectedProducts: ["Netflix"] },
  { fileId: "1ac7d06aaf06", vendorName: "기프티콩", expectedFromCheerio: 3, expectedFromLlm: 0, expectedProducts: ["YouTube", "Netflix"] },
  { fileId: "befa16e37fb3", vendorName: "다시봄을", expectedFromCheerio: 1, expectedFromLlm: 0, expectedProducts: ["YouTube"] },
  { fileId: "eb67ebba985c", vendorName: "DENMARK", expectedFromCheerio: 0, expectedFromLlm: 2, expectedProducts: ["YouTube Premium"] },
  { fileId: "fca4be0ea775", vendorName: "DENMARK", expectedFromCheerio: 0, expectedFromLlm: 1, expectedProducts: ["YouTube Premium"] },
];

async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch("http://ollama:11434/api/tags");
    return res.ok;
  } catch {
    return false;
  }
}

async function testVendor(v: VendorExpectation, ollamaAvailable: boolean): Promise<{ passed: boolean; details: string }> {
  const htmlPath = `${HTML_DIR}/${v.fileId}.html`;
  if (!fs.existsSync(htmlPath)) {
    return { passed: false, details: `HTML file not found: ${htmlPath}` };
  }

  const html = fs.readFileSync(htmlPath, "utf-8");
  const results: string[] = [];
  results.push(`\n=== ${v.vendorName} (${v.fileId}) ===`);

  // ── Path 1: Cheerio parser ──
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${v.fileId}`);
  results.push(`Cheerio parser: confidence=${parsed.confidence.toFixed(2)}, products=${parsed.products.length}`);
  if (parsed.products.length > 0) {
    for (const p of parsed.products) {
      results.push(`  - ${p.name} | ₩${p.price_krw ?? "?"} | ${p.duration_months ?? "?"}mo`);
    }
  }

  // ── Path 2: HTML text blocks (simulated subtree) ──
  const $ = cheerio.load(html);
  const contentSelectors = ["div.JS_ContentMain td.board-contents", "td.board-contents", "div.JS_ContentMain"];
  let matchedSelector = "";
  for (const sel of contentSelectors) {
    if ($(sel).length > 0 && $(sel).text().trim().length > 50) {
      matchedSelector = sel;
      break;
    }
  }
  if (!matchedSelector) matchedSelector = "body";

  const htmlEvidence = extractLeafTextBlocks($, matchedSelector);
  const { products: htmlProducts } = extractProductsFromText(htmlEvidence);
  const htmlJunk = productsLookJunk(htmlProducts);
  results.push(`HTML text blocks: ${htmlEvidence.length} snippets, products=${htmlProducts.length}, junk=${htmlJunk}`);

  // ── Path 3: LLM text extraction (if available) ──
  let llmProducts: AdProduct[] = [];
  if (ollamaAvailable) {
    const contentText = extractContentTextForLlm(html);
    const textResult = await runTextExtraction(contentText, parsed.title);
    if (textResult && textResult.products.length > 0) {
      llmProducts = textResult.products.map((p) => {
        const product: AdProduct = { name: p.name };
        if (p.duration_months) product.duration_months = p.duration_months;
        if (p.price_krw) product.price_krw = p.price_krw;
        return product;
      });
    }
    results.push(`LLM text extraction: ${llmProducts.length} products`);
    if (llmProducts.length > 0) {
      for (const p of llmProducts) {
        results.push(`  - ${p.name} | ₩${p.price_krw ?? "?"} | ${p.duration_months ?? "?"}mo`);
      }
    }
  } else {
    results.push(`LLM text extraction: SKIPPED (Ollama not available)`);
  }

  // ── Combined result (request-handler priority logic) ──
  const htmlProductsLookBad = productsLookJunk(htmlProducts);
  const llmQualityWins = llmProducts.length > 0 && computeCompletenessScore(llmProducts) >= 0.9 && computeCompletenessScore(htmlProducts) < 0.7 && llmProducts.length >= htmlProducts.length * 0.5;
  const llmWins = llmProducts.length > 0 && (htmlProducts.length === 0 || htmlProductsLookBad || llmProducts.length >= htmlProducts.length || llmQualityWins);
  const useHtml = htmlProducts.length > 0 && !htmlProductsLookBad;
  const finalProducts = llmWins ? llmProducts : (useHtml ? htmlProducts : parsed.products);
  const extractionSource = llmWins ? "llm-text" : (useHtml ? "html" : "cheerio");
  results.push(`Final: ${finalProducts.length} products via ${extractionSource}`);
  if (finalProducts.length > 0) {
    for (const p of finalProducts) {
      results.push(`  - ${p.name} | ₩${p.price_krw ?? "?"} | ${p.duration_months ?? "?"}mo`);
    }
  }

  // ── Assertions ──
  let pass = true;
  if (ollamaAvailable) {
    // Full verification with LLM
    if (finalProducts.length < Math.max(v.expectedFromCheerio, v.expectedFromLlm)) {
      results.push(`FAIL: expected >= ${Math.max(v.expectedFromCheerio, v.expectedFromLlm)} products, got ${finalProducts.length}`);
      pass = false;
    }
  } else {
    // Partial verification: Cheerio parser must meet its target
    if (parsed.products.length < v.expectedFromCheerio) {
      results.push(`FAIL: Cheerio expected >= ${v.expectedFromCheerio} products, got ${parsed.products.length}`);
      pass = false;
    }
    if (v.expectedFromLlm > 0) {
      results.push(`NOTE: ${v.vendorName} needs LLM for full verification (${v.expectedFromLlm} products expected)`);
    }
  }

  for (const expected of v.expectedProducts) {
    const found = finalProducts.some((p) => p.name.toLowerCase().includes(expected.toLowerCase()));
    if (!found && ollamaAvailable) {
      results.push(`FAIL: missing expected product containing "${expected}"`);
      pass = false;
    } else if (!found && !ollamaAvailable && v.expectedFromLlm === 0) {
      results.push(`FAIL: missing expected product containing "${expected}"`);
      pass = false;
    }
  }

  if (pass) {
    results.push(ollamaAvailable ? `PASS: ${v.vendorName}` : `PASS (partial): ${v.vendorName}`);
  }

  return { passed: pass, details: results.join("\n") };
}

// ── Main ──
console.log("Competitor Ad Extraction — 5 Vendor Verification");
console.log("=".repeat(60));

const ollamaAvailable = await checkOllamaAvailable();
console.log(`Ollama available: ${ollamaAvailable}`);

let allPassed = true;
for (const v of VENDORS) {
  const result = await testVendor(v, ollamaAvailable);
  console.log(result.details);
  console.log("");
  if (!result.passed) allPassed = false;
}

console.log("=".repeat(60));
console.log(ollamaAvailable
  ? (allPassed ? "ALL VENDORS PASSED" : "SOME VENDORS FAILED")
  : (allPassed ? "ALL VENDORS PASSED (partial — no LLM)" : "SOME VENDORS FAILED"));
process.exit(allPassed ? 0 : 1);
