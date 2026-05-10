/**
 * Re-extract HTML files through the fixed hybrid pipeline and update SQLite DB.
 * Reads all HTML files from the test directory, runs Cheerio → Ollama extraction,
 * and writes clean products_full_json records to the database.
 */

import * as fs from "node:fs";
import * as cheerio from "cheerio";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { cleanProductName, deduplicateProducts } from "../lib/competitor-ad-parser/product-name-utils.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import { openDatabase, insertRecord } from "../lib/competitor-ad-sqlite.js";
import type { EvidenceSource, AdProduct } from "../lib/competitor-intel/types.js";

const HTML_DIR =
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
  accountType: string | null;
  confidence: number;
  extractionSource: string;
  products: AdProduct[];
}> {
  const html = fs.readFileSync(htmlPath, "utf-8");
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`);

  // High-confidence Cheerio parse — skip LLM
  if (parsed.confidence >= 0.9 && parsed.products.length > 0) {
    return {
      vendor: parsed.vendor || "(unknown)",
      postTitle: parsed.title || "(untitled)",
      postedAt: parsed.posted_at || "",
      accountType: parsed.account_type || null,
      confidence: parsed.confidence,
      extractionSource: "html",
      products: parsed.products,
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
  const completenessScore = (prods: Array<{ price_krw?: number; duration_months?: number }>): number =>
    prods.length === 0 ? 0 : prods.filter((p) => p.price_krw !== undefined && p.duration_months !== undefined).length / prods.length;
  const llmQualityWins = llmProducts.length > 0 && completenessScore(llmProducts) >= 0.9 && completenessScore(htmlProducts) < 0.7 && llmProducts.length >= htmlProducts.length * 0.5;
  // Priority logic (same as request-handler.ts)
  const llmWins = llmProducts.length > 0 && (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);
  const useHtml = htmlProducts.length > 0 && !htmlJunk;
  const finalProducts = llmWins ? llmProducts : (useHtml ? htmlProducts : parsed.products);
  const extractionSource = llmWins ? "llm-text" : (useHtml ? "html" : "cheerio");

  // Final clean + dedup
  const cleanedProducts = deduplicateProducts(
    finalProducts.map((p) => ({ ...p, name: cleanProductName(p.name) }))
  ).filter((p) => p.name.length > 0);

  return {
    vendor: parsed.vendor || "(unknown)",
    postTitle: parsed.title || "(untitled)",
    postedAt: parsed.posted_at || "",
    accountType: parsed.account_type || null,
    confidence: extractionSource === "llm-text" ? 0.8 : extractionSource === "html" ? 0.7 : parsed.confidence,
    extractionSource,
    products: cleanedProducts,
  };
}

// ── Main ──
const db = openDatabase();

// Clear old data — the old extraction produced junk, we want clean slate
console.log("Clearing old records from database...");
const oldCount = db.prepare("SELECT COUNT(*) as c FROM records").get() as { c: number };
console.log(`  Removing ${oldCount.c} old records`);
db.exec("DELETE FROM records");
db.exec("DELETE FROM vendor_profiles");

const htmlFiles = fs.readdirSync(HTML_DIR).filter((f) => f.endsWith(".html"));
console.log(`\nProcessing ${htmlFiles.length} HTML files through hybrid extraction pipeline...`);

const runId = `re-extract-${new Date().toISOString().slice(0, 10)}`;

for (const file of htmlFiles) {
  const fileId = file.replace(".html", "");
  const htmlPath = `${HTML_DIR}/${file}`;

  try {
    const result = await extractFromFile(htmlPath, fileId);

    if (result.products.length === 0) {
      console.log(`  SKIP ${fileId}: no products extracted via ${result.extractionSource}`);
      continue;
    }

    // Write to SQLite
    insertRecord(db, {
      record_id: fileId,
      run_id: runId,
      vendor: result.vendor,
      post_url: `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`,
      post_title: result.postTitle,
      posted_at: result.postedAt || undefined,
      captured_at: new Date().toISOString(),
      products: result.products,
      productsFull: result.products,
      extraction_source: result.extractionSource,
      account_type: result.accountType || undefined,
      confidence: result.confidence,
    });

    console.log(`  OK ${fileId}: ${result.vendor} — ${result.products.length} products via ${result.extractionSource}`);
    for (const p of result.products) {
      const price = p.price_krw ? `₩${p.price_krw.toLocaleString()}` : "—";
      const dur = p.duration_months ? `${p.duration_months}mo` : "—";
      console.log(`    ${p.name} | ${price} | ${dur}`);
    }
  } catch (err) {
    console.log(`  FAIL ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const newCount = db.prepare("SELECT COUNT(*) as c FROM records").get() as { c: number };
const vendorCount = db.prepare("SELECT COUNT(DISTINCT vendor) as c FROM records").get() as { c: number };

console.log(`\nDatabase updated: ${newCount.c} records, ${vendorCount.c} vendors`);

// Verify price matrix output
console.log("\n=== Price Matrix Preview ===");
const rows = db.prepare(
  `SELECT vendor, products_full_json FROM records WHERE products_full_json IS NOT NULL AND products_full_json != '[]' ORDER BY vendor`
).all() as Array<{ vendor: string; products_full_json: string }>;

for (const row of rows) {
  const products: AdProduct[] = JSON.parse(row.products_full_json);
  console.log(`\n  ${row.vendor} (${products.length} products):`);
  for (const p of products) {
    const name = cleanProductName(p.name, 50);
    const price = p.price_krw ? `₩${p.price_krw.toLocaleString()}` : "—";
    const dur = p.duration_months ? `${p.duration_months}mo` : "—";
    const perMo = p.price_per_month_krw ? `₩${p.price_per_month_krw.toLocaleString()}/mo` : (p.price_krw && p.duration_months ? `₩${Math.round(p.price_krw / p.duration_months).toLocaleString()}/mo` : "—");
    console.log(`    ${name.padEnd(25)} ${price.padEnd(12)} ${dur.padEnd(8)} ${perMo}`);
  }
}

db.close();
