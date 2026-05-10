import type { AdProduct } from "../types.js";
import type { PpomppuParsedRecord } from "../../competitor-ad-parser/index.js";

/** Validate VLM-extracted products against deterministically parsed HTML data. */
export function validateVlmAgainstHtml(
  vlmProducts: AdProduct[],
  htmlParsed: PpomppuParsedRecord,
): { validated: AdProduct[]; conflicts: string[] } {
  const conflicts: string[] = [];
  const validated = vlmProducts.map((vlmProduct) => {
    const corrected = { ...vlmProduct };

    const htmlPrices = htmlParsed.products.map((p) => p.price_krw).filter((p): p is number => p !== undefined);
    if (corrected.price_krw && htmlPrices.length > 0) {
      const closest = htmlPrices.reduce((a, b) =>
        Math.abs(a - corrected.price_krw!) < Math.abs(b - corrected.price_krw!) ? a : b,
      );
      const ratio = Math.abs(corrected.price_krw - closest) / closest;
      if (ratio > 0.1) {
        conflicts.push(`VLM price ${corrected.price_krw} deviates >10% from HTML price ${closest}; corrected`);
        corrected.price_krw = closest;
      }
    }

    const htmlDurations = htmlParsed.products.map((p) => p.duration_months).filter((d): d is number => d !== undefined);
    if (corrected.duration_months && htmlDurations.length > 0 && !htmlDurations.includes(corrected.duration_months)) {
      conflicts.push(`VLM duration ${corrected.duration_months} not found in HTML durations [${htmlDurations.join(", ")}]`);
    }

    return corrected;
  });

  return { validated, conflicts };
}
