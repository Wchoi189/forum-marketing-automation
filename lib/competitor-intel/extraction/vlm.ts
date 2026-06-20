import { ENV } from "../../../config/env.js";
import { callOllamaGenerate } from "./ocr.js";
import { validateImageForVlm } from "./image-utils.js";

export function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const objStart = trimmed.indexOf("{");
    const objEnd = trimmed.lastIndexOf("}");
    const arrStart = trimmed.indexOf("[");
    const arrEnd = trimmed.lastIndexOf("]");

    // Prefer array when it starts before the first object (LLM top-level array pattern)
    if (arrStart >= 0 && arrEnd > arrStart && (objStart < 0 || arrStart < objStart)) {
      try { return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)); } catch { /* fall through */ }
    }
    if (objStart >= 0 && objEnd > objStart) {
      try { return JSON.parse(trimmed.slice(objStart, objEnd + 1)); } catch { /* fall through */ }
    }
    // Try array last if object failed
    if (arrStart >= 0 && arrEnd > arrStart) {
      try { return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)); } catch { return null; }
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
    console.log(`  [runVlmParse] image rejected: ${(validation as any).reason}`);
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
