import type { PpomppuParsedRecord } from "../../competitor-ad-parser/ppomppu-parser.js";
import { parsePpomppuPost } from "../../competitor-ad-parser/index.js";
import type { CompetitorAdRecord } from "../types.js";
import { locateElements } from "./stage0-locate/index.js";
import { classifyPost } from "./stage1-classify/index.js";
import { filterNoise } from "./stage2-filter/index.js";
import { extractWithLlm } from "./stage3-llm/index.js";
import { mergeProducts } from "./stage4-merge/index.js";
import { attachEvidence } from "./stage5-evidence/index.js";
import { deduplicatePost } from "./stage6-dedup/index.js";
import { convertToLegacyFormat } from "./adapter.js";

export type PipelineOptions = {
  skipDedup?: boolean;
};

export type PipelineResult = {
  record: PpomppuParsedRecord;
  extractionSource?: CompetitorAdRecord["extraction_source"];
  stageMetrics: {
    stage0DurationMs: number;
    stage1DurationMs: number;
    stage2DurationMs: number;
    stage3DurationMs: number;
    stage4DurationMs: number;
    stage5DurationMs: number;
    stage6DurationMs?: number;
    totalDurationMs: number;
  };
  warnings: string[];
};

export async function runPipeline(
  html: string,
  postUrl: string,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const allWarnings: string[] = [];

  // Metadata: run legacy parser for non-product fields (vendor, dates, trust_signals, etc.)
  const legacyBase = parsePpomppuPost(html, postUrl);

  // Stage 0: Locate — extract clean text
  const t0 = Date.now();
  const stage0 = await locateElements(html, postUrl);
  const stage0Ms = Date.now() - t0;
  if (stage0.warnings) allWarnings.push(...stage0.warnings);

  // Stage 1: Classify — determine post type
  const t1 = Date.now();
  const stage1 = await classifyPost(stage0);
  const stage1Ms = Date.now() - t1;
  if (stage1.warnings) allWarnings.push(...stage1.warnings);

  // Stage 2: Filter — noise removal + signal score
  const t2 = Date.now();
  const stage2 = filterNoise(stage0, stage1);
  const stage2Ms = Date.now() - t2;

  // Stage 3: LLM Extract — conditional on llmRequired
  const t3 = Date.now();
  const stage3 = await extractWithLlm(stage0, stage1, stage2);
  const stage3Ms = Date.now() - t3;
  if (stage3.warnings) allWarnings.push(...stage3.warnings);

  // Stage 4: Merge — vote + source attribution
  const t4 = Date.now();
  const stage4 = mergeProducts(stage1, stage2, stage3);
  const stage4Ms = Date.now() - t4;
  if (stage4.warnings) allWarnings.push(...stage4.warnings);

  // Stage 5: Evidence — attach evidence chain per product
  const t5 = Date.now();
  const stage5 = attachEvidence(stage4, stage1, stage2, stage3);
  const stage5Ms = Date.now() - t5;
  if (stage5.warnings) allWarnings.push(...stage5.warnings);

  // Stage 6: Dedup — optional, skip on first run or when opted out
  let stage6Ms: number | undefined;
  if (!opts.skipDedup && stage5.productsWithEvidence.length > 0) {
    const t6 = Date.now();
    const stage6 = await deduplicatePost(
      postUrl,
      stage5,
      `${stage0.titleText} ${stage0.bodyText}`.slice(0, 2000),
    );
    stage6Ms = Date.now() - t6;
    if (stage6.warnings) allWarnings.push(...stage6.warnings);
  }

  const record = convertToLegacyFormat(stage5, stage4, legacyBase);
  const totalMs = Date.now() - pipelineStart;

  let extractionSource: CompetitorAdRecord["extraction_source"];
  if (stage4.finalProducts.length > 0) {
    const srcs = new Set(stage4.finalProducts.map((p) => p.source));
    if (srcs.size === 1) {
      const src = [...srcs][0];
      extractionSource = src === "cheerio" ? "html" : "llm-text";
    } else {
      extractionSource = "mixed";
    }
  }

  return {
    record,
    extractionSource,
    stageMetrics: {
      stage0DurationMs: stage0Ms,
      stage1DurationMs: stage1Ms,
      stage2DurationMs: stage2Ms,
      stage3DurationMs: stage3Ms,
      stage4DurationMs: stage4Ms,
      stage5DurationMs: stage5Ms,
      stage6DurationMs: stage6Ms,
      totalDurationMs: totalMs,
    },
    warnings: allWarnings,
  };
}
