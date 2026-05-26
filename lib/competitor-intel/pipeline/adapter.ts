import type { PpomppuParsedRecord, PpomppuProduct } from "../../competitor-ad-parser/ppomppu-parser.js";
import type { Stage4Output } from "./stage4-merge/types.js";
import type { Stage5Output } from "./stage5-evidence/types.js";

/**
 * Convert Stage 5 evidence output to PpomppuParsedRecord format.
 * Metadata fields (vendor, dates, landing_url, etc.) are inherited from the
 * legacy parsePpomppuPost() result since the new pipeline only extracts products.
 */
export function convertToLegacyFormat(
  stage5Output: Stage5Output,
  stage4Output: Stage4Output,
  legacyBase: PpomppuParsedRecord,
): PpomppuParsedRecord {
  const products: PpomppuProduct[] = stage5Output.productsWithEvidence.map((p) => {
    const product: PpomppuProduct = { name: p.name };
    if (p.duration_months != null) product.duration_months = p.duration_months;
    if (p.price_krw != null) {
      product.price_krw = p.price_krw;
      if (p.duration_months != null && p.duration_months > 0) {
        product.price_per_month_krw = Math.round(p.price_krw / p.duration_months);
      }
    }
    return product;
  });

  const allWarnings = [
    ...legacyBase.warnings,
    ...stage4Output.warnings,
    ...stage5Output.warnings,
  ];

  // Use pipeline products if any, fall back to legacy parser products
  const finalProducts = products.length > 0 ? products : legacyBase.products;
  const confidence = products.length > 0
    ? stage4Output.confidenceBreakdown.overall
    : legacyBase.confidence;

  return {
    ...legacyBase,
    products: finalProducts,
    confidence,
    warnings: allWarnings,
  };
}
