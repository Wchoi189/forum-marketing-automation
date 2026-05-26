/**
 * Live regression tests: run full 7-stage pipeline against real Ppomppu HTML.
 *
 * Requires:
 *   - Ollama at OLLAMA_ENDPOINT (default: http://ollama:11434)
 *   - HTML fixtures in artifacts/competitor-ads/<run>/raw_html/
 *
 * Skipped automatically if either Ollama or the HTML fixture is unavailable.
 * Run individually with:
 *   npx tsx --test tests/unit/competitor-intel/pipeline-live-regression.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "../../../lib/competitor-intel/pipeline/orchestrator.js";
import { ENV } from "../../../config/env.js";

async function ollamaAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${ENV.OLLAMA_ENDPOINT.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

const ARTIFACT_ROOTS = [
  path.join(process.cwd(), "artifacts", "competitor-ads", "live-20260511", "raw_html"),
  path.join(process.cwd(), "artifacts", "competitor-ads", "test-pipeline-1page-v2", "raw_html"),
];
const MARKET_DATA_ROOTS = [
  path.join(process.cwd(), "artifacts", "competitor-ads", "market-data-2026-05-26-b", "raw_html"),
  path.join(process.cwd(), "artifacts", "competitor-ads", "market-data-2026-05-26", "raw_html"),
];

function findHtml(postId: string, roots: string[]): string | null {
  for (const root of roots) {
    const p = path.join(root, `${postId}.html`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── eb67ebba985c: implicit names → LLM resolves (유튜브 프리미엄 → 가족계정) ──
// gemma2:27b retry can take up to ~120s; timeout set to 180s.

test("live regression eb67ebba985c: pipeline completes without crash for 기프티콘 post", { timeout: 180_000 }, async (t) => {
  const [avail, htmlPath] = await Promise.all([ollamaAvailable(), Promise.resolve(findHtml("eb67ebba985c", ARTIFACT_ROOTS))]);
  if (!avail) { t.skip("Ollama not available"); return; }
  if (!htmlPath) { t.skip("HTML fixture not found"); return; }

  const html = fs.readFileSync(htmlPath, "utf-8");
  const postUrl = "https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&no=eb67ebba985c";

  const result = await runPipeline(html, postUrl, { skipDedup: true });
  console.log(`  eb67ebba985c products: ${JSON.stringify(result.record.products)}`);
  console.log(`  confidence: ${result.record.confidence}, source: ${result.extractionSource}`);
  console.log(`  warnings: ${result.warnings.join(", ") || "none"}`);

  // Implicit-name posts may produce 0 pipeline products (Zod null from LLM → falls back to legacy).
  // Primary assertion: pipeline completes without throwing.
  assert.ok(result.record.confidence >= 0, "confidence should be non-negative");
  assert.ok(Array.isArray(result.record.products), "products should be an array");
});

// ── 551b849c00f1: 구독트리 — LLM supplements; fallback to legacy if pipeline finds 0 ──
// Note: stage2 signalScore (~0.35) is below LLM_SKIP_THRESHOLD (0.85), so LLM runs.
// If LLM + Cheerio both produce 0 catalog-valid products, adapter falls back to legacy parser.

test("live regression 551b849c00f1: pipeline completes for 구독트리 post", { timeout: 180_000 }, async (t) => {
  const [avail, htmlPath] = await Promise.all([ollamaAvailable(), Promise.resolve(findHtml("551b849c00f1", ARTIFACT_ROOTS))]);
  if (!avail) { t.skip("Ollama not available"); return; }
  if (!htmlPath) { t.skip("HTML fixture not found"); return; }

  const html = fs.readFileSync(htmlPath, "utf-8");
  const postUrl = "https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&no=551b849c00f1";

  const result = await runPipeline(html, postUrl, { skipDedup: true });
  console.log(`  551b849c00f1 products: ${JSON.stringify(result.record.products)}`);
  console.log(`  confidence: ${result.record.confidence}, source: ${result.extractionSource}`);

  assert.ok(result.record.confidence >= 0, "confidence should be non-negative");
  assert.ok(Array.isArray(result.record.products), "products should be an array");
});

// ── 9446cd3682da: 구독트리 — Cheerio wins, junk 'OTT 구독' rejected ─────────

test("live regression 9446cd3682da: stage4 rejects junk, Cheerio products survive", { timeout: 180_000 }, async (t) => {
  const [avail, htmlPath] = await Promise.all([ollamaAvailable(), Promise.resolve(findHtml("9446cd3682da", ARTIFACT_ROOTS))]);
  if (!avail) { t.skip("Ollama not available"); return; }
  if (!htmlPath) { t.skip("HTML fixture not found"); return; }

  const html = fs.readFileSync(htmlPath, "utf-8");
  const postUrl = "https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&no=9446cd3682da";

  const result = await runPipeline(html, postUrl, { skipDedup: true });
  console.log(`  9446cd3682da products: ${JSON.stringify(result.record.products)}`);
  console.log(`  confidence: ${result.record.confidence}, source: ${result.extractionSource}`);

  const productNames = result.record.products.map((p: { name: string }) => p.name);
  assert.ok(!productNames.includes("OTT 구독"), `junk 'OTT 구독' should not appear in final products, got: ${JSON.stringify(productNames)}`);
  assert.ok(result.record.products.length > 0, "should yield at least one product after junk rejection");
});

// ── 0aea7978e7b3: SharePlan noise-dominant — LLM runs with reduced context ───

test("live regression 0aea7978e7b3: noise-dominant post processed without crash", { timeout: 180_000 }, async (t) => {
  const [avail, htmlPath] = await Promise.all([ollamaAvailable(), Promise.resolve(findHtml("0aea7978e7b3", MARKET_DATA_ROOTS))]);
  if (!avail) { t.skip("Ollama not available"); return; }
  if (!htmlPath) { t.skip("HTML fixture not found"); return; }

  const html = fs.readFileSync(htmlPath, "utf-8");
  const postUrl = "https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&no=0aea7978e7b3";

  const result = await runPipeline(html, postUrl, { skipDedup: true });
  console.log(`  0aea7978e7b3 products: ${JSON.stringify(result.record.products)}`);
  console.log(`  confidence: ${result.record.confidence}, source: ${result.extractionSource}`);
  console.log(`  warnings: ${result.warnings.join(", ") || "none"}`);

  // Noise-dominant post: pipeline should complete without throwing; products may be 0
  assert.ok(result.record.confidence >= 0, "confidence should be >= 0");
  assert.ok(Array.isArray(result.record.products), "products should be an array");
});
