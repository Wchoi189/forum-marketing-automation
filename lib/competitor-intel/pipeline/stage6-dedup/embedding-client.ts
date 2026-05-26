import { ENV } from "../../../../config/env.js";

type OllamaEmbedResponse = {
  embedding?: number[];
  embeddings?: number[][];
};

export async function getEmbedding(text: string, model?: string): Promise<number[]> {
  const m = model ?? ENV.OLLAMA_EMBED_MODEL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENV.OLLAMA_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ENV.OLLAMA_ENDPOINT.replace(/\/$/, "")}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, prompt: text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Ollama embeddings error ${response.status}: ${body.slice(0, 200)}`);
    }

    const json = (await response.json()) as OllamaEmbedResponse;
    const embedding = json.embedding ?? json.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Ollama returned empty embedding");
    }
    return embedding;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
