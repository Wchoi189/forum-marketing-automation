import type { Stage1Output } from "../stage1-classify/types.js";
import type { Stage2Output } from "../stage2-filter/types.js";
import type { Stage3Output } from "../stage3-llm/types.js";
import type { Stage4Output } from "../stage4-merge/types.js";
import type { EvidenceChainEntry, EvidenceLink, ProductWithEvidence, Stage5Output } from "./types.js";

const PRICE_RE = /(\d{1,3}(?:,\d{3})*)\s*원/;
const DURATION_RE = /\d+\s*(개월|년|달|주)/;
const MAX_EXCERPT = 160;

function truncate(s: string): string {
  return s.length > MAX_EXCERPT ? s.slice(0, MAX_EXCERPT) + "…" : s;
}

/**
 * Find the best matching clean block for a product name or price.
 */
function findMatchingBlock(
  name: string,
  price: number | undefined,
  stage2Output: Stage2Output,
): { text: string; index: number } | null {
  for (const block of stage2Output.cleanBlocks) {
    const nameMatch = block.text.toLowerCase().includes(name.toLowerCase()) ||
      block.hasProductKeyword;
    const priceMatch = price != null && PRICE_RE.test(block.text) &&
      block.text.includes(String(price).replace(/(\d)(?=(\d{3})+$)/g, "$1,"));
    if (nameMatch && (price == null || priceMatch)) {
      return { text: block.text, index: block.lineIndex };
    }
  }
  // Fallback: any block with product keyword
  const fallback = stage2Output.cleanBlocks.find((b) => b.hasProductKeyword);
  return fallback ? { text: fallback.text, index: fallback.lineIndex } : null;
}

/**
 * Find LLM evidence for a product from stage3 output.
 */
function findLlmEvidence(name: string, stage3Output: Stage3Output): { excerpt: string; promptContext: string } | null {
  if (stage3Output.skipped) return null;
  const product = stage3Output.llmProducts.find(
    (p) => p.name === name || p.name.includes(name) || name.includes(p.name),
  );
  if (!product) return null;
  return {
    excerpt: truncate(product.evidence),
    promptContext: truncate(stage3Output.promptContext),
  };
}

export function attachEvidence(
  stage4Output: Stage4Output,
  stage1Output: Stage1Output,
  stage2Output: Stage2Output,
  stage3Output: Stage3Output,
): Stage5Output {
  const warnings: string[] = [];
  const evidenceChain: EvidenceChainEntry[] = [];
  const auditTrail: string[] = [];
  const productsWithEvidence: ProductWithEvidence[] = [];

  for (const product of stage4Output.finalProducts) {
    const productId = `${product.name}|${product.price ?? ""}|${product.duration ?? ""}`;

    // --- Name evidence ---
    let nameEvidence: EvidenceLink;

    if (product.source === "llm" || product.source === "mixed") {
      const llmEv = findLlmEvidence(product.name, stage3Output);
      if (llmEv) {
        nameEvidence = {
          source_type: "llm",
          excerpt: llmEv.excerpt,
          llm_prompt_context: llmEv.promptContext,
          confidence: product.confidence,
        };
        evidenceChain.push({ productId, field: "name", source: "llm", excerpt: llmEv.excerpt });
      } else {
        // Fallback to HTML block
        const block = findMatchingBlock(product.name, product.price, stage2Output);
        nameEvidence = {
          source_type: "html",
          excerpt: block ? truncate(block.text) : product.name,
          block_location: block ? `line:${block.index}` : undefined,
          confidence: 0.6,
        };
        warnings.push(`name_evidence_fallback: ${product.name} (LLM source but no llmProducts match)`);
        evidenceChain.push({ productId, field: "name", source: "html", excerpt: nameEvidence.excerpt });
      }
    } else {
      // Cheerio source
      const block = findMatchingBlock(product.name, product.price, stage2Output);
      if (block) {
        nameEvidence = {
          source_type: "html",
          excerpt: truncate(block.text),
          block_location: `line:${block.index}`,
          confidence: product.confidence,
        };
        evidenceChain.push({ productId, field: "name", source: "html", excerpt: nameEvidence.excerpt });
      } else {
        nameEvidence = {
          source_type: "html",
          excerpt: product.name,
          confidence: 0.5,
        };
        warnings.push(`name_evidence_missing: ${product.name} (no matching block)`);
        evidenceChain.push({ productId, field: "name", source: "html", excerpt: product.name });
      }
    }

    const pwev: ProductWithEvidence = {
      name: product.name,
      name_evidence: nameEvidence,
      confidence: product.confidence,
      source: product.source,
    };

    // --- Price evidence ---
    if (product.price != null) {
      pwev.price_krw = product.price;
      // Cheerio preferred for price
      const block = findMatchingBlock(product.name, product.price, stage2Output);
      if (block && PRICE_RE.test(block.text)) {
        pwev.price_evidence = {
          source_type: "html",
          excerpt: truncate(block.text),
          block_location: `line:${block.index}`,
          confidence: 0.85,
        };
        evidenceChain.push({ productId, field: "price", source: "html", excerpt: block.text.slice(0, MAX_EXCERPT) });
      } else if (!stage3Output.skipped) {
        const llmEv = findLlmEvidence(product.name, stage3Output);
        if (llmEv) {
          pwev.price_evidence = {
            source_type: "llm",
            excerpt: llmEv.excerpt,
            llm_prompt_context: llmEv.promptContext,
            confidence: 0.75,
          };
          evidenceChain.push({ productId, field: "price", source: "llm", excerpt: llmEv.excerpt });
        }
      }
    }

    // --- Duration evidence ---
    if (product.duration != null) {
      pwev.duration_months = product.duration;
      const block = findMatchingBlock(product.name, product.price, stage2Output);
      if (block && DURATION_RE.test(block.text)) {
        pwev.duration_evidence = {
          source_type: "html",
          excerpt: truncate(block.text),
          block_location: `line:${block.index}`,
          confidence: 0.85,
        };
        evidenceChain.push({ productId, field: "duration", source: "html", excerpt: block.text.slice(0, MAX_EXCERPT) });
      } else if (!stage3Output.skipped) {
        const llmEv = findLlmEvidence(product.name, stage3Output);
        if (llmEv) {
          pwev.duration_evidence = {
            source_type: "llm",
            excerpt: llmEv.excerpt,
            confidence: 0.7,
          };
          evidenceChain.push({ productId, field: "duration", source: "llm", excerpt: llmEv.excerpt });
        }
      }
    }

    productsWithEvidence.push(pwev);
    auditTrail.push(
      `product: ${product.name} | source: ${product.source} | confidence: ${product.confidence} | evidence_source: ${nameEvidence.source_type}`,
    );
  }

  // --- Classifier evidence ---
  auditTrail.push(`classifier: ${stage1Output.postType} (${stage1Output.classifierConfidence}) — "${stage1Output.classifierEvidence.excerpt}"`);

  const readyForPersist = productsWithEvidence.length >= 0 &&
    productsWithEvidence.every((p) => p.name_evidence != null);

  return {
    productsWithEvidence,
    evidenceChain,
    warnings,
    readyForPersist,
    auditTrail,
  };
}
