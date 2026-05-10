/**
 * Full extraction pipeline test on ALL stored HTML files.
 * Processes every unique .html file across all test directories,
 * runs the hybrid extraction pipeline, and reports quality metrics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { cleanProductName, deduplicateProducts } from "../lib/competitor-ad-parser/product-name-utils.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import type { EvidenceSource, AdProduct } from "../lib/competitor-intel/types.js";

const CONSOLIDATED_DIR =
  "/parent/marketing-automation/artifacts/competitor-ads/test-pipeline-1page-v2/raw_html";

function productsLookJunk(products: Array<{ name: string; price_krw?: number }>): boolean {
  if (products.length === 0) return false;
  return products.filter((p) => {
    if (p.name === "OTT 구독" || p.name === "구독") return true;
    if (p.name.length <= 3 && /^\d+$/.test(p.name)) return true;
    if (/변경|가능|문의|상담|해지|가입|완료/.test(p.name)) return true;
    // Field labels that got paired with nearby prices (not actual product names)
    if (/가[\s]?격|이용\s?기간|기\s?간|할인|쿠폰/.test(p.name)) return true;
    if (p.price_krw === undefined && p.name.length < 15) return true;
    return false;
  }).length > products.length * 0.5;
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

function extractLeafTextBlocks($: cheerio.CheerioAPI, selector: string): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  $(selector).find("p, div, span, td, th, li, b, strong, em, h1, h2, h3").each((_i, el) => {
    if ($(el).children().length === 0) {
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160);
      if (text.length >= 2) {
        sources.push({ type: "html", excerpt: text, source_block: el.tagName || "unknown" });
      }
    }
  });
  return sources;
}

async function extractFromFile(htmlPath: string, fileId: string): Promise<{
  vendor: string;
  postTitle: string;
  postedAt: string;
  extractionSource: string;
  products: AdProduct[];
  productsCount: number;
  hasPrice: boolean;
  hasDuration: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const html = fs.readFileSync(htmlPath, "utf-8");
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`);

  // High-confidence Cheerio parse — skip LLM
  if (parsed.confidence >= 0.9 && parsed.products.length > 0) {
    const products = deduplicateProducts(
      parsed.products.map((p) => ({ ...p, name: cleanProductName(p.name) }))
    ).filter((p) => p.name.length > 0);
    return {
      vendor: parsed.vendor || "(unknown)",
      postTitle: parsed.title || "(untitled)",
      postedAt: parsed.posted_at || "",
      extractionSource: "html",
      products,
      productsCount: products.length,
      hasPrice: products.some((p) => p.price_krw != null),
      hasDuration: products.some((p) => p.duration_months != null),
      errors,
    };
  }

  // LLM text extraction path
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
  const htmlEvidence = extractLeafTextBlocks($, sel);
  const { products: htmlProducts } = extractProductsFromText(htmlEvidence);
  const htmlJunk = productsLookJunk(htmlProducts);

  // Quality score: fraction of products that have BOTH price AND duration
  function completenessScore(prods: Array<{ price_krw?: number; duration_months?: number }>): number {
    if (prods.length === 0) return 0;
    const complete = prods.filter((p) => p.price_krw !== undefined && p.duration_months !== undefined).length;
    return complete / prods.length;
  }

  const htmlComplete = completenessScore(htmlProducts);
  const llmComplete = completenessScore(llmProducts);
  const llmQualityWins = llmProducts.length > 0 && llmComplete >= 0.9 && htmlComplete < 0.7 && llmProducts.length >= htmlProducts.length * 0.5;
  // Priority logic (same as request-handler.ts)
  const llmWins = llmProducts.length > 0 && (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);
  const useHtml = htmlProducts.length > 0 && !htmlJunk;
  const finalProducts = llmWins ? llmProducts : (useHtml ? htmlProducts : parsed.products);
  const extractionSource = llmWins ? "llm-text" : (useHtml ? "html" : "cheerio");

  // Final clean + dedup
  const cleanedProducts = deduplicateProducts(
    finalProducts.map((p) => ({ ...p, name: cleanProductName(p.name) }))
  ).filter((p) => p.name.length > 0);

  // Quality checks
  const shortNames = cleanedProducts.filter((p) => p.name.length <= 2);
  if (shortNames.length > 0) errors.push(`${shortNames.length} short names: ${shortNames.map((p) => `"${p.name}"`).join(", ")}`);
  const noPrice = cleanedProducts.filter((p) => p.price_krw == null);
  if (noPrice.length > 0) errors.push(`${noPrice.length} products missing price`);
  const noDuration = cleanedProducts.filter((p) => p.duration_months == null);
  if (noDuration.length > 0) errors.push(`${noDuration.length} products missing duration`);
  if (cleanedProducts.length === 0) errors.push("no products extracted");

  return {
    vendor: parsed.vendor || "(unknown)",
    postTitle: parsed.title || "(untitled)",
    postedAt: parsed.posted_at || "",
    extractionSource,
    products: cleanedProducts,
    productsCount: cleanedProducts.length,
    hasPrice: cleanedProducts.some((p) => p.price_krw != null),
    hasDuration: cleanedProducts.some((p) => p.duration_months != null),
    errors,
  };
}

// ── Main ──

// Collect all HTML files from the consolidated directory
const fileSet = new Map<string, string>(); // fileId → htmlPath
if (fs.existsSync(CONSOLIDATED_DIR)) {
  for (const file of fs.readdirSync(CONSOLIDATED_DIR)) {
    if (!file.endsWith(".html")) continue;
    const fileId = file.replace(".html", "");
    if (!fileSet.has(fileId)) {
      fileSet.set(fileId, path.join(CONSOLIDATED_DIR, file));
    }
  }
}

const files = [...fileSet.entries()];
console.log(`Found ${files.length} unique HTML files in consolidated directory`);
console.log("=".repeat(80));

let processed = 0;
let totalProducts = 0;
let totalErrors = 0;
let sourceCounts: Record<string, number> = {};
const results: Array<{
  fileId: string;
  vendor: string;
  title: string;
  products: number;
  source: string;
  errors: string[];
}> = [];

for (const [fileId, htmlPath] of files) {
  processed++;
  try {
    const r = await extractFromFile(htmlPath, fileId);
    totalProducts += r.productsCount;
    if (r.errors.length > 0) totalErrors += r.errors.length;
    sourceCounts[r.extractionSource] = (sourceCounts[r.extractionSource] || 0) + 1;

    const status = r.errors.length > 0 ? ` ⚠` : " ✓";
    console.log(`[${processed}/${files.length}] ${fileId}  ${r.vendor.padEnd(15)}  ${String(r.productsCount).padStart(2)} products  via ${r.extractionSource.padEnd(8)}${status}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) console.log(`    ERROR: ${e}`);
    }

    results.push({
      fileId,
      vendor: r.vendor,
      title: r.postTitle.slice(0, 60),
      products: r.productsCount,
      source: r.extractionSource,
      errors: r.errors,
    });
  } catch (err) {
    console.log(`[${processed}/${files.length}] ${fileId}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    totalErrors++;
  }
}

// ── Summary ──
console.log("");
console.log("=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));
console.log(`Files processed:     ${processed} / ${files.length}`);
console.log(`Total products:      ${totalProducts}`);
console.log(`Total quality errors: ${totalErrors}`);
console.log(`Success rate:        ${((results.filter((r) => r.errors.length === 0).length / Math.max(results.length, 1)) * 100).toFixed(1)}%`);
console.log("");
console.log("Extraction sources:");
for (const [src, cnt] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${src.padEnd(12)} ${cnt}`);
}

// ── Errors by vendor ──
const errorVendors = results.filter((r) => r.errors.length > 0);
if (errorVendors.length > 0) {
  console.log("");
  console.log("─".repeat(80));
  console.log("FILES WITH ISSUES:");
  for (const r of errorVendors) {
    console.log(`  ${r.fileId}  ${r.vendor}  (${r.products} products via ${r.source})`);
    for (const e of r.errors) console.log(`    ${e}`);
  }
}

// ── Product name quality ──
console.log("");
console.log("─".repeat(80));
console.log("PRODUCT NAME QUALITY:");
const allProducts = results.flatMap((r) => r);
const allNames = results.map((r) => r.fileId).flatMap((fileId) => {
  const r = results.find((x) => x.fileId === fileId);
  return r ? [] : [];
});

// Write detailed report to file
const reportPath = path.join("artifacts", "competitor-ads", "full-pipeline-test-report.txt");
const report = results.map((r) => `${r.fileId}\t${r.vendor}\t${r.products}\t${r.source}\t${r.errors.join("; ") || "OK"}`).join("\n");
fs.writeFileSync(reportPath, `File ID\tVendor\tProducts\tSource\tErrors\n${report}`, "utf-8");
console.log(`\nDetailed report written to: ${reportPath}`);
