/**
 * Demo: full extraction pipeline on saved HTML files.
 * Shows the final structured output as it would appear in the UI.
 */

import * as cheerio from "cheerio";
import * as fs from "node:fs";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { cleanProductName, deduplicateProducts } from "../lib/competitor-ad-parser/product-name-utils.js";
import { extractProductsFromText, findPostedAt } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import type { EvidenceSource, AdProduct, CompetitorAdRecord } from "../lib/competitor-intel/types.js";

const HTML_DIR = "/parent/marketing-automation/artifacts/competitor-ads/test-cleanup-retry-20260511/raw_html";

const VENDORS = [
  "0b80b387d62a",
  "1ac7d06aaf06",
  "befa16e37fb3",
  "eb67ebba985c",
  "fca4be0ea775",
];

function productsLookJunk(products: Array<{ name: string; price_krw?: number }>): boolean {
  if (products.length === 0) return false;
  const junkSignals = products.filter((p) => {
    if (p.name === "OTT 구독" || p.name === "구독") return true;
    if (p.name.length <= 3 && /^\d+$/.test(p.name)) return true;
    if (/변경|가능|문의|상담|해지|가입|완료/.test(p.name)) return true;
    // Field labels that got paired with nearby prices (not actual product names)
    if (/가[\s]?격|이용\s?기간|기\s?간|할인|쿠폰/.test(p.name)) return true;
    if (p.price_krw === undefined && p.name.length < 15) return true;
    return false;
  });
  return junkSignals.length > products.length * 0.5;
}

function extractContentTextForLlm(html: string): string {
  const $ = cheerio.load(html);
  const selectors = [
    "div.JS_ContentMain td.board-contents",
    "td.board-contents",
    "div.JS_ContentMain",
    "#bbsview",
    "#bbsContents",
    "#view",
    "#viewContent",
    "article",
  ];
  for (const selector of selectors) {
    const el = $(selector);
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 50) return text;
    }
  }
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function runExtraction(fileId: string): Promise<{
  vendor: string;
  postTitle: string;
  postedAt: string;
  accountType: string | null;
  confidence: number;
  extractionSource: string;
  products: AdProduct[];
  productsCount: number;
}> {
  const html = fs.readFileSync(`${HTML_DIR}/${fileId}.html`, "utf-8");
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`);

  // Extract content text for LLM
  const contentText = extractContentTextForLlm(html);
  const textResult = await runTextExtraction(contentText, parsed.title);
  const llmProducts: AdProduct[] = textResult?.products
    ? textResult.products.map((p) => {
        const product: AdProduct = { name: p.name };
        if (p.duration_months) product.duration_months = p.duration_months;
        if (p.price_krw) product.price_krw = p.price_krw;
        return product;
      })
    : [];

  // HTML text blocks (fallback)
  const $ = cheerio.load(html);
  const sel = "div.JS_ContentMain td.board-contents";
  const leafBlocks: EvidenceSource[] = [];
  $(sel).find("p, div, span, td, th, li, b, strong, em, h1, h2, h3").each((_i, el) => {
    if ($(el).children().length === 0) {
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160);
      if (text.length >= 2) {
        leafBlocks.push({ type: "html", excerpt: text, source_block: el.tagName || "unknown" });
      }
    }
  });
  const { products: htmlProducts } = extractProductsFromText(leafBlocks);
  const htmlJunk = productsLookJunk(htmlProducts);

  // Quality score: fraction of products that have BOTH price AND duration
  const completenessScore = (prods: Array<{ price_krw?: number; duration_months?: number }>): number =>
    prods.length === 0 ? 0 : prods.filter((p) => p.price_krw !== undefined && p.duration_months !== undefined).length / prods.length;
  const llmQualityWins = llmProducts.length > 0 && completenessScore(llmProducts) >= 0.9 && completenessScore(htmlProducts) < 0.7 && llmProducts.length >= htmlProducts.length * 0.5;
  // Apply priority logic
  const llmWins = llmProducts.length > 0 && (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);
  const useHtml = htmlProducts.length > 0 && !htmlJunk;
  const finalProducts = llmWins
    ? llmProducts
    : useHtml
      ? htmlProducts
      : parsed.products;
  const extractionSource = llmWins ? "llm-text" : useHtml ? "html" : "cheerio";

  // Final clean + dedup
  const cleanedProducts = deduplicateProducts(
    finalProducts.map((p) => ({ ...p, name: cleanProductName(p.name) }))
  ).filter((p) => p.name.length > 0);

  return {
    vendor: parsed.vendor || "(unknown)",
    postTitle: parsed.title || "(untitled)",
    postedAt: parsed.posted_at || "",
    accountType: parsed.account_type,
    confidence: extractionSource === "llm-text" ? 0.8 : extractionSource === "html" ? 0.7 : parsed.confidence,
    extractionSource,
    products: cleanedProducts,
    productsCount: cleanedProducts.length,
  };
}

function formatPrice(price?: number): string {
  if (price === undefined) return "—";
  return `₩${price.toLocaleString()}`;
}

function formatDuration(months?: number): string {
  if (months === undefined) return "—";
  if (months >= 12) return `${months / 12}년`;
  return `${months}개월`;
}

function formatPricePerMonth(pricePerMonth?: number, price?: number, duration?: number): string {
  if (pricePerMonth !== undefined) return `₩${pricePerMonth.toLocaleString()}/mo`;
  if (price !== undefined && duration !== undefined) return `₩${Math.round(price / duration).toLocaleString()}/mo`;
  return "—";
}

// ── Main ──
console.log("=".repeat(80));
console.log("COMPETITOR AD INTELLIGENCE — Extraction Demo");
console.log("=".repeat(80));

for (const fileId of VENDORS) {
  const result = await runExtraction(fileId);

  console.log("");
  console.log("─".repeat(80));
  console.log(`FILE: ${fileId}.html`);
  console.log("─".repeat(80));
  console.log(`Vendor:         ${result.vendor}`);
  console.log(`Title:          ${result.postTitle}`);
  console.log(`Posted:         ${result.postedAt ? new Date(result.postedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "—"}`);
  console.log(`Account Type:   ${result.accountType || "—"}`);
  console.log(`Source:         ${result.extractionSource}`);
  console.log(`Confidence:     ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`Products:       ${result.productsCount}`);
  console.log("");

  if (result.products.length > 0) {
    // Table header
    console.log("  " + "Product Name".padEnd(30) + "Price".padEnd(14) + "Duration".padEnd(12) + "Per Month");
    console.log("  " + "─".repeat(30) + "  " + "─".repeat(12) + "  " + "─".repeat(10) + "  " + "─".repeat(12));

    for (const p of result.products) {
      const name = p.name.padEnd(30);
      const price = formatPrice(p.price_krw).padEnd(14);
      const duration = formatDuration(p.duration_months).padEnd(12);
      const perMonth = formatPricePerMonth(p.price_per_month_krw, p.price_krw, p.duration_months);
      console.log(`  ${name}${price}${duration}${perMonth}`);
    }
  } else {
    console.log("  (no products extracted)");
  }
}

console.log("");
console.log("=".repeat(80));
console.log("END OF DEMO");
console.log("=".repeat(80));
