import type { Stage0Output } from "../stage0-locate/types.js";
import type { Stage1Output } from "../stage1-classify/types.js";
import type { CleanBlock, FilterReason, RemovedBlock, Stage2Output } from "./types.js";
import { DURATION_PATTERN, NOISE_PATTERNS, PRICE_PATTERN, PRODUCT_KEYWORDS } from "./patterns.js";

const LLM_SKIP_THRESHOLD = 0.85;
const LLM_REQUIRED_THRESHOLD = 0.6;
const MAX_LONG_BLOCK_CHARS = 100;

function matchesNoise(text: string): { matched: boolean; category: string; pattern: string } {
  for (const { pattern, category } of NOISE_PATTERNS) {
    if (pattern.test(text)) {
      return { matched: true, category, pattern: pattern.toString() };
    }
  }
  return { matched: false, category: "", pattern: "" };
}

function hasPrice(text: string): boolean {
  return PRICE_PATTERN.test(text);
}

function hasDuration(text: string): boolean {
  return DURATION_PATTERN.test(text);
}

function hasProductKeyword(text: string): boolean {
  return PRODUCT_KEYWORDS.some((re) => re.test(text));
}

function computeSignalScore(cleanBlocks: CleanBlock[], removedBlocks: RemovedBlock[]): number {
  if (cleanBlocks.length === 0) return 0;

  const productBlocks = cleanBlocks.filter((b) => b.hasProductKeyword);
  if (productBlocks.length === 0) return 0;

  const blocksWithPriceAndDuration = cleanBlocks.filter((b) => b.hasPrice && b.hasDuration);
  const totalBlocks = cleanBlocks.length + removedBlocks.length;

  // Spec formula: hasProductBlocks ? 0.3 + (blocksWithPriceAndDuration / totalBlocks) * 0.7 : 0
  const rawScore = 0.3 + (blocksWithPriceAndDuration.length / Math.max(1, totalBlocks)) * 0.7;

  // Reduce if license noise was removed (no_license_noise_in_products weight 0.1)
  const licenseNoise = removedBlocks.filter((b) => b.reason.startsWith("license_footer"));
  const noisePenalty = licenseNoise.length > 0 ? 0.1 : 0;

  return Math.max(0, Math.min(1, rawScore - noisePenalty));
}

function splitIntoBlocks(bodyText: string): string[] {
  return bodyText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function filterNoise(stage0Output: Stage0Output, stage1Output: Stage1Output): Stage2Output {
  const { postType } = stage1Output;

  if (postType === "affiliate" || postType === "promo_code") {
    return {
      cleanBlocks: [],
      filterReasons: [],
      signalScore: 0,
      llmRequired: false,
      contentForLlm: "",
      skip: true,
    };
  }

  const rawBlocks = splitIntoBlocks(stage0Output.bodyText);
  const cleanBlocks: CleanBlock[] = [];
  const filterReasons: FilterReason[] = [];
  const removedBlocks: RemovedBlock[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const text = rawBlocks[i];
    const noise = matchesNoise(text);
    const blockHasPrice = hasPrice(text);
    const blockHasDuration = hasDuration(text);
    const blockHasProduct = hasProductKeyword(text);

    if (noise.matched) {
      if (blockHasPrice || blockHasProduct) {
        // Edge case: has signal alongside noise — preserve with reason
        const filterReason = blockHasPrice ? "partial_noise" : "mixed";
        cleanBlocks.push({
          text,
          lineIndex: i,
          hasPrice: blockHasPrice,
          hasDuration: blockHasDuration,
          hasProductKeyword: blockHasProduct,
          filterReason,
        });
        filterReasons.push({
          blockIndex: i,
          reason: filterReason,
          pattern: noise.pattern,
        });
      } else {
        removedBlocks.push({ text, reason: noise.category });
        filterReasons.push({
          blockIndex: i,
          reason: noise.category,
          pattern: noise.pattern,
        });
      }
      continue;
    }

    // Remove long blocks with no price or duration (pure boilerplate)
    if (text.length > MAX_LONG_BLOCK_CHARS && !blockHasPrice && !blockHasDuration && !blockHasProduct) {
      removedBlocks.push({ text, reason: "long_no_signal" });
      filterReasons.push({
        blockIndex: i,
        reason: "long_no_signal",
        pattern: `len=${text.length}>100, no price/duration/product`,
      });
      continue;
    }

    cleanBlocks.push({
      text,
      lineIndex: i,
      hasPrice: blockHasPrice,
      hasDuration: blockHasDuration,
      hasProductKeyword: blockHasProduct,
    });
  }

  const signalScore = computeSignalScore(cleanBlocks, removedBlocks);

  const productCleanBlocks = cleanBlocks.filter((b) => b.hasProductKeyword);
  const llmRequired = !(signalScore >= LLM_SKIP_THRESHOLD && productCleanBlocks.length > 0);

  const contentForLlm = cleanBlocks.map((b) => b.text).join("\n");

  const output: Stage2Output = {
    cleanBlocks,
    filterReasons,
    signalScore,
    llmRequired,
    contentForLlm,
  };

  if (removedBlocks.length > 0) {
    output.removedBlocks = removedBlocks;
  }

  if (postType === "unknown") {
    // Mark for review — no skip but signal is uncertain
  }

  return output;
}
