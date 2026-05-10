/**
 * Re-extract HTML files through the fixed hybrid pipeline and update SQLite DB.
 * Reads all HTML files from the test directory, runs Cheerio → Ollama extraction,
 * and writes clean products_full_json records to the database.
 */

import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { cleanProductName, deduplicateProducts } from "../lib/competitor-ad-parser/product-name-utils.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import { extractContentTextForLlm, productsLookJunk, extractLeafTextBlocks, computeCompletenessScore } from "../lib/competitor-intel/extraction/content-utils.js";
import { openDatabase, insertRecord, upsertVendorProfile } from "../lib/competitor-ad-sqlite.js";
import type { AdProduct } from "../lib/competitor-intel/types.js";

const HTML_DIR =
  "/parent/marketing-automation/artifacts/competitor-ads/test-pipeline-1page-v2/raw_html";

const INCREMENTAL = process.argv.includes("--incremental");

type ExtractResult = {
  vendor: string;
  postTitle: string;
  postedAt: string;
  accountType: string | null;
  confidence: number;
  extractionSource: string;
  products: AdProduct[];
  contentHash: string;
};

async function extractFromFile(
  htmlPath: string,
  fileId: string,
  contentHashCache: Map<string, ExtractResult | null>,
): Promise<ExtractResult | null> {
  const html = fs.readFileSync(htmlPath, "utf-8");
  const contentHash = createHash("md5").update(html).digest("hex");

  if (contentHashCache.has(contentHash)) {
    return contentHashCache.get(contentHash) ?? null;
  }
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`);

  // High-confidence Cheerio parse — skip LLM
  if (parsed.confidence >= 0.9 && parsed.products.length > 0) {
    const result: ExtractResult = {
      vendor: parsed.vendor || "(unknown)",
      postTitle: parsed.title || "(untitled)",
      postedAt: parsed.posted_at || "",
      accountType: parsed.account_type || null,
      confidence: parsed.confidence,
      extractionSource: "html",
      products: parsed.products,
      contentHash,
    };
    contentHashCache.set(contentHash, result);
    return result;
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
  const llmQualityWins = llmProducts.length > 0 && computeCompletenessScore(llmProducts) >= 0.9 && computeCompletenessScore(htmlProducts) < 0.7 && llmProducts.length >= htmlProducts.length * 0.5;
  // Priority logic (same as request-handler.ts)
  const llmWins = llmProducts.length > 0 && (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);
  const useHtml = htmlProducts.length > 0 && !htmlJunk;
  const finalProducts = llmWins ? llmProducts : (useHtml ? htmlProducts : parsed.products);
  const extractionSource = llmWins ? "llm-text" : (useHtml ? "html" : "cheerio");

  // Final clean + dedup
  const cleanedProducts = deduplicateProducts(
    finalProducts.map((p) => ({ ...p, name: cleanProductName(p.name) }))
  ).filter((p) => p.name.length > 0);

  const result: ExtractResult = {
    vendor: parsed.vendor || "(unknown)",
    postTitle: parsed.title || "(untitled)",
    postedAt: parsed.posted_at || "",
    accountType: parsed.account_type || null,
    confidence: extractionSource === "llm-text" ? 0.8 : extractionSource === "html" ? 0.7 : parsed.confidence,
    extractionSource,
    products: cleanedProducts,
    contentHash,
  };

  contentHashCache.set(contentHash, result);
  return result;
}

// ── Main ──
const db = openDatabase();

if (INCREMENTAL) {
  console.log("Running in incremental mode — only processing new/changed files");
} else {
  // Clear old data — the old extraction produced junk, we want clean slate
  console.log("Clearing old records from database...");
  const oldCount = db.prepare("SELECT COUNT(*) as c FROM records").get() as { c: number };
  console.log(`  Removing ${oldCount.c} old records`);
  db.exec("DELETE FROM records");
  db.exec("DELETE FROM vendor_profiles");
}

const htmlFiles = fs.readdirSync(HTML_DIR).filter((f) => f.endsWith(".html"));
console.log(`\nProcessing ${htmlFiles.length} HTML files through hybrid extraction pipeline...`);

const runId = `re-extract-${new Date().toISOString().slice(0, 10)}`;
const contentHashCache = new Map<string, ExtractResult | null>();
let cacheHits = 0;

for (const file of htmlFiles) {
  const fileId = file.replace(".html", "");
  const htmlPath = `${HTML_DIR}/${file}`;

  // Incremental mode: skip if record exists with matching content hash
  if (INCREMENTAL) {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const contentHash = createHash("md5").update(html).digest("hex");
    const existing = db.prepare("SELECT content_hash FROM records WHERE record_id = ?").get(fileId) as { content_hash?: string } | undefined;
    if (existing && existing.content_hash === contentHash) {
      console.log(`  SKIP ${fileId}: already in DB with matching content hash`);
      continue;
    }
  }

  try {
    const result = await extractFromFile(htmlPath, fileId, contentHashCache);

    if (!result || result.products.length === 0) {
      console.log(`  SKIP ${fileId}: no products extracted${result ? ` via ${result.extractionSource}` : ""}`);
      if (!result) cacheHits++;
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
      content_hash: result.contentHash,
    });

    // Rebuild vendor profile from the record
    upsertVendorProfile(db, result.vendor, {
      author_name: result.vendor || undefined,
      post_url: `https://www.ppomppu.co.kr/zboard/view.php?id=${fileId}`,
      posted_at: result.postedAt || undefined,
      product_names: result.products.map((p) => p.name),
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

if (cacheHits > 0) {
  console.log(`\n  (skipped ${cacheHits} content-identical files via cache)`);
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
