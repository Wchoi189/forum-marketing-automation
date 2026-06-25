/**
 * Disk-based LLM response cache keyed by MD5(content-text).
 * Stores results as individual JSON files under artifacts/competitor-ads/llm-cache/.
 * Entries older than 7 days are treated as expired.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ENV } from "../../../config/env.js";

const CACHE_DIR = path.join(ENV.ARTIFACTS_DIR, "competitor-ads", "llm-cache");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheEntry = {
  raw: string;
  modelUsed: string;
  cachedAt: number;
};

async function ensureCacheDir(): Promise<void> {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
}

function keyFor(contentText: string, model: string): string {
  return createHash("md5").update(`${model}::${contentText}`).digest("hex");
}

export async function cacheGet(
  contentText: string,
  model: string,
): Promise<{ raw: string; modelUsed: string } | null> {
  try {
    await ensureCacheDir();
    const key = keyFor(contentText, model);
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const raw = await fsp.readFile(filePath, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;

    if (Date.now() - entry.cachedAt > TTL_MS) {
      await fsp.unlink(filePath).catch(() => {});
      return null;
    }

    return { raw: entry.raw, modelUsed: entry.modelUsed };
  } catch {
    return null;
  }
}

export async function cachePut(
  contentText: string,
  model: string,
  result: { raw: string; modelUsed: string },
): Promise<void> {
  try {
    await ensureCacheDir();
    const key = keyFor(contentText, model);
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const entry: CacheEntry = {
      raw: result.raw,
      modelUsed: result.modelUsed,
      cachedAt: Date.now(),
    };
    await fsp.writeFile(filePath, JSON.stringify(entry), "utf-8");
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function cacheStats(): Promise<{ total: number; expired: number }> {
  try {
    await ensureCacheDir();
    const files = await fsp.readdir(CACHE_DIR).catch(() => []);
    let expired = 0;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fsp.readFile(path.join(CACHE_DIR, f), "utf-8");
        const entry = JSON.parse(raw) as CacheEntry;
        if (Date.now() - entry.cachedAt > TTL_MS) expired++;
      } catch {
        expired++;
      }
    }
    return { total: files.filter((f) => f.endsWith(".json")).length, expired };
  } catch {
    return { total: 0, expired: 0 };
  }
}
