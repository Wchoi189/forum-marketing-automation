import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Stage5Output } from "../stage5-evidence/types.js";
import { cosineSimilarity, getEmbedding } from "./embedding-client.js";
import type { Stage6Output, StoredEmbedding } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBEDDINGS_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "artifacts", "competitor-ads", "embeddings");
const EMBEDDINGS_INDEX = path.join(EMBEDDINGS_DIR, "embeddings-index.json");

const DUPLICATE_THRESHOLD = 0.95;
const SIMILAR_THRESHOLD = 0.85;

function loadStoredEmbeddings(): StoredEmbedding[] {
  try {
    if (!fs.existsSync(EMBEDDINGS_INDEX)) return [];
    const raw = fs.readFileSync(EMBEDDINGS_INDEX, "utf-8");
    return JSON.parse(raw) as StoredEmbedding[];
  } catch {
    return [];
  }
}

function saveEmbedding(entry: StoredEmbedding): void {
  try {
    fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });
    const existing = loadStoredEmbeddings();
    const updated = existing.filter((e) => e.postId !== entry.postId).concat(entry);
    fs.writeFileSync(EMBEDDINGS_INDEX, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // Non-fatal: dedup storage failure does not block pipeline
  }
}

function buildContentText(stage5Output: Stage5Output): string {
  const excerpts = stage5Output.productsWithEvidence
    .map((p) => [p.name_evidence.excerpt, p.price_evidence?.excerpt, p.duration_evidence?.excerpt]
      .filter(Boolean).join(" "))
    .join(" | ");
  return excerpts || stage5Output.productsWithEvidence.map((p) => p.name).join(", ");
}

/**
 * Check similarity against stored embeddings.
 * Exported for unit testing with pre-computed embeddings.
 */
export function checkSimilarity(
  embedding: number[],
  stored: StoredEmbedding[],
): { duplicateIds: string[]; similarityScores: { postId: string; score: number }[] } {
  const duplicateIds: string[] = [];
  const similarityScores: { postId: string; score: number }[] = [];

  for (const entry of stored) {
    const score = cosineSimilarity(embedding, entry.embedding);
    if (score >= SIMILAR_THRESHOLD) {
      similarityScores.push({ postId: entry.postId, score });
      if (score >= DUPLICATE_THRESHOLD) {
        duplicateIds.push(entry.postId);
      }
    }
  }

  return { duplicateIds, similarityScores };
}

export async function deduplicatePost(
  postUrl: string,
  stage5Output: Stage5Output,
  contentText?: string,
): Promise<Stage6Output> {
  const warnings: string[] = [];

  if (stage5Output.productsWithEvidence.length === 0) {
    return { uniquePosts: true, duplicateIds: [], similarityScores: [], warnings: ["dedup_skip: no products"] };
  }

  const text = contentText ?? buildContentText(stage5Output);

  let embedding: number[];
  try {
    embedding = await getEmbedding(text);
  } catch (err) {
    warnings.push(`dedup_embed_error: ${(err as Error).message}`);
    return { uniquePosts: true, duplicateIds: [], similarityScores: [], warnings };
  }

  const stored = loadStoredEmbeddings().filter((e) => e.postId !== postUrl);
  const { duplicateIds, similarityScores } = checkSimilarity(embedding, stored);

  saveEmbedding({ postId: postUrl, embedding, timestamp: new Date().toISOString() });

  return {
    uniquePosts: duplicateIds.length === 0,
    duplicateIds,
    similarityScores,
    embedding,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
