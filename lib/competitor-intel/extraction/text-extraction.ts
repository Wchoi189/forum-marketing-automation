/**
 * Text-based Ollama extraction for competitor ad intelligence.
 *
 * Uses a shared product catalog to constrain product name extraction.
 * The LLM identifies which catalog products are mentioned and extracts
 * their prices/durations — names are mapped to canonical forms, not invented.
 */

import { ENV } from "../../../config/env.js";
import { callOllamaGenerate } from "./ocr.js";
import { extractJsonObject } from "./vlm.js";
import { cacheGet, cachePut } from "../cache/llmCache.js";
import { getCatalogForPrompt, getProductKeywords, matchProductName } from "./product-catalog.js";

// Build a human-readable catalog string for the LLM prompt
const CATALOG_LIST = getCatalogForPrompt();
const KEYWORDS_LIST = getProductKeywords().join(", ");

const PRODUCT_EXTRACTION_PROMPT = `You are a structured data extractor for Korean competitor ad intelligence.

Extract product offerings from the following ad content. You must select product names ONLY from this catalog of known products:

${CATALOG_LIST}

Rules:
- Pick product names from the catalog above. Do NOT invent new product names.
- If the ad mentions a bundle/package of two catalog products (e.g. "YouTube Premium + Gemini"), use the format "Catalog A + Catalog B" for the combined product name.
- Detect bundles when you see "+" / "&" / "패키지" connecting two known products.
- Return a JSON object with:
  - "products": array of objects with fields: name (string), duration_months (number), price_krw (number)
- "duration_months" should be the subscription duration in months (1년 = 12, 6개월 = 6, 3달 = 3, 1달 = 1)
- "price_krw" should be the TOTAL price for the stated duration, NOT the monthly price. If the ad shows "120,000원" next to a "12개월" plan label, that 120,000 is the total — do NOT multiply it by 12 or treat it as a monthly rate
- Each product entry must pair a price with the name explicitly stated in the same section of the ad. Do NOT cross-pair a price from one product tier with another tier's name
- Ignore numbers that appear in policy or constraint text (e.g., "12개월에 한번만 변경가능" means users can change once per 12 months — this is NOT a product duration)
- Do NOT infer durations or prices from context — only use numbers that are explicitly the price and duration of a specific product offering
- Only include products that have BOTH a name AND a price
- Do NOT include FAQ answers, payment instructions, or navigation text as products
- Do NOT include seller info, trust signals, or contact info as products
- Do NOT include page headers, navigation menus, or site chrome as products
- If no valid products found, return {"products": []}

Return ONLY valid JSON, no markdown, no explanation.

Title: {title}

Content:
`;

function namesAreCloseVariants(a: string, b: string): boolean {
  if (a === b) return true;
  // Substring check
  if (a.includes(b) || b.includes(a)) return true;
  // Shared prefix check: if they share a long common prefix (>10 chars)
  // and differ only by a suffix (like "YouTube Premium 가족계정" vs "YouTube Premium 개인계정")
  let prefixLen = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) prefixLen++; else break;
  }
  if (prefixLen > 10) return true;
  return false;
}

/**
 * Remove LLM cross-pairing artifacts:
 * 1. When multiple entries share the same (price, duration) with names that are
 *    close variants (e.g. "가족계정" vs "개인계정") — the LLM guessed at which
 *    tier owns that price, so keep only the first
 * 2. When an entry has duration=12 and another entry has the same price but a
 *    different name with a different non-12 duration — the 12 is from constraint
 *    text like "12개월에 한번만 변경가능"
 */
function filterCrossPairedArtifacts(
  products: Array<{ name: string; duration_months?: number; price_krw?: number }>,
): Array<{ name: string; duration_months?: number; price_krw?: number }> {
  const toRemove = new Set<number>();

  // Pass 1: If two entries share the same price+duration and have close-variant
  // names, keep only the first (the later one is likely a cross-pair)
  for (let i = 0; i < products.length; i++) {
    if (toRemove.has(i)) continue;
    const p = products[i];
    if (p.price_krw == null || p.duration_months == null) continue;
    for (let j = i + 1; j < products.length; j++) {
      if (toRemove.has(j)) continue;
      const q = products[j];
      if (q.price_krw === p.price_krw && q.duration_months === p.duration_months) {
        if (namesAreCloseVariants(p.name, q.name)) {
          toRemove.add(j);
        }
      }
    }
  }

  // Pass 2: If an entry has duration=12 and another entry has the same price
  // but a different name with a different non-12 duration, the 12 is from constraint
  for (let i = 0; i < products.length; i++) {
    if (toRemove.has(i)) continue;
    const p = products[i];
    if (p.price_krw == null || p.duration_months !== 12) continue;
    for (let j = 0; j < products.length; j++) {
      if (i === j || toRemove.has(j)) continue;
      const q = products[j];
      if (q.price_krw === p.price_krw && q.name !== p.name && q.duration_months !== undefined && q.duration_months !== 12) {
        toRemove.add(i);
        break;
      }
    }
  }

  return products.filter((_, i) => !toRemove.has(i));
}

/**
 * Reject products that don't match the known catalog.
 * This is the primary defense against noise: if a name can't be mapped to
 * any catalog entry, it's almost certainly page chrome or boilerplate.
 */
function rejectNonCatalogProducts(
  products: Array<{ name: string; duration_months?: number; price_krw?: number }>,
): Array<{ name: string; duration_months?: number; price_krw?: number }> {
  return products.filter((p) => matchProductName(p.name) !== null);
}

/**
 * Map product names to their canonical catalog forms.
 */
function canonicalizeProductNames(
  products: Array<{ name: string; duration_months?: number; price_krw?: number }>,
): Array<{ name: string; duration_months?: number; price_krw?: number }> {
  return products.map((p) => {
    const canonical = matchProductName(p.name);
    return {
      ...p,
      name: canonical ?? p.name,
    };
  });
}

export async function runTextExtraction(
  contentText: string,
  postTitle?: string,
): Promise<{ products: Array<{ name: string; duration_months?: number; price_krw?: number }>; raw: string } | null> {
  if (!contentText || contentText.length < 50) {
    return null;
  }

  const title = postTitle || "(unknown)";
  const prompt = PRODUCT_EXTRACTION_PROMPT.replace("{title}", title) + contentText.slice(0, 5000);
  const cacheModel = ENV.OLLAMA_OCR_MODEL;

  const cached = await cacheGet(prompt, cacheModel);
  let raw: string;
  let modelUsed: string;

  if (cached) {
    raw = cached.raw;
    modelUsed = cached.modelUsed;
  } else {
    const result = await callOllamaGenerate(prompt, undefined, cacheModel, ["qwen2.5vl:3b"]);
    raw = result.text;
    modelUsed = result.modelUsed;
    await cachePut(prompt, cacheModel, { raw, modelUsed });
  }

  try {
    const parsed = extractJsonObject(raw) as Record<string, unknown> | null;

    if (parsed && Array.isArray(parsed.products)) {
      let products = parsed.products
        .filter((p): p is Record<string, unknown> => p && typeof p === "object" && typeof (p as { name?: string }).name === "string")
        .map((p) => {
          const product: { name: string; duration_months?: number; price_krw?: number } = {
            name: String(p.name).trim(),
          };
          if (typeof p.duration_months === "number") product.duration_months = Math.round(p.duration_months);
          if (typeof p.price_krw === "number") product.price_krw = Math.round(p.price_krw);
          return product;
        })
        .filter((p) => p.name.length > 0 && p.price_krw !== undefined);

      // Reject products that don't match the known product catalog
      products = rejectNonCatalogProducts(products);

      // Map names to canonical catalog forms
      products = canonicalizeProductNames(products);

      // Remove cross-pairing artifacts
      products = filterCrossPairedArtifacts(products);

      if (products.length > 0) {
        return { products, raw };
      }
    }

    return { products: [], raw };
  } catch {
    return null;
  }
}
