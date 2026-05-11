/**
 * Runtime loader for the shared product catalog.
 *
 * Reads config/product-catalog.json and builds the lookup structures
 * used by both the Cheerio parser and the LLM text extraction path.
 *
 * To add a new product:
 *   1. Append an entry to config/product-catalog.json
 *   2. More specific patterns must come BEFORE less specific ones
 *      (e.g. "YouTube Premium + Music" before "YouTube Premium")
 *   3. No code changes needed — the loader picks up the JSON at runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type CatalogEntry = {
  regex: string;
  canonical: string;
  description: string;
  keywords: string[];
  addedBy?: string;
  addedAt?: string;
};

let _catalog: CatalogEntry[] | null = null;

/**
 * Load the product catalog JSON file. Result is cached.
 */
function loadCatalog(): CatalogEntry[] {
  if (_catalog) return _catalog;
  const jsonPath = path.join(__dirname, "..", "..", "..", "config", "product-catalog.json");
  const raw = fs.readFileSync(jsonPath, "utf-8");
  _catalog = JSON.parse(raw) as CatalogEntry[];
  return _catalog;
}

/**
 * Compile all regex patterns into an array of [RegExp, canonical] pairs.
 * Order is preserved from the JSON file (more specific patterns first).
 */
export function getProductNameMap(): Array<[RegExp, string]> {
  return loadCatalog().map((e) => [new RegExp(e.regex, "i"), e.canonical]);
}

/**
 * Build a human-readable catalog list for LLM prompts.
 */
export function getCatalogForPrompt(): string {
  return loadCatalog()
    .map((e) => `  - "${e.canonical}"`)
    .join("\n");
}

/**
 * Build a flat keyword list for LLM prompts.
 */
export function getProductKeywords(): string[] {
  const kwSet = new Set<string>();
  for (const e of loadCatalog()) {
    for (const kw of e.keywords) {
      kwSet.add(kw);
    }
  }
  return Array.from(kwSet);
}

/**
 * Match a free-text string against the product catalog.
 * Returns the canonical name if a pattern matches, or null.
 *
 * For composite/bundle names like "YouTube Premium + Gemini",
 * split on "+" / "패키지" / "&" and match each part individually,
 * then reassemble as "Canonical A + Canonical B".
 */
export function matchProductName(text: string): string | null {
  // Try composite match first: split on bundle connectors
  const bundleParts = text.split(/\s*[+&]\s*|\s*패키지\s*/);
  if (bundleParts.length > 1) {
    const matched = bundleParts
      .map((part) => matchSingleProductName(part.trim()))
      .filter((m): m is string => m !== null);
    if (matched.length >= 2) {
      return matched.join(" + ");
    }
    if (matched.length === 1) {
      return matched[0];
    }
  }

  // Fall back to direct match
  return matchSingleProductName(text);
}

function matchSingleProductName(text: string): string | null {
  for (const [pattern, canonical] of getProductNameMap()) {
    if (pattern.test(text)) return canonical;
  }
  return null;
}
