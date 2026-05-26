import { ENV } from "../../../../config/env.js";
import { callOllamaGenerate } from "../../extraction/ocr.js";
import { buildClassifyPrompt } from "./classify-prompt.js";
import type { Stage0Output } from "../stage0-locate/types.js";
import type { PostType, Stage1Output } from "./types.js";

const VALID_POST_TYPES = new Set<PostType>([
  "direct_offer",
  "affiliate",
  "promo_code",
  "comparison",
  "unknown",
]);

const SKIP_EXTRACTION_TYPES = new Set<PostType>(["affiliate", "promo_code"]);

function extractJson(raw: string): string {
  // Strip markdown code fences if present
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find first { ... } block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

type RawClassifyJson = {
  postType?: unknown;
  confidence?: unknown;
  evidence?: { excerpt?: unknown; reasoning?: unknown };
  affiliateTarget?: unknown;
  promoCode?: unknown;
  referencePrice?: unknown;
};

export function parseClassifyResponse(raw: string): Stage1Output {
  const warnings: string[] = [];

  let parsed: RawClassifyJson;
  try {
    parsed = JSON.parse(extractJson(raw)) as RawClassifyJson;
  } catch {
    return {
      postType: "unknown",
      classifierConfidence: 0,
      classifierEvidence: { excerpt: "", reasoning: "JSON parse failed" },
      skipExtraction: false,
      warnings: [`classify_parse_error: ${raw.slice(0, 200)}`],
    };
  }

  const postType: PostType = VALID_POST_TYPES.has(parsed.postType as PostType)
    ? (parsed.postType as PostType)
    : "unknown";

  if (!VALID_POST_TYPES.has(parsed.postType as PostType)) {
    warnings.push(`classify_unknown_type: ${String(parsed.postType)}`);
  }

  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const evidence = parsed.evidence ?? {};
  const excerpt = typeof evidence.excerpt === "string" ? evidence.excerpt : "";
  const reasoning = typeof evidence.reasoning === "string" ? evidence.reasoning : "";

  const output: Stage1Output = {
    postType,
    classifierConfidence: confidence,
    classifierEvidence: { excerpt, reasoning },
    skipExtraction: SKIP_EXTRACTION_TYPES.has(postType),
  };

  if (postType === "affiliate" && typeof parsed.affiliateTarget === "string" && parsed.affiliateTarget) {
    output.affiliateTarget = parsed.affiliateTarget;
  }

  if (postType === "promo_code" && typeof parsed.promoCode === "string" && parsed.promoCode) {
    output.promoCode = parsed.promoCode;
  }

  if (postType === "comparison" && typeof parsed.referencePrice === "number") {
    output.referencePrice = Math.round(parsed.referencePrice);
  }

  if (warnings.length > 0) output.warnings = warnings;

  return output;
}

export async function classifyPost(stage0Output: Stage0Output): Promise<Stage1Output> {
  const prompt = buildClassifyPrompt(stage0Output.titleText, stage0Output.bodyText);

  let raw: string;
  try {
    const result = await callOllamaGenerate(
      prompt,
      undefined,
      ENV.OLLAMA_CLASSIFIER_MODEL,
      ["llama3.1:latest", "aya-expanse:latest"],
    );
    raw = result.text;
  } catch (err) {
    return {
      postType: "unknown",
      classifierConfidence: 0,
      classifierEvidence: { excerpt: "", reasoning: "Ollama call failed" },
      skipExtraction: false,
      warnings: [`classify_ollama_error: ${(err as Error).message}`],
    };
  }

  return parseClassifyResponse(raw);
}
