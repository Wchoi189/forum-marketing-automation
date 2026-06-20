import { ENV } from "../../../config/env.js";
import { validateImageForVlm } from "./image-utils.js";

type OllamaResponse = {
  response?: string;
  done?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOllamaGenerate(
  prompt: string,
  imageBase64: string | undefined,
  model: string,
  fallbackModels: string[] = [],
): Promise<{ text: string; modelUsed: string }> {
  const models = [model, ...fallbackModels].filter(Boolean);
  let lastErr: Error | null = null;

  for (const candidate of models) {
    try {
      const payload = {
        model: candidate,
        prompt,
        stream: false,
        images: imageBase64 ? [imageBase64] : undefined,
        options: { temperature: 0 },
      };

      console.log(`  [ollama] calling ${candidate} (timeout=${ENV.OLLAMA_REQUEST_TIMEOUT_MS}ms, retries=${ENV.OLLAMA_MAX_RETRIES})`);
      const maxAttempts = Math.max(1, ENV.OLLAMA_MAX_RETRIES + 1);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ENV.OLLAMA_REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(`${ENV.OLLAMA_ENDPOINT.replace(/\/$/, "")}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Ollama error ${response.status}: ${text.slice(0, 200)}`);
          }

          const json = (await response.json()) as OllamaResponse;
          const textLen = (json.response ?? "").trim().length;
          console.log(`  [ollama] ${candidate} OK (${textLen} chars)`);
          return { text: (json.response ?? "").trim(), modelUsed: candidate };
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxAttempts - 1) {
            console.log(`  [ollama] ${candidate} attempt ${attempt + 1} failed, retrying...`);
            await sleep(200 + attempt * 200);
            continue;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr ?? new Error("Unknown Ollama error");
}

function estimateOcrConfidence(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0.4;
  if (/(\d{1,3}(?:,\d{3})+|\d+)\s*원/.test(normalized)) return 0.9;
  if (normalized.length > 40) return 0.8;
  return 0.7;
}

export async function runOcr(imageBuffer: Buffer): Promise<{ text: string; confidence: number } | null> {
  const validation = validateImageForVlm(imageBuffer, 16);
  if (!validation.ok) {
    console.log(`  [runOcr] image rejected: ${(validation as any).reason}`);
    return null;
  }

  const prompt = "Extract all visible text from this image. Return plain text only.";
  const base64 = imageBuffer.toString("base64");
  const result = await callOllamaGenerate(prompt, base64, ENV.OLLAMA_OCR_MODEL, ["qwen2.5vl:3b"]);
  const text = result.text;
  const confidence = estimateOcrConfidence(text);
  return { text, confidence };
}

export { callOllamaGenerate, estimateOcrConfidence };
