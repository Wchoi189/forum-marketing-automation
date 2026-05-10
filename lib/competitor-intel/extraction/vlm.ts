import { ENV } from "../../../config/env.js";
import { callOllamaGenerate } from "./ocr.js";
import { validateImageForVlm } from "./image-utils.js";

export function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function runVlmParse(
  imageBuffer: Buffer,
  ocrText: string,
): Promise<{ parsed: Record<string, unknown> | null; raw: string }> {
  const validation = validateImageForVlm(imageBuffer, 16);
  if (!validation.ok) {
    console.log(`  [runVlmParse] image rejected: ${validation.reason}`);
    return { parsed: null, raw: "" };
  }

  const prompt = [
    "You are a schema-constrained parser.",
    "Extract competitor ad details from the image and OCR text.",
    "Return a JSON object with: products (array of objects with name, plan_tier, duration_months, price_krw, price_per_month_krw, constraints),",
    "terms (payment_method, delivery_method, refund_policy, notes), account_type, region, bundle, promo, conditions, contact, notes.",
    "Use integers for numeric fields. Omit fields that are not present.",
    `OCR text: ${ocrText.slice(0, 2000)}`,
  ].join("\n");

  const base64 = imageBuffer.toString("base64");
  const result = await callOllamaGenerate(prompt, base64, ENV.OLLAMA_OCR_MODEL, ["qwen2.5vl:3b"]);
  const raw = result.text;
  const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
  return { parsed, raw };
}
