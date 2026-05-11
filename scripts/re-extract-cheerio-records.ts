/**
 * Force LLM re-extraction of Cheerio-only records (extraction_source='html').
 * Maps DB records to raw HTML via the post URL's `no` parameter,
 * runs hybrid pipeline, UPDATEs existing SQLite records.
 */
import * as fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { cleanProductName, deduplicateProducts } from "../lib/competitor-ad-parser/product-name-utils.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import { extractContentTextForLlm, productsLookJunk, extractLeafTextBlocks, computeCompletenessScore } from "../lib/competitor-intel/extraction/content-utils.js";
import { openDatabase } from "../lib/competitor-ad-sqlite.js";
import type { AdProduct } from "../lib/competitor-intel/types.js";

const RAW_HTML_DIRS = [
  "artifacts/competitor-ads/live-20260511/raw_html",
  "artifacts/competitor-ads/test-pipeline-1page-v2/raw_html",
];

/** Build index: post_number → HTML file path */
function buildHtmlIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const dir of RAW_HTML_DIRS) {
    const fullDir = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of fs.readdirSync(fullDir)) {
      if (!file.endsWith(".html")) continue;
      const html = fs.readFileSync(path.join(fullDir, file), "utf-8");
      const m = html.match(/no=(\d+)/);
      if (m) index.set(m[1], path.join(fullDir, file));
    }
  }
  return index;
}

function extractPostNo(url: string): string | null {
  const m = url.match(/no=(\d+)/);
  return m ? m[1] : null;
}

async function extractFromHtml(
  htmlPath: string,
  postUrl: string,
): Promise<{ products: AdProduct[]; extractionSource: string; confidence: number } | null> {
  const html = fs.readFileSync(htmlPath, "utf-8");
  const parsed = parsePpomppuPost(html, postUrl);

  // High-confidence Cheerio — keep as-is
  if (parsed.confidence >= 0.9 && parsed.products.length > 0) {
    return {
      products: parsed.products,
      extractionSource: "html",
      confidence: parsed.confidence,
    };
  }

  // LLM text extraction
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

  // HTML text blocks fallback
  const $ = cheerio.load(html);
  const sel = "div.JS_ContentMain td.board-contents";
  const htmlEvidence = extractLeafTextBlocks($, sel);
  const { products: htmlProducts } = extractProductsFromText(htmlEvidence);
  const htmlJunk = productsLookJunk(htmlProducts);

  const llmQualityWins =
    llmProducts.length > 0 &&
    computeCompletenessScore(llmProducts) >= 0.9 &&
    computeCompletenessScore(htmlProducts) < 0.7 &&
    llmProducts.length >= htmlProducts.length * 0.5;

  const llmWins =
    llmProducts.length > 0 &&
    (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);

  const useHtml = htmlProducts.length > 0 && !htmlJunk;
  const finalProducts = llmWins ? llmProducts : (useHtml ? htmlProducts : parsed.products);
  const extractionSource = llmWins ? "llm-text" : (useHtml ? "html" : "cheerio");

  const cleanedProducts = deduplicateProducts(
    finalProducts.map((p) => ({ ...p, name: cleanProductName(p.name) }))
  ).filter((p) => p.name.length > 0);

  return {
    products: cleanedProducts,
    extractionSource,
    confidence: extractionSource === "llm-text" ? 0.8 : extractionSource === "html" ? 0.7 : parsed.confidence,
  };
}

// ── Main ──
const db = openDatabase();

const corruptedRecords = db.prepare(
  "SELECT record_id, vendor, post_url, post_title FROM records WHERE extraction_source = 'html'"
).all() as Array<{ record_id: string; vendor: string; post_url: string; post_title: string }>;

console.log(`Found ${corruptedRecords.length} Cheerio-only records to re-extract.`);

const htmlIndex = buildHtmlIndex();
console.log(`HTML index: ${htmlIndex.size} files mapped.`);

let updated = 0;
let skipped = 0;
let errors = 0;

for (const rec of corruptedRecords) {
  const postNo = extractPostNo(rec.post_url);
  if (!postNo || !htmlIndex.has(postNo)) {
    console.log(`  MISSING ${rec.record_id} (${rec.vendor}) no=${postNo ?? "N/A"} — no raw HTML on disk`);
    skipped++;
    continue;
  }

  const htmlPath = htmlIndex.get(postNo)!;

  try {
    const result = await extractFromHtml(htmlPath, rec.post_url);
    if (!result || result.products.length === 0) {
      console.log(`  SKIP ${rec.record_id} (${rec.vendor}) — no products via ${result?.extractionSource ?? "N/A"}`);
      skipped++;
      continue;
    }

    db.prepare(`
      UPDATE records SET
        products_full_json = ?,
        products_json = ?,
        extraction_source = ?,
        confidence = ?
      WHERE record_id = ?
    `).run(
      JSON.stringify(result.products),
      JSON.stringify(result.products.map((p) => p.name)),
      result.extractionSource,
      result.confidence,
      rec.record_id,
    );

    updated++;
    console.log(`  OK ${rec.record_id} (${rec.vendor}) — ${result.products.length} products via ${result.extractionSource}`);
    for (const p of result.products.slice(0, 5)) {
      const price = p.price_krw ? `₩${p.price_krw.toLocaleString()}` : "—";
      const dur = p.duration_months ? `${p.duration_months}mo` : "—";
      console.log(`    ${p.name} | ${price} | ${dur}`);
    }
  } catch (err) {
    errors++;
    console.log(`  FAIL ${rec.record_id} (${rec.vendor}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Rebuild vendor profiles from updated records
db.exec("DELETE FROM vendor_profiles");
const allRecords = db.prepare(
  "SELECT vendor, author_name, post_url, posted_at, products_json FROM records ORDER BY captured_at"
).all() as Array<{
  vendor: string;
  author_name: string | null;
  post_url: string;
  posted_at: string | null;
  products_json: string | null;
}>;

for (const r of allRecords) {
  const productNames: string[] = r.products_json ? JSON.parse(r.products_json) : [];
  const now = new Date().toISOString();
  const postedAt = r.posted_at || now;

  const existing = db.prepare(
    "SELECT vendor_id, products_json FROM vendor_profiles WHERE vendor_id = ?"
  ).get(r.vendor) as { vendor_id: string; products_json: string | null } | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO vendor_profiles
        (vendor_id, author_name, first_seen_post_url, first_seen_at, last_seen_post_url, last_seen_at, total_posts, products_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      r.vendor, r.author_name || null, r.post_url, postedAt, r.post_url, postedAt,
      1, JSON.stringify([...new Set(productNames)]), now,
    );
  } else {
    const existingProducts: string[] = existing.products_json ? JSON.parse(existing.products_json) : [];
    const merged = [...new Set([...existingProducts, ...productNames])];
    db.prepare(`
      UPDATE vendor_profiles SET
        last_seen_post_url = ?,
        last_seen_at = ?,
        total_posts = total_posts + 1,
        products_json = ?,
        updated_at = ?
      WHERE vendor_id = ?
    `).run(r.post_url, postedAt, JSON.stringify(merged), now, r.vendor);
  }
}

db.close();

console.log(`\nDone. ${updated} updated, ${skipped} skipped, ${errors} errors.`);
