import { z } from "zod";
import { ENV } from "../../../../config/env.js";
import { callOllamaGenerate } from "../../extraction/ocr.js";
import { extractJsonObject } from "../../extraction/vlm.js";
import { matchProductName, getCatalogForPrompt, getProductKeywords } from "../../extraction/product-catalog.js";
import type { Stage0Output } from "../stage0-locate/types.js";
import type { Stage1Output } from "../stage1-classify/types.js";
import type { Stage2Output } from "../stage2-filter/types.js";
import type { CatalogMatch, LlmProduct, Stage3Output } from "./types.js";

const CATALOG_LIST = getCatalogForPrompt();

const EXTRACTION_PROMPT = `You are a structured data extractor for Korean competitor ad intelligence.

Extract product offerings from the following ad content. You must select product names ONLY from this catalog of known products:

${CATALOG_LIST}

Rules:
- Pick product names from the catalog above. Do NOT invent new product names.
- If the ad mentions a bundle/package of two catalog products (e.g. "YouTube Premium + Gemini"), use the format "Catalog A + Catalog B".
- "duration_months": subscription duration in months (1년=12, 6개월=6, 3달=3, 1달=1).
- "price_krw": TOTAL price for the stated duration, NOT monthly rate.
- Do NOT cross-pair a price from one product tier with another tier's name.
- Ignore constraint text like "12개월에 한번만 변경가능" — NOT a product duration.
- Only include products with BOTH a name AND a price.
- For comparison posts: extract the OFFER price only, not the reference/official price.
- Return ONLY valid JSON, no markdown.

Title: {title}
Post type: {postType}

Content:
`;

const LlmProductSchema = z.object({
  name: z.string().min(1),
  duration_months: z.number().nullable().optional(),
  price_krw: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
});

const LlmResponseSchema = z.object({
  products: z.array(LlmProductSchema),
});

function namesAreCloseVariants(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  let prefixLen = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) prefixLen++; else break;
  }
  return prefixLen > 10;
}

function filterCrossPairedArtifacts(
  products: z.infer<typeof LlmProductSchema>[],
): z.infer<typeof LlmProductSchema>[] {
  const toRemove = new Set<number>();

  for (let i = 0; i < products.length; i++) {
    if (toRemove.has(i)) continue;
    const p = products[i];
    if (p.price_krw == null || p.duration_months == null) continue;
    for (let j = i + 1; j < products.length; j++) {
      if (toRemove.has(j)) continue;
      const q = products[j];
      if (q.price_krw === p.price_krw && q.duration_months === p.duration_months) {
        if (namesAreCloseVariants(p.name, q.name)) toRemove.add(j);
      }
    }
  }

  for (let i = 0; i < products.length; i++) {
    if (toRemove.has(i)) continue;
    const p = products[i];
    if (p.price_krw == null || p.duration_months !== 12) continue;
    for (let j = 0; j < products.length; j++) {
      if (i === j || toRemove.has(j)) continue;
      const q = products[j];
      if (q.price_krw === p.price_krw && q.name !== p.name && q.duration_months != null && q.duration_months !== 12) {
        toRemove.add(i);
        break;
      }
    }
  }

  return products.filter((_, i) => !toRemove.has(i));
}

function computeLlmConfidence(products: LlmProduct[], catalogMatches: CatalogMatch[]): number {
  if (products.length === 0) return 0;
  const withPriceAndDuration = products.filter((p) => p.price != null && p.duration != null).length;
  const catalogMatchCount = catalogMatches.length;
  const noJunk = products.every((p) => p.name.length > 3 && p.price != null) ? 1 : 0;

  return Math.min(
    1,
    0.3 + (withPriceAndDuration / products.length) * 0.4 + (catalogMatchCount / products.length) * 0.2 + noJunk * 0.1,
  );
}

export function parseExtractResponse(
  raw: string,
  titleText: string,
): { llmProducts: LlmProduct[]; catalogMatches: CatalogMatch[]; warnings: string[] } {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    warnings.push(`extract_parse_error: ${raw.slice(0, 200)}`);
    return { llmProducts: [], catalogMatches: [], warnings };
  }

  // Normalize: LLM sometimes returns a top-level array instead of {products: [...]}.
  if (Array.isArray(parsed)) {
    parsed = { products: parsed };
  }

  // Normalize: LLM sometimes uses "product_name" instead of "name".
  if (parsed && typeof parsed === "object" && "products" in parsed && Array.isArray((parsed as { products: unknown[] }).products)) {
    (parsed as { products: Record<string, unknown>[] }).products = (parsed as { products: Record<string, unknown>[] }).products.map((p) => {
      if (typeof p === "object" && p !== null && !("name" in p) && "product_name" in p) {
        return { ...p, name: p.product_name };
      }
      return p;
    });
  }

  const validated = LlmResponseSchema.safeParse(parsed);
  if (!validated.success) {
    warnings.push(`extract_zod_error: ${validated.error.message.slice(0, 200)}`);
    return { llmProducts: [], catalogMatches: [], warnings };
  }

  let raw_products = validated.data.products
    .filter((p) => p.price_krw != null)
    .map((p) => ({ ...p, name: p.name.trim() }))
    .filter((p) => p.name.length > 0);

  // Catalog filter
  const beforeCatalog = raw_products.length;
  raw_products = raw_products.filter((p) => matchProductName(p.name) !== null);
  if (raw_products.length < beforeCatalog) {
    warnings.push(`catalog_rejected: ${beforeCatalog - raw_products.length} products`);
  }

  // Cross-pairing filter
  raw_products = filterCrossPairedArtifacts(raw_products);

  // Canonicalize and build catalog matches
  const catalogMatches: CatalogMatch[] = [];
  const llmProducts: LlmProduct[] = raw_products.map((p) => {
    const canonical = matchProductName(p.name);
    if (canonical && canonical !== p.name) {
      catalogMatches.push({ original: p.name, canonical });
    }
    return {
      name: canonical ?? p.name,
      duration: typeof p.duration_months === "number" ? p.duration_months : undefined,
      price: typeof p.price_krw === "number" ? p.price_krw : undefined,
      confidence: typeof p.confidence === "number" ? p.confidence : 0.8,
      evidence: p.evidence ?? titleText,
    };
  });

  return { llmProducts, catalogMatches, warnings };
}

export async function extractWithLlm(
  stage0Output: Stage0Output,
  stage1Output: Stage1Output,
  stage2Output: Stage2Output,
): Promise<Stage3Output> {
  if (!stage2Output.llmRequired || stage2Output.skip) {
    return { skipped: true, llmProducts: [], promptContext: "", llmConfidence: 0 };
  }

  const content = stage2Output.contentForLlm || stage0Output.bodyText;
  const promptContext = EXTRACTION_PROMPT
    .replace("{title}", stage0Output.titleText)
    .replace("{postType}", stage1Output.postType)
    + content.slice(0, 5000);

  let raw: string;
  try {
    const result = await callOllamaGenerate(
      promptContext,
      undefined,
      ENV.OLLAMA_EXTRACT_MODEL,
      ["qwen2.5vl:3b"],
    );
    raw = result.text;
  } catch (err) {
    return {
      skipped: false,
      llmProducts: [],
      promptContext,
      llmConfidence: 0,
      warnings: [`extract_ollama_error: ${(err as Error).message}`],
    };
  }

  const { llmProducts, catalogMatches, warnings } = parseExtractResponse(raw, stage0Output.titleText);
  const llmConfidence = computeLlmConfidence(llmProducts, catalogMatches);

  const output: Stage3Output = {
    skipped: false,
    llmProducts,
    promptContext,
    llmConfidence,
    rawLlmResponse: raw,
  };
  if (catalogMatches.length > 0) output.catalogMatches = catalogMatches;
  if (warnings.length > 0) output.warnings = warnings;

  return output;
}
