import { matchProductName } from "../../extraction/product-catalog.js";
import type { CleanBlock } from "../stage2-filter/types.js";

const PRICE_RE = /(\d{1,3}(?:,\d{3})*)\s*원/;
const DURATION_RE = /(\d+)\s*(개월|년|달|주)/;
const MONTHS_FOR_UNIT: Record<string, number> = {
  개월: 1,
  달: 1,
  년: 12,
  주: 0.25,
};

export type RawProduct = {
  name: string;
  price?: number;
  duration?: number;
};

/**
 * Parse structured products from Stage 2 cleanBlocks.
 * Only blocks with all three signals (product, price, duration) yield a product.
 */
export function extractCheerioProducts(cleanBlocks: CleanBlock[]): RawProduct[] {
  const products: RawProduct[] = [];

  for (const block of cleanBlocks) {
    if (!block.hasPrice || !block.hasProductKeyword) continue;

    const priceMatch = block.text.match(PRICE_RE);
    if (!priceMatch) continue;
    const price = parseInt(priceMatch[1].replace(/,/g, ""), 10);

    const canonical = matchProductName(block.text);
    if (!canonical) continue;

    let duration: number | undefined;
    if (block.hasDuration) {
      const durationMatch = block.text.match(DURATION_RE);
      if (durationMatch) {
        const n = parseInt(durationMatch[1], 10);
        const unit = durationMatch[2];
        duration = Math.round(n * (MONTHS_FOR_UNIT[unit] ?? 1));
      }
    }

    products.push({ name: canonical, price, duration });
  }

  return products;
}

export function validateCatalog(
  products: RawProduct[],
): { valid: RawProduct[]; rejected: Array<{ product: RawProduct; reason: string }> } {
  const valid: RawProduct[] = [];
  const rejected: Array<{ product: RawProduct; reason: string }> = [];
  for (const p of products) {
    if (matchProductName(p.name) !== null) {
      valid.push(p);
    } else {
      rejected.push({ product: p, reason: `no_catalog_match: ${p.name}` });
    }
  }
  return { valid, rejected };
}

export function deduplicateProducts(products: RawProduct[]): RawProduct[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const key = `${p.name}|${p.price ?? ""}|${p.duration ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
