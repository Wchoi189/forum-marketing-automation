/**
 * Crawlee request handler for competitor ad extraction.
 *
 * Crawlee manages browser lifecycle, retries, and concurrency.
 * This handler focuses on: navigation → HTML parse → OCR/VLM → Dataset push.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import type { PlaywrightCrawlingContext } from "crawlee";
import { Dataset } from "crawlee";
import type { VendorRegistry as VendorRegistryType } from "../index.js";
import { parsePpomppuPost } from "../../competitor-ad-parser/index.js";
import { cleanProductName, deduplicateProducts } from "../../competitor-ad-parser/product-name-utils.js";
import { subtree } from "../../parser/index.js";
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from "../../playwright/browser-eval-polyfill.js";
import type { CompetitorAdRecord, AdProduct, EvidenceSource, AdEvidence } from "../types.js";
import { postIdFromUrl, buildRecordBase } from "../storage/record-builder.js";
import { chooseContentSelector, collectImages, extractTextBlocks, findPostedAt, extractProductsFromText } from "../extraction/pipeline.js";
import { runOcr } from "../extraction/ocr.js";
import { runVlmParse } from "../extraction/vlm.js";
import { validateVlmAgainstHtml } from "../extraction/validation.js";
import { runPipeline } from "../pipeline/orchestrator.js";

type HandlerDeps = {
  artifactRoot: string;
  registry: VendorRegistryType;
};

function clampText(value: string, maxLen: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

async function extractWithBrowserFallback(
  page: PlaywrightCrawlingContext["page"],
  postId: string,
  artifactRoot: string,
  postUrl: string,
): Promise<{
  products: AdProduct[];
  extractionSource: CompetitorAdRecord["extraction_source"];
  confidence: number;
  evidenceSources: EvidenceSource[];
  postedAt: { iso: string; raw?: string } | null;
  pageTitle: string;
  parsedHtml: ReturnType<typeof parsePpomppuPost>;
  imageBuffers: Awaited<ReturnType<typeof collectImages>>;
}> {
  const root = artifactRoot;
  const pageTitle = (await page.title()) || "";
  const html = await page.content();
  const rawHtmlPath = path.join(root, "raw_html", `${postId}.html`);
  await fsp.writeFile(rawHtmlPath, html, "utf-8");

  // Legacy parser for metadata fields (vendor, landing_url, trust_signals, etc.)
  const parsed = parsePpomppuPost(html, postUrl);

  // Primary path: 7-stage pipeline (text extraction, no browser needed)
  try {
    const pipelineResult = await runPipeline(html, postUrl, { skipDedup: true });
    const rec = pipelineResult.record;
    if (rec.products.length > 0 && rec.confidence >= 0.6) {
      console.log(`  [pipeline] extracted ${rec.products.length} products, confidence=${rec.confidence.toFixed(2)}, source=${pipelineResult.extractionSource}`);
      return {
        products: rec.products as AdProduct[],
        extractionSource: pipelineResult.extractionSource ?? "mixed",
        confidence: rec.confidence,
        evidenceSources: [],
        postedAt: rec.posted_at ? { iso: rec.posted_at, raw: rec.posted_at_raw || undefined } : null,
        pageTitle,
        parsedHtml: rec,
        imageBuffers: [],
      };
    }
    console.log(`  [pipeline] low confidence or no products (${rec.products.length} products, conf=${rec.confidence.toFixed(2)}), falling back to browser extraction`);
  } catch (err) {
    console.warn(`  [pipeline] error, falling back to browser extraction: ${err}`);
  }

  // Fallback: browser subtree + OCR/VLM for image-heavy or low-signal posts
  const rootSelector = await chooseContentSelector(page);
  const snapshot = await subtree(page, rootSelector, {
    maxDepth: 5,
    maxSiblingsPerNode: 40,
    maxTotalNodes: 400,
    maxTextLengthPerNode: 160,
  });

  const htmlEvidence = extractTextBlocks(snapshot.nodes);
  let imageBuffers = await collectImages(page, rootSelector, postId);
  const postedAt = findPostedAt(htmlEvidence.map((s) => s.excerpt))
    || (parsed.posted_at ? { iso: parsed.posted_at, raw: parsed.posted_at_raw } : null);

  const { products: htmlProducts } = extractProductsFromText(htmlEvidence);

  const useHtml = htmlProducts.length > 0;
  let products: AdProduct[] = useHtml ? htmlProducts : parsed.products;
  let extractionSource: CompetitorAdRecord["extraction_source"] = useHtml ? "html" : undefined;
  let confidence = useHtml ? 0.7 : Math.max(0, parsed.confidence);

  const ocrEvidence: EvidenceSource[] = [];
  const vlmEvidence: EvidenceSource[] = [];
  let vlmProducts: AdProduct[] = [];

  if (imageBuffers.length === 0 && htmlProducts.length === 0) {
    const screenshotPath = path.join(root, "images", postId, `${postId}-screenshot.jpg`);
    await fsp.mkdir(path.dirname(screenshotPath), { recursive: true });
    const screenshot = await page.screenshot({ fullPage: true, type: "jpeg", quality: 70 });
    await fsp.writeFile(screenshotPath, screenshot);
    imageBuffers.push({ id: `${postId}-screenshot`, buffer: Buffer.from(screenshot), ext: ".jpg" });
  }

  for (const image of imageBuffers) {
    const imgPath = path.join(root, "images", postId, `${image.id}${image.ext}`);
    await fsp.mkdir(path.dirname(imgPath), { recursive: true });
    await fsp.writeFile(imgPath, image.buffer);
  }

  for (const image of imageBuffers) {
    try {
      const ocr = await runOcr(image.buffer);
      if (!ocr) continue;

      const ocrPath = path.join(root, "ocr", postId, `${image.id}.txt`);
      await fsp.mkdir(path.dirname(ocrPath), { recursive: true });
      await fsp.writeFile(ocrPath, ocr.text, "utf-8");

      const ocrExcerpt = clampText(ocr.text, 160);
      if (ocrExcerpt.length > 0) {
        ocrEvidence.push({ type: "ocr", excerpt: ocrExcerpt, image_ref: image.id });
      }

      if (ocr.confidence < 0.75) {
        const vlm = await runVlmParse(image.buffer, ocr.text);
        const vlmPath = path.join(root, "vlm", postId, `${image.id}.json`);
        await fsp.mkdir(path.dirname(vlmPath), { recursive: true });
        await fsp.writeFile(vlmPath, JSON.stringify({ raw: vlm.raw, parsed: vlm.parsed }, null, 2));

        const vlmExcerpt = clampText(vlm.raw, 160);
        if (vlmExcerpt.length > 0) {
          vlmEvidence.push({ type: "vlm", excerpt: vlmExcerpt, image_ref: image.id });
        }

        if (vlm.parsed && Array.isArray(vlm.parsed.products)) {
          const parsedProducts = (vlm.parsed.products as Record<string, unknown>[])
            .filter((p): p is Record<string, unknown> => p && typeof p === "object" && typeof (p as { name?: string }).name === "string")
            .map((p) => {
              const name = cleanProductName(String(p.name).trim());
              const product: AdProduct = { name };
              if (typeof p.plan_tier === "string") product.plan_tier = p.plan_tier;
              if (typeof p.duration_months === "number") product.duration_months = Math.round(p.duration_months);
              if (typeof p.price_krw === "number") product.price_krw = Math.round(p.price_krw);
              if (typeof p.price_per_month_krw === "number") product.price_per_month_krw = Math.round(p.price_per_month_krw);
              if (typeof p.constraints === "string") product.constraints = p.constraints;
              return product;
            })
            .filter((p) => p.name.length > 0);
          if (parsedProducts.length > 0) {
            vlmProducts = parsedProducts;
          }
        }
      }

      if (ocr.confidence >= 0.85 && ocr.text.trim().length > 0 && htmlProducts.length === 0) {
        const fromOcr = extractProductsFromText([{ type: "ocr", excerpt: clampText(ocr.text, 160), image_ref: image.id }]);
        if (fromOcr.products.length > 0) {
          products = fromOcr.products;
          confidence = Math.max(confidence, 0.8);
          extractionSource = extractionSource ? "mixed" : "ocr";
        }
      }
    } catch {
      // OCR/VLM failure is non-fatal; continue with next image
    }
  }

  if (vlmProducts.length > 0) {
    const { validated } = validateVlmAgainstHtml(vlmProducts, parsed);
    products = validated;
    extractionSource = extractionSource ? "mixed" : "vlm";
    confidence = Math.max(confidence, 0.85);
  }

  const evidenceSources = [...htmlEvidence, ...ocrEvidence, ...vlmEvidence];

  return {
    products,
    extractionSource,
    confidence,
    evidenceSources,
    postedAt,
    pageTitle,
    parsedHtml: parsed,
    imageBuffers,
  };
}

/**
 * Crawlee request handler. Resolves vendor strategy from URL, extracts ad data,
 * and pushes to Crawlee Dataset.
 */
export function createRequestHandler(deps: HandlerDeps) {
  return async function handler(context: PlaywrightCrawleeContext): Promise<void> {
    const { page, request } = context;
    const { artifactRoot, registry } = deps;

    // Inject polyfill needed for page.evaluate() (dom-projector subtree)
    await page.context().addInitScript({ content: BROWSER_EVAL_NAME_POLYFILL_SCRIPT });
    // Re-navigate so polyfill is active on the page context
    await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const strategy = registry.resolveFromUrl(request.url);
    const vendor = strategy?.vendorId ?? "unknown";
    const postId = postIdFromUrl(request.url);
    const runId = (request.userData as { runId?: string }).runId ?? "unknown";
    const notesOverride = (request.userData as { notesOverride?: string }).notesOverride;
    const authorFromBoard = (request.userData as { authorName?: string }).authorName;

    // Use board-discovered author as the actual vendor; fall back to platform name
    const effectiveVendor = authorFromBoard || vendor;
    console.log(`Processing: ${effectiveVendor} / ${postId}`);

    const result = await extractWithBrowserFallback(page, postId, artifactRoot, request.url);

    if (!result.postedAt) {
      throw new Error(`Missing posted_at; no parseable date found for ${postId}`);
    }

    if (result.products.length === 0) {
      throw new Error(`Missing products; no structured product rows extracted for ${postId}`);
    }

    const sources = result.evidenceSources.length > 0
      ? result.evidenceSources.filter((s) => s.excerpt.trim().length > 0)
      : [];

    if (sources.length === 0 && result.extractionSource !== "ocr" && result.extractionSource !== "vlm") {
      // Pipeline or deterministic path — evidence embedded per-product, no raw sources required
    } else if (sources.length === 0) {
      throw new Error(`Missing evidence sources; no non-empty excerpts captured for ${postId}`);
    }

    const evidence: AdEvidence = { sources: sources.length > 0 ? sources : [] };

    // Final pass: clean all product names and deduplicate
    const cleanedProducts = deduplicateProducts(
      result.products.map((p) => ({ ...p, name: cleanProductName(p.name) }))
    ).filter((p) => p.name.length > 0);

    const record = buildRecordBase({
      runId,
      vendor: effectiveVendor,
      authorName: result.parsedHtml.vendor || undefined,
      postUrl: request.url,
      postTitle: result.pageTitle.trim() || "(untitled)",
      postedAt: result.postedAt.iso,
      postedAtRaw: result.postedAt.raw,
      capturedAt: new Date().toISOString(),
      products: cleanedProducts,
      evidence,
      extractionSource: result.extractionSource || "mixed",
      confidence: result.confidence,
      notes: notesOverride,
    });

    if (result.parsedHtml.account_type && !record.account_type) {
      record.account_type = result.parsedHtml.account_type;
    }

    await Dataset.pushData(record);
    console.log(`  [${postId}] pushed to dataset: ${cleanedProducts.length} products, source=${result.extractionSource}`);
  };
}
