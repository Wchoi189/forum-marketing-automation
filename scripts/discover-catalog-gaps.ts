/**
 * Discover unmapped product names in the competitor ads SQLite database.
 *
 * Scans all records, extracts product names, runs them through the catalog
 * matcher, and reports any names that failed to map. This is the primary
 * tool for knowing when to add new entries to config/product-catalog.json.
 *
 * Usage:
 *   npx tsx scripts/discover-catalog-gaps.ts
 *   npx tsx scripts/discover-catalog-gaps.ts --json  (output as JSON)
 *   npx tsx scripts/discover-catalog-gaps.ts --vendor "OTT대장"  (filter by vendor)
 */

import { openDatabase } from "../lib/competitor-ad-sqlite.js";
import { matchProductName, getProductNameMap } from "../lib/competitor-intel/extraction/product-catalog.js";
import type { AdProduct } from "../lib/competitor-intel/types.js";

const OUTPUT_JSON = process.argv.includes("--json");
const VENDOR_FILTER = (() => {
  const idx = process.argv.indexOf("--vendor");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

interface GapReport {
  rawName: string;
  vendor: string;
  postTitle: string;
  count: number;
}

const db = openDatabase();

const records = db.prepare(
  "SELECT vendor, post_title, products_full_json FROM records WHERE products_full_json IS NOT NULL AND products_full_json != '[]'"
).all() as Array<{ vendor: string; post_title: string; products_full_json: string }>;

const unmapped = new Map<string, GapReport>();
let totalProducts = 0;
let mappedCount = 0;

for (const record of records) {
  if (VENDOR_FILTER && !record.vendor.includes(VENDOR_FILTER)) continue;

  const products: AdProduct[] = JSON.parse(record.products_full_json);
  for (const p of products) {
    totalProducts++;
    const canonical = matchProductName(p.name);
    if (canonical) {
      mappedCount++;
    } else {
      const key = p.name;
      const existing = unmapped.get(key);
      if (existing) {
        existing.count++;
      } else {
        unmapped.set(key, { rawName: p.name, vendor: record.vendor, postTitle: record.post_title, count: 1 });
      }
    }
  }
}

db.close();

// Sort by frequency (most common unmapped names first)
const sorted = Array.from(unmapped.values()).sort((a, b) => b.count - a.count);

if (OUTPUT_JSON) {
  console.log(JSON.stringify({
    totalProducts,
    mappedCount,
    unmappedCount: sorted.length,
    coverage: totalProducts > 0 ? ((mappedCount / totalProducts) * 100).toFixed(1) + "%" : "N/A",
    gaps: sorted,
  }, null, 2));
} else {
  console.log("=== Product Catalog Gap Report ===\n");
  console.log(`Total products: ${totalProducts}`);
  console.log(`Mapped to catalog: ${mappedCount} (${totalProducts > 0 ? ((mappedCount / totalProducts) * 100).toFixed(1) : "0"}%)`);
  console.log(`Unmapped names: ${sorted.length}\n`);

  if (sorted.length === 0) {
    console.log("All product names are mapped to the catalog. No gaps found.");
    console.log("\nTo add new products, edit config/product-catalog.json.");
    process.exit(0);
  }

  console.log("Unmapped product names (by frequency):\n");
  console.log("Raw Name".padEnd(60) + "Vendor".padEnd(18) + "Count");
  console.log("-".repeat(90));

  for (const g of sorted) {
    const displayName = g.rawName.length > 58 ? g.rawName.slice(0, 55) + "..." : g.rawName;
    console.log(displayName.padEnd(60) + g.vendor.padEnd(18) + g.count);
  }

  console.log(`\n---\n`);
  console.log("To fix these gaps:");
  console.log("1. Review each unmapped name above");
  console.log("2. If it's a real product, add an entry to config/product-catalog.json");
  console.log("3. If it's noise/vendor text, improve the Cheerio parser to skip it");
  console.log(`\nSee .agent/knowledge/product-catalog.md for the full workflow.`);
}
