/**
 * Extract products from an HTML template using Ollama.
 * Compares against the existing catalog to identify new products.
 *
 * Usage:
 *   npx tsx scripts/extract-products-with-ollama.ts <html-file-path>
 */

import * as fs from "node:fs";
import { callOllamaGenerate } from "../lib/competitor-intel/extraction/ocr.js";
import { extractJsonObject } from "../lib/competitor-intel/extraction/vlm.js";
import { matchProductName, getCatalogForPrompt } from "../lib/competitor-intel/extraction/product-catalog.js";

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error("Usage: npx tsx scripts/extract-products-with-ollama.ts <html-file-path>");
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, "utf-8");
const CATALOG = getCatalogForPrompt();

const prompt = `Extract all product/service offerings from this HTML template.

For each product, return: name, price_krw (number), duration_months (number).

The following products are ALREADY in the catalog — if a product matches one, use the canonical name exactly:
${CATALOG}

Rules:
- If a product matches a catalog entry, use the canonical name exactly
- If a product is NOT in the catalog, include it with "new_product": true and provide keywords and regex patterns that would match it
- Do NOT include FAQ, comparison, navigation, or footer text as products
- Only include items that represent actual paid services with a price and duration

Return ONLY valid JSON with this shape:
{"products": [{"name": "string", "price_krw": number, "duration_months": number, "new_product": boolean, "keywords": ["string"], "regex": "string"}]}

HTML:
${html.slice(0, 8000)}
`;

console.log(`\nExtracting products from ${htmlPath} using Ollama (qwen3:4b-instruct)...\n`);
const result = await callOllamaGenerate(prompt, undefined, "qwen3:4b-instruct", ["gemma2:27b"]);

const parsed = extractJsonObject(result.text) as any;
if (!parsed || !Array.isArray(parsed.products)) {
  console.error("Failed to parse JSON from Ollama output:");
  console.log(result.text.slice(0, 500));
  process.exit(1);
}

const existing: any[] = [];
const newProducts: any[] = [];

for (const p of parsed.products) {
  const catalogMatch = matchProductName(p.name);
  if (p.new_product) {
    newProducts.push(p);
  } else {
    existing.push({ ...p, canonicalName: catalogMatch });
  }
}

console.log("--- Products already in catalog ---\n");
for (const p of existing) {
  console.log(`  ${p.name.padEnd(35)} ₩${String(p.price_krw).padStart(10)} | ${p.duration_months}mo → "${p.canonicalName}"`);
}

console.log(`\n--- New products not in catalog (${newProducts.length}) ---\n`);
for (const p of newProducts) {
  console.log(`  ${p.name}`);
  console.log(`    Price: ₩${p.price_krw.toLocaleString()} / ${p.duration_months}mo`);
  console.log(`    Keywords: ${(p.keywords || []).join(", ")}`);
  console.log(`    Suggested regex: ${p.regex || "—"}`);
}

console.log("\n--- Suggested catalog entries (JSON) ---\n");
for (const p of newProducts) {
  const entry = {
    regex: p.regex || "",
    canonical: p.name,
    description: `${p.name} subscription`,
    keywords: p.keywords || [p.name],
    addedBy: "session-8",
    addedAt: new Date().toISOString().slice(0, 10),
  };
  console.log(JSON.stringify(entry, null, 2) + ",");
}
