import { matchProductName } from "../../extraction/product-catalog.js";
import type { Stage1Output } from "../stage1-classify/types.js";
import type { Stage2Output } from "../stage2-filter/types.js";
import type { Stage3Output } from "../stage3-llm/types.js";
import type { FinalProduct, RejectedProduct, SourceAttribution, Stage4Output } from "./types.js";
import { deduplicateProducts, extractCheerioProducts, validateCatalog } from "./validation.js";
import type { RawProduct } from "./validation.js";

function productKey(name: string, price?: number, duration?: number): string {
  return `${name}|${price ?? ""}|${duration ?? ""}`;
}

function sourceConfidence(source: FinalProduct["source"]): number {
  if (source === "mixed") return 0.9;
  if (source === "cheerio") return 0.8;
  return 0.7;
}

function computeOverall(perProduct: number[], warnings: string[]): number {
  if (perProduct.length === 0) return 0;
  const avg = perProduct.reduce((a, b) => a + b, 0) / perProduct.length;
  const penalty = Math.min(warnings.length * 0.05, 0.2);
  return Math.max(0, Math.min(1, avg - penalty));
}

export function mergeProducts(
  _stage1Output: Stage1Output,
  stage2Output: Stage2Output,
  stage3Output: Stage3Output,
): Stage4Output {
  const warnings: string[] = [];
  const rejectedProducts: RejectedProduct[] = [];
  const mergeLog: string[] = [];

  // --- Source A: Cheerio products from Stage 2 cleanBlocks ---
  const cheerioRaw = extractCheerioProducts(stage2Output.cleanBlocks);
  const { valid: cheerioValid, rejected: cheerioRejected } = validateCatalog(cheerioRaw);
  for (const r of cheerioRejected) {
    rejectedProducts.push({ product: r.product, reason: `cheerio: ${r.reason}` });
    warnings.push(`cheerio_catalog_rejected: ${r.product.name}`);
  }
  const cheerioProducts = deduplicateProducts(cheerioValid);
  mergeLog.push(`cheerio_source: ${cheerioProducts.length} products after catalog validation`);

  // --- Source B: LLM products from Stage 3 ---
  const llmRaw: RawProduct[] = stage3Output.skipped
    ? []
    : stage3Output.llmProducts.map((p) => ({ name: p.name, price: p.price, duration: p.duration }));

  const { valid: llmValid, rejected: llmRejected } = validateCatalog(llmRaw);
  for (const r of llmRejected) {
    rejectedProducts.push({ product: r.product, reason: `llm: ${r.reason}` });
    warnings.push(`llm_catalog_rejected: ${r.product.name}`);
  }
  const llmProducts = deduplicateProducts(llmValid);
  mergeLog.push(`llm_source: ${llmProducts.length} products after catalog validation`);

  // --- Build merge map: key → { cheerio?, llm? } ---
  const mergeMap = new Map<string, { cheerio?: RawProduct; llm?: RawProduct }>();

  for (const p of cheerioProducts) {
    const key = productKey(p.name, p.price, p.duration);
    mergeMap.set(key, { cheerio: p });
  }

  for (const p of llmProducts) {
    // Try exact match first
    const exactKey = productKey(p.name, p.price, p.duration);
    if (mergeMap.has(exactKey)) {
      mergeMap.get(exactKey)!.llm = p;
      continue;
    }
    // Try name-only match (different price/duration → use Cheerio price per hierarchy)
    let merged = false;
    for (const [key, entry] of mergeMap.entries()) {
      if (entry.cheerio && entry.cheerio.name === p.name && !entry.llm) {
        mergeMap.set(key, { cheerio: entry.cheerio, llm: p });
        merged = true;
        break;
      }
    }
    if (!merged) {
      mergeMap.set(productKey(p.name, p.price, p.duration), { llm: p });
    }
  }

  // --- Resolve final products ---
  const finalProducts: FinalProduct[] = [];
  const sourceAttribution: SourceAttribution[] = [];

  for (const [key, entry] of mergeMap.entries()) {
    const { cheerio, llm } = entry;
    let product: FinalProduct;
    const sources: string[] = [];

    if (cheerio) sources.push("cheerio");
    if (llm) sources.push("llm");

    if (cheerio && llm) {
      // Mixed: LLM name wins (better catalog resolution), Cheerio price wins (more reliable)
      const canonical = matchProductName(llm.name) ?? matchProductName(cheerio.name) ?? cheerio.name;
      product = {
        name: canonical,
        price: cheerio.price ?? llm.price,
        duration: cheerio.duration ?? llm.duration,
        source: "mixed",
        confidence: sourceConfidence("mixed"),
      };
      mergeLog.push(`merge_mixed: ${canonical} (cheerio price, llm name)`);
    } else if (cheerio) {
      product = { ...cheerio, source: "cheerio", confidence: sourceConfidence("cheerio") };
      if (!cheerio.duration || !cheerio.price) product.confidence = 0.6;
    } else {
      // LLM only
      product = { ...llm!, source: "llm", confidence: sourceConfidence("llm") };
      if (!llm!.duration || !llm!.price) product.confidence = 0.6;
    }

    finalProducts.push(product);
    sourceAttribution.push({ productId: key, sources, votes: sources.length });
  }

  const perProduct = finalProducts.map((p) => p.confidence);
  const overall = computeOverall(perProduct, warnings);

  const output: Stage4Output = {
    finalProducts,
    sourceAttribution,
    confidenceBreakdown: { overall, perProduct },
    warnings,
  };

  if (rejectedProducts.length > 0) output.rejectedProducts = rejectedProducts;
  if (mergeLog.length > 0) output.mergeLog = mergeLog;

  return output;
}
