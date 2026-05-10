/**
 * Identify and characterize problematic HTML files from the pipeline test.
 * Also test different Ollama models on the most challenging file.
 */

import * as fs from "node:fs";
import * as cheerio from "cheerio";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/ppomppu-parser.js";
import { extractProductsFromText } from "../lib/competitor-intel/extraction/pipeline.js";
import { runTextExtraction } from "../lib/competitor-intel/extraction/text-extraction.js";
import { callOllamaGenerate } from "../lib/competitor-intel/extraction/ocr.js";
import type { EvidenceSource } from "../lib/competitor-intel/types.js";

const CONSOLIDATED_DIR =
  "/parent/marketing-automation/artifacts/competitor-ads/test-pipeline-1page-v2/raw_html";

// ── Problematic files identified from full pipeline test ──
const PROBLEM_FILES: Array<{
  fileId: string;
  problem: string;
  path: string;
}> = [
  {
    fileId: "eb67ebba985c",
    problem: "Non-deterministic LLM: sometimes extracts 3 clean products, sometimes 4 with 1 missing price. Ad body uses generic terms (가족계정, 개인계정) without explicit product names — requires title inference.",
    path: `${CONSOLIDATED_DIR}/eb67ebba985c.html`,
  },
];

const PIPELINE_PROBLEMS = [
  {
    fileId: "551b849c00f1",
    problem: "HTML path wins: Cheerio confidence 0.9 (just above fast-path threshold). LLM finds fewer products. Complex pricing with both Gemini and YouTube.",
    path: `${CONSOLIDATED_DIR}/551b849c00f1.html`,
  },
  {
    fileId: "9446cd3682da",
    problem: "HTML path wins: Cheerio confidence 0.9. LLM finds 1 product vs 3 from HTML. Ad has simple structure.",
    path: `${CONSOLIDATED_DIR}/9446cd3682da.html`,
  },
];

function productsLookJunk(products: Array<{ name: string; price_krw?: number }>): boolean {
  if (products.length === 0) return false;
  return products.filter((p) => {
    if (p.name === "OTT 구독" || p.name === "구독") return true;
    if (p.name.length <= 3 && /^\d+$/.test(p.name)) return true;
    if (/변경|가능|문의|상담|해지|가입|완료/.test(p.name)) return true;
    if (/가[\s]?격|이용\s?기간|기\s?간|할인|쿠폰/.test(p.name)) return true;
    if (p.price_krw === undefined && p.name.length < 15) return true;
    return false;
  }).length > products.length * 0.5;
}

function completenessScore(prods: Array<{ price_krw?: number; duration_months?: number }>): number {
  if (prods.length === 0) return 0;
  return prods.filter((p) => p.price_krw !== undefined && p.duration_months !== undefined).length / prods.length;
}

async function analyzeFile(info: typeof PROBLEM_FILES[number]) {
  if (!fs.existsSync(info.path)) {
    console.log(`\n=== ${info.fileId} — FILE NOT FOUND ===`);
    return null;
  }

  const html = fs.readFileSync(info.path, "utf-8");
  const parsed = parsePpomppuPost(html, `https://www.ppomppu.co.kr/zboard/view.php?id=${info.fileId}`);

  console.log(`\n${"=".repeat(80)}`);
  console.log(`FILE: ${info.fileId}  Vendor: ${parsed.vendor}`);
  console.log(`Title: ${parsed.title}`);
  console.log(`Cheerio confidence: ${parsed.confidence}, products: ${parsed.products.length}`);
  for (const p of parsed.products) {
    console.log(`  ${p.name.padEnd(40)} | price: ${p.price_krw ?? "?"} | dur: ${p.duration_months ?? "?"}`);
  }

  // HTML text blocks
  const $ = cheerio.load(html);
  const sel = "div.JS_ContentMain td.board-contents";
  const leafBlocks: EvidenceSource[] = [];
  $(sel).find("p, div, span, td, th, li, b, strong, em, h1, h2, h3").each((_i, el) => {
    if ($(el).children().length === 0) {
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160);
      if (text.length >= 2) leafBlocks.push({ type: "html", excerpt: text, source_block: el.tagName });
    }
  });
  const { products: htmlProducts } = extractProductsFromText(leafBlocks);
  const htmlJunk = productsLookJunk(htmlProducts);
  console.log(`\nHTML text blocks: ${leafBlocks.length} snippets, ${htmlProducts.length} products, junk=${htmlJunk}`);
  for (const p of htmlProducts.slice(0, 8)) {
    console.log(`  ${p.name.padEnd(40)} | price: ${p.price_krw ?? "?"} | dur: ${p.duration_months ?? "?"}`);
  }

  // Content text
  const contentText = $(sel).text().replace(/\s+/g, " ").trim();
  console.log(`\nContent text length: ${contentText.length}`);
  console.log(`Problem: ${info.problem}`);

  return { contentText, parsedTitle: parsed.title };
}

// ── Main ──
console.log("PROBLEMATIC FILES ANALYSIS");
console.log("=".repeat(80));

for (const info of PROBLEM_FILES) {
  const result = await analyzeFile(info);
}

for (const info of PIPELINE_PROBLEMS) {
  await analyzeFile(info);
}

// ── Model comparison on the hardest file ──
console.log("\n\n");
console.log("=".repeat(80));
console.log("MODEL COMPARISON ON HARDEST FILE");
console.log("=".repeat(80));

const hardFile = await analyzeFile(PROBLEM_FILES[0]);
if (hardFile) {
  const models = [
    "qwen2.5vl:7b",
    "qwen3:8b",
    "qwen3.5:9b",
    "gemma2:9b",
    "gemma2:27b",
  ];

  const customPrompt = `You are a structured data extractor for Korean competitor ad intelligence.

Extract product offerings from the following ad content. Return a JSON object with:
- "products": array of objects with fields: name (string), duration_months (number), price_krw (number)

Rules:
- "name" should be the full product/service name (e.g. "YouTube Premium", "Netflix Premium", "Gemini Pro")
- If the body text uses shorthand like "프리미엄", "개인계정", or "가족계정" without a product name, infer the product name from the post title. For example, if the title is about YouTube Premium, then "가족계정" should become "YouTube Premium 가족계정" and "개인계정" should become "YouTube Premium 개인계정"
- "duration_months" should be the subscription duration in months (1년 = 12, 6개월 = 6, 3달 = 3, 1달 = 1)
- "price_krw" should be the price in Korean Won (integer, no commas)
- Each product entry must pair a price with the name explicitly stated in the same section of the ad. Do NOT cross-pair a price from one product tier with another tier's name
- Ignore numbers that appear in policy or constraint text (e.g., "12개월에 한번만 변경가능" means users can change once per 12 months — this is NOT a product duration)
- Do NOT infer durations or prices from context — only use numbers that are explicitly the price and duration of a specific product offering
- Only include products that have BOTH a name AND a price
- Do NOT include FAQ answers, payment instructions, or navigation text as products
- Do NOT include seller info, trust signals, or contact info as products
- If no valid products found, return {"products": []}

Return ONLY valid JSON, no markdown, no explanation.

Title: ${hardFile.parsedTitle}

Content:
${hardFile.contentText.slice(0, 5000)}`;

  for (const model of models) {
    console.log(`\n--- ${model} ---`);
    try {
      const result = await callOllamaGenerate(customPrompt, undefined, model);
      console.log(`Model response (${result.modelUsed}):`);
      // Parse and display products
      const jsonMatch = result.text.match(/\{[\s\S]*"products"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.products)) {
            for (const p of parsed.products) {
              console.log(`  ${String(p.name).padEnd(40)} | price: ${p.price_krw ?? "?"} | dur: ${p.duration_months ?? "?"}`);
            }
            const complete = parsed.products.filter((p: any) => p.price_krw != null && p.duration_months != null).length;
            console.log(`  Completeness: ${complete}/${parsed.products.length} (${(complete / parsed.products.length * 100).toFixed(0)}%)`);
          }
        } catch {
          console.log(`  Raw: ${result.text.slice(0, 200)}`);
        }
      } else {
        console.log(`  Raw (no JSON found): ${result.text.slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
