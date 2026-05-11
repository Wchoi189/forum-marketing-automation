/**
 * Generate a formatted demo report using Ollama.
 * Sends structured extraction results to Ollama for formatting.
 */

import * as cheerio from "cheerio";
import * as fs from "node:fs";
import path from "node:path";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { cleanProductName, deduplicateProducts } from "../lib/competitor-ad-parser/product-name-utils.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import { callOllamaGenerate } from "../lib/competitor-intel/extraction/ocr.js";
import type { EvidenceSource, AdProduct } from "../lib/competitor-intel/types.js";

const HTML_DIR = "/parent/marketing-automation/artifacts/competitor-ads/live-20260511/raw_html";

const VENDORS = [
  "0b80b387d62a",
  "1ac7d06aaf06",
  "befa16e37fb3",
  "eb67ebba985c",
  "fca4be0ea775",
];

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
  for (const sel of ["div.JS_ContentMain td.board-contents", "td.board-contents", "div.JS_ContentMain"]) {
    if ($(sel).length > 0) {
      const t = $(sel).text().replace(/\s+/g, " ").trim();
      if (t.length > 50) return t;
    }
  }
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function runExtraction(fileId: string) {
  const html = fs.readFileSync(`${HTML_DIR}/${fileId}.html`, "utf-8");
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`);

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

  const $ = cheerio.load(html);
  const leafBlocks: EvidenceSource[] = [];
  $( "div.JS_ContentMain td.board-contents" ).find("p, div, span, td, th, li, b, strong").each((_i, el) => {
    if ($(el).children().length === 0) {
      const t = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160);
      if (t.length >= 2) leafBlocks.push({ type: "html", excerpt: t, source_block: el.tagName || "unknown" });
    }
  });
  const { products: htmlProducts } = extractProductsFromText(leafBlocks);
  const htmlJunk = productsLookJunk(htmlProducts);

  const completenessScore = (prods: Array<{ price_krw?: number; duration_months?: number }>): number =>
    prods.length === 0 ? 0 : prods.filter((p) => p.price_krw !== undefined && p.duration_months !== undefined).length / prods.length;
  const llmQualityWins = llmProducts.length > 0 && completenessScore(llmProducts) >= 0.9 && completenessScore(htmlProducts) < 0.7 && llmProducts.length >= htmlProducts.length * 0.5;
  const llmWins = llmProducts.length > 0 && (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);
  const useHtml = htmlProducts.length > 0 && !htmlJunk;
  const finalProducts = llmWins ? llmProducts : useHtml ? htmlProducts : parsed.products;
  const extractionSource = llmWins ? "llm-text" : useHtml ? "html" : "cheerio";

  const cleanedProducts = deduplicateProducts(
    finalProducts.map((p) => ({ ...p, name: cleanProductName(p.name) }))
  ).filter((p) => p.name.length > 0);

  return {
    fileId,
    vendor: parsed.vendor || "(unknown)",
    postTitle: parsed.title || "(untitled)",
    postedAt: parsed.posted_at || "",
    accountType: parsed.account_type || "—",
    extractionSource,
    products: cleanedProducts,
  };
}

// ── Collect all results first ──
console.log("Extracting products from 5 vendors...");
const results = [];
for (const fileId of VENDORS) {
  const r = await runExtraction(fileId);
  results.push(r);
  console.log(`  ${r.fileId}: ${r.products.length} products via ${r.extractionSource}`);
}

// ── Build JSON payload for Ollama ──
const payload = JSON.stringify(results.map((r) => ({
  fileId: r.fileId,
  vendor: r.vendor,
  title: r.postTitle,
  postedAt: r.postedAt,
  accountType: r.accountType,
  source: r.extractionSource,
  products: r.products.map((p) => ({
    name: p.name,
    price: p.price_krw ? `₩${p.price_krw.toLocaleString()}` : "—",
    duration: p.duration_months
      ? p.duration_months >= 12
        ? `${p.duration_months / 12}년`
        : `${p.duration_months}개월`
      : "—",
    pricePerMonth: p.price_per_month_krw
      ? `₩${p.price_per_month_krw.toLocaleString()}/mo`
      : p.price_krw && p.duration_months
        ? `₩${Math.round(p.price_krw / p.duration_months).toLocaleString()}/mo`
        : "—",
  })),
})), null, 2);

const reportPrompt = `You are a technical report formatter for a Korean competitor ad intelligence dashboard.

Format the following JSON extraction data into a clean, professional text report.

Rules:
- Use plain ASCII text only (no Unicode box-drawing characters)
- ALL ${results.length} vendor entries must be included — do not skip any
- Each vendor gets a section with: vendor name, post title, posted date, account type, extraction source, and a products table
- Products table columns: Product Name, Price, Duration, Per Month
- Align columns with spaces (not tabs), max 80 chars wide
- Use "=" for main title/dividers and "-" for sub-section lines
- Date formatted as YYYY-MM-DD
- End with a summary table showing ALL ${results.length} vendors

Data:
${payload}`;

console.log("\nAsking Ollama to format the report...");
const reportResult = await callOllamaGenerate(reportPrompt, undefined, "qwen3:4b-instruct", ["qwen3:1.7b"]);

// ── Write the report ──
const reportText = reportResult.text.trim();
const outputPath = path.join("artifacts", "competitor-ads", "extraction-demo-report.txt");
fs.writeFileSync(outputPath, reportText, "utf-8");

console.log(`\nReport written to: ${outputPath}`);
console.log("");
console.log(reportText);
