/**
 * Text-based Ollama extraction for competitor ad intelligence.
 *
 * When the deterministic Cheerio parser fails to extract clean product data,
 * pass the cleaned content text to a local Ollama LLM for structured extraction.
 * This avoids brittle regex parsing while keeping the pipeline fast (no image needed).
 */

import { ENV } from "../../../config/env.js";
import { callOllamaGenerate } from "./ocr.js";
import { extractJsonObject } from "./vlm.js";

const PRODUCT_EXTRACTION_PROMPT = `You are a structured data extractor for Korean competitor ad intelligence.

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

export async function runTextExtraction(
  contentText: string,
  postTitle?: string,
): Promise<{ products: Array<{ name: string; duration_months?: number; price_krw?: number }>; raw: string } | null> {
  if (!contentText || contentText.length < 50) {
    return null;
  }

  const title = postTitle || "(unknown)";
  const prompt = PRODUCT_EXTRACTION_PROMPT.replace("{title}", title) + contentText.slice(0, 5000);

  try {
    const result = await callOllamaGenerate(prompt, undefined, ENV.OLLAMA_OCR_MODEL, ["qwen2.5vl:3b"]);
    const raw = result.text;
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

      // Remove cross-pairing artifacts: if two entries share the same price but
      // have different names and durations, one is likely contaminated from another section
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
