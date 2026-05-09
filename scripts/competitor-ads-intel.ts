/**
 * Competitor Ads Intelligence (Manual)
 *
 * Runs a manual, fail-closed extraction job over a CSV list of vendor/post URLs.
 * Outputs a gzip JSONL dataset plus raw evidence artifacts.
 *
 * Usage:
 *   npx tsx scripts/competitor-ads-intel.ts --input-csv <path> [--run-id <id>] [--rate-limit-rps <n>]
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { ENV } from "../config/env.js";
import { parsePpomppuPost } from "../lib/competitor-ad-parser/index.js";
import type { PpomppuParsedRecord } from "../lib/competitor-ad-parser/index.js";
import { subtree } from "../lib/parser/index.js";
import type { ProjectedNode } from "../lib/parser/types.js";
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from "../lib/playwright/browser-eval-polyfill.js";
import { openDatabase, isRecordKnown, insertRecord, upsertVendorProfile, listVendorProfiles, getRecordCount } from "../lib/competitor-ad-sqlite.js";

// ── Types ────────────────────────────────────────────────────────────────────

type CsvRow = {
  vendor: string;
  postUrl: string;
  notesOverride?: string;
};

type EvidenceSource = {
  type: "html" | "ocr" | "vlm";
  excerpt: string;
  image_ref?: string;
  source_block?: string;
};

type AdProduct = {
  name: string;
  plan_tier?: string;
  duration_months?: number;
  price_krw?: number;
  price_per_month_krw?: number;
  constraints?: string;
};

type AdEvidence = {
  sources: EvidenceSource[];
  field_evidence?: Record<string, EvidenceSource[]>;
};

type CompetitorAdRecord = {
  record_id: string;
  run_id: string;
  vendor: string;
  author_name?: string;
  post_url: string;
  post_title: string;
  posted_at: string;
  posted_at_raw?: string;
  captured_at: string;
  products: AdProduct[];
  terms?: Record<string, string>;
  account_type?: string;
  region?: string;
  bundle?: string;
  promo?: string;
  conditions?: string;
  contact?: string;
  notes?: string;
  confidence?: number;
  extraction_source?: "html" | "ocr" | "vlm" | "mixed";
  evidence: AdEvidence;
};

type RunError = {
  post_url: string;
  reason: string;
  artifact_ref?: string;
};

// ── CLI args ─────────────────────────────────────────────────────────────────

type CliArgs = {
  inputCsv: string;
  runId: string;
  rateLimitRps: number;
  showVendors: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args.set(key.slice(2), "true");
    } else {
      args.set(key.slice(2), value);
      i++;
    }
  }

  const showVendors = args.has("show-vendors");

  if (showVendors) {
    return { inputCsv: "", runId: "", rateLimitRps: 1, showVendors };
  }

  const inputCsv = args.get("input-csv");
  if (!inputCsv) {
    console.error("Missing required --input-csv <path>");
    process.exit(1);
  }

  const runId = args.get("run-id") || new Date().toISOString().replace(/[:.]/g, "-");
  const rateLimitRaw = args.get("rate-limit-rps") || "1";
  const rateLimitRps = Number(rateLimitRaw);
  if (!Number.isFinite(rateLimitRps) || rateLimitRps <= 0) {
    console.error("--rate-limit-rps must be a positive number");
    process.exit(1);
  }

  return { inputCsv, runId, rateLimitRps, showVendors };
}

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(content: string): string[][] {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function loadCsvRows(inputCsv: string): CsvRow[] {
  const raw = fs.readFileSync(inputCsv, "utf-8");
  const rows = parseCSV(raw);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  const indexOf = (name: string) => header.findIndex((cell) => cell.trim() === name);
  const vendorIdx = indexOf("vendor_id");
  const postIdx = indexOf("post_url");
  const notesIdx = indexOf("notes_override");

  if (vendorIdx < 0 || postIdx < 0) {
    throw new Error("CSV must include vendor_id and post_url columns");
  }

  const out: CsvRow[] = [];
  for (const row of dataRows) {
    const vendor = row[vendorIdx]?.trim();
    const postUrl = row[postIdx]?.trim();
    if (!vendor || !postUrl) continue;
    const notesOverride = notesIdx >= 0 ? row[notesIdx]?.trim() : undefined;
    out.push({ vendor, postUrl, notesOverride });
  }
  return out;
}

// ── Paths / artifacts ────────────────────────────────────────────────────────

function artifactRoot(runId: string): string {
  return path.join(ENV.PROJECT_ROOT, "artifacts", "competitor-ads", runId);
}

function dataOutputPath(runId: string): string {
  return path.join(artifactRoot(runId), "data", "records.jsonl.gz");
}

function runSummaryPath(runId: string): string {
  return path.join(artifactRoot(runId), "data", "run-summary.json");
}

function postIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function recordIdFrom(postUrl: string, vendor: string): string {
  return createHash("sha256").update(`${vendor}|${postUrl}`).digest("hex").slice(0, 16);
}

async function ensureArtifactDirs(runId: string): Promise<void> {
  const root = artifactRoot(runId);
  const dirs = [
    root,
    path.join(root, "data"),
    path.join(root, "raw_html"),
    path.join(root, "images"),
    path.join(root, "ocr"),
    path.join(root, "vlm"),
    path.join(root, "logs"),
  ];
  await Promise.all(dirs.map((dir) => fsp.mkdir(dir, { recursive: true })));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampText(value: string, maxLen: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function extractTextBlocks(nodes: ProjectedNode[]): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  const walk = (node: ProjectedNode): void => {
    const text = clampText(node.text || node.name || "", 160);
    if (text.length >= 2) {
      sources.push({ type: "html", excerpt: text, source_block: node.path });
    }
    for (const child of node.children) {
      walk(child);
    }
  };

  for (const node of nodes) walk(node);
  return sources;
}

function findPostedAt(texts: string[]): { iso: string; raw?: string } | null {
  const joined = texts.join("\n");
  const patterns = [
    /\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\b/,
    /\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/,
  ];

  for (const pattern of patterns) {
    const match = joined.match(pattern);
    if (!match) continue;
    const [raw, y, mo, d, h, mi, s] = match;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h ? h.padStart(2, "0") : "00"}:${mi ? mi.padStart(2, "0") : "00"}:${s ? s.padStart(2, "0") : "00"}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return { iso: parsed.toISOString(), raw };
    }
  }
  return null;
}

function extractProductsFromText(texts: EvidenceSource[]): { products: AdProduct[]; evidence: EvidenceSource[] } {
  const products: AdProduct[] = [];
  const evidence: EvidenceSource[] = [];

  for (const block of texts) {
    const text = block.excerpt;
    const priceMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
    const durationMatch = text.match(/(\d{1,2})\s*개월/);
    const hasSignal = Boolean(priceMatch || durationMatch);
    if (!hasSignal) continue;

    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined;
    const duration = durationMatch ? Number(durationMatch[1]) : undefined;

    let name = text
      .replace(/\d{1,3}(?:,\d{3})+\s*원/g, "")
      .replace(/\d+\s*원/g, "")
      .replace(/\d{1,2}\s*개월/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!name) name = text;

    const product: AdProduct = { name: clampText(name, 120) };
    if (duration) product.duration_months = duration;
    if (price !== undefined) product.price_krw = price;
    if (price !== undefined && duration) {
      product.price_per_month_krw = Math.round(price / duration);
    }

    products.push(product);
    evidence.push(block);
  }

  return { products, evidence };
}

// ── Ollama OCR/VLM ───────────────────────────────────────────────────────────

type OllamaResponse = {
  response?: string;
  done?: boolean;
};

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

async function runOcr(imageBuffer: Buffer): Promise<{ text: string; confidence: number } | null> {
  // Safety net: reject images too small for the VLM before making an API call
  const validation = validateImageForVlm(imageBuffer, 16);
  if (!validation.ok) {
    console.log(`  [runOcr] image rejected: ${validation.reason}`);
    return null;
  }

  const prompt = "Extract all visible text from this image. Return plain text only.";
  const base64 = imageBuffer.toString("base64");
  const result = await callOllamaGenerate(prompt, base64, ENV.OLLAMA_OCR_MODEL, ["qwen2.5vl:3b"]);
  const text = result.text;
  const confidence = estimateOcrConfidence(text);
  return { text, confidence };
}

function extractJsonObject(raw: string): unknown | null {
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

async function runVlmParse(imageBuffer: Buffer, ocrText: string): Promise<{ parsed: Record<string, unknown> | null; raw: string }> {
  // Safety net: reject images too small for the VLM before making an API call
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

// ── Image handling ───────────────────────────────────────────────────────────

type ImageBuffer = { id: string; buffer: Buffer; ext: string; src?: string };

// ── Extraction pipeline ──────────────────────────────────────────────────────

async function chooseContentSelector(page: Page): Promise<string> {
  const selectors = [
    // Ppomppu-specific (highest priority — narrowest first)
    "div.JS_ContentMain td.board-contents",
    "td.board-contents",
    "div.JS_ContentMain",
    // Legacy generic selectors (fallback)
    "#bbsview",
    "#bbsContents",
    "#view",
    "#viewContent",
    "div.view",
    'form[name="bbs_view"]',
    "#revolution_main_table",
    "article",
  ];

  // Pick the first (most specific) selector that exists and has meaningful content
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    const count = await el.count().catch(() => 0);
    if (count > 0) {
      const text = (await el.textContent()) || "";
      if (text.replace(/\s+/g, " ").trim().length > 20) {
        console.log(`    selector matched: ${selector}`);
        return selector;
      }
    }
  }

  return "body";
}

async function collectImages(
  page: Page,
  rootSelector: string,
  postId: string,
): Promise<ImageBuffer[]> {
  const selector = `${rootSelector} img`;
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);
  const images: ImageBuffer[] = [];
  const MAX_IMAGES = 20;
  const MIN_DIMENSION = 100; // px — skip tiny icons / spacer gifs

  for (let i = 0; i < count && images.length < MAX_IMAGES; i += 1) {
    const img = locator.nth(i);
    const src = (await img.getAttribute("src").catch(() => "")) || "";

    // Skip platform chrome: only user-uploaded content images are relevant
    if (!isUserContentImage(src)) {
      continue;
    }

    try {
      const buffer = await img.screenshot({ type: "jpeg", quality: 70, timeout: 60000 });
      // Skip tiny images (spacer gifs, tracking pixels, small icons)
      if (!isImageLargeEnough(buffer, MIN_DIMENSION)) {
        continue;
      }
      console.log(`  [${postId}] kept image ${i + 1}: ${src.slice(0, 80)} (${(buffer.length / 1024).toFixed(0)}KB)`);
      images.push({ id: `${postId}-${i + 1}`, buffer, ext: ".jpg", src });
    } catch {
      continue;
    }
  }

  return images;
}

/** Returns true if the src looks like user-uploaded ad content on Ppomppu. */
function isUserContentImage(src: string): boolean {
  const normalized = src.toLowerCase();
  // User-uploaded images live under zboard/data paths
  if (normalized.includes("zboard/data")) return true;
  // Also accept data URI images (inline content)
  if (normalized.startsWith("data:")) return true;
  return false;
}

/**
 * Decode image dimensions from a JPEG or PNG buffer.
 * Returns [width, height] or null if the format is unrecognised.
 */
function getImageDimensions(buffer: Buffer): [number, number] | null {
  // PNG: first 8 bytes are signature, then IHDR chunk (4 len + 4 "IHDR" + W + H)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length >= 24) {
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      return [w, h];
    }
    return null;
  }

  // JPEG: scan for SOF marker (0xFFC0–0xFFCF), usually SOF0 at 0xFFC0
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    try {
      for (let i = 2; i < buffer.length - 9; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] >= 0xc0 && buffer[i + 1] <= 0xcf) {
          const h = buffer.readUInt16BE(i + 5);
          const w = buffer.readUInt16BE(i + 7);
          return [w, h];
        }
      }
    } catch {
      // fall through
    }
    return null;
  }

  return null;
}

/** Validate that an image buffer is safe to send to the VLM API. */
function validateImageForVlm(buffer: Buffer, minDim: number = 16): { ok: true } | { ok: false; reason: string; w: number; h: number } {
  const dims = getImageDimensions(buffer);
  if (!dims) return { ok: false, reason: "unrecognised image format", w: 0, h: 0 };
  const [w, h] = dims;
  if (w < minDim || h < minDim) {
    return { ok: false, reason: `too small (${w}x${h}, minimum ${minDim}px)`, w, h };
  }
  return { ok: true };
}

/** Check if a JPEG buffer decodes to at least minWidth x minHeight. */
function isImageLargeEnough(buffer: Buffer, minDim: number): boolean {
  // Fast path: tiny files are almost certainly icons / tracking pixels
  if (buffer.length < 2048) return false;
  const dims = getImageDimensions(buffer);
  if (!dims) {
    // Can't decode dimensions — conservative: reject unless the buffer is large
    return buffer.length >= 8192;
  }
  const [w, h] = dims;
  return w >= minDim && h >= minDim;
}

// ── Record builders ──────────────────────────────────────────────────────────

function buildRecordBase(input: {
  runId: string;
  vendor: string;
  authorName?: string;
  postUrl: string;
  postTitle: string;
  postedAt: string;
  postedAtRaw?: string;
  capturedAt: string;
  products: AdProduct[];
  evidence: AdEvidence;
  extractionSource: CompetitorAdRecord["extraction_source"];
  confidence: number;
  notes?: string;
}): CompetitorAdRecord {
  return {
    record_id: recordIdFrom(input.postUrl, input.vendor),
    run_id: input.runId,
    vendor: input.vendor,
    author_name: input.authorName,
    post_url: input.postUrl,
    post_title: input.postTitle,
    posted_at: input.postedAt,
    posted_at_raw: input.postedAtRaw,
    captured_at: input.capturedAt,
    products: input.products,
    evidence: input.evidence,
    extraction_source: input.extractionSource,
    confidence: input.confidence,
    notes: input.notes,
  };
}

function buildRecordFromDeterministic(params: {
  runId: string;
  vendor: string;
  postUrl: string;
  postTitle: string;
  notesOverride?: string;
  parsed: PpomppuParsedRecord;
}): CompetitorAdRecord {
  const { runId, vendor, postUrl, postTitle, notesOverride, parsed } = params;

  const field_evidence: Record<string, EvidenceSource[]> = {
    vendor: [{ type: "html", excerpt: parsed.vendor, source_block: "li.topTitle-name > a" }],
    posted_at: [{ type: "html", excerpt: parsed.posted_at_raw, source_block: "ul.topTitle-mainbox > li" }],
  };

  if (parsed.landing_url) {
    field_evidence["landing_url"] = [{ type: "html", excerpt: parsed.landing_url, source_block: "li.topTitle-link > a" }];
  }

  const evidence: AdEvidence = {
    sources: [{ type: "html", excerpt: clampText(parsed.title + " | " + parsed.vendor, 160), source_block: "div#topTitle" }],
    field_evidence,
  };

  if (parsed.image_urls.length > 0) {
    evidence.sources.push({
      type: "html",
      excerpt: `${parsed.image_urls.length} ad creative(s) from content body`,
      source_block: "div.JS_ContentMain img.clickWide",
    });
  }

  const record = buildRecordBase({
    runId,
    vendor,
    authorName: parsed.vendor || undefined,
    postUrl,
    postTitle,
    postedAt: parsed.posted_at,
    postedAtRaw: parsed.posted_at_raw,
    capturedAt: new Date().toISOString(),
    products: parsed.products,
    evidence,
    extractionSource: "html",
    confidence: parsed.confidence,
    notes: notesOverride,
  });

  if (parsed.account_type) record.account_type = parsed.account_type;

  return record;
}

// ── VLM validation ───────────────────────────────────────────────────────────

function validateVlmAgainstHtml(
  vlmProducts: AdProduct[],
  htmlParsed: PpomppuParsedRecord,
): { validated: AdProduct[]; conflicts: string[] } {
  const conflicts: string[] = [];
  const validated = vlmProducts.map((vlmProduct) => {
    const corrected = { ...vlmProduct };

    const htmlPrices = htmlParsed.products.map((p) => p.price_krw).filter((p): p is number => p !== undefined);
    if (corrected.price_krw && htmlPrices.length > 0) {
      const closest = htmlPrices.reduce((a, b) =>
        Math.abs(a - corrected.price_krw!) < Math.abs(b - corrected.price_krw!) ? a : b,
      );
      const ratio = Math.abs(corrected.price_krw - closest) / closest;
      if (ratio > 0.1) {
        conflicts.push(`VLM price ${corrected.price_krw} deviates >10% from HTML price ${closest}; corrected`);
        corrected.price_krw = closest;
      }
    }

    const htmlDurations = htmlParsed.products.map((p) => p.duration_months).filter((d): d is number => d !== undefined);
    if (corrected.duration_months && htmlDurations.length > 0 && !htmlDurations.includes(corrected.duration_months)) {
      conflicts.push(`VLM duration ${corrected.duration_months} not found in HTML durations [${htmlDurations.join(", ")}]`);
    }

    return corrected;
  });

  return { validated, conflicts };
}

// ── Per-post isolation with retry ────────────────────────────────────────────

async function closeQuietly(
  page?: Page | null,
  context?: BrowserContext | null,
  browser?: Browser | null,
): Promise<void> {
  try { await page?.close(); } catch { /* already closed */ }
  try { await context?.close(); } catch { /* already closed */ }
  try { await browser?.close(); } catch { /* already closed */ }
}

async function processPostWithRetry(params: {
  runId: string;
  vendor: string;
  postUrl: string;
  notesOverride?: string;
  maxRetries?: number;
}): Promise<CompetitorAdRecord> {
  const { runId, vendor, postUrl, notesOverride, maxRetries = 2 } = params;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const browser = await chromium.launch({ headless: ENV.BROWSER_HEADLESS });
    const context = await browser.newContext({ userAgent: ENV.BROWSER_USER_AGENT, locale: "ko-KR" });
    await context.addInitScript({ content: BROWSER_EVAL_NAME_POLYFILL_SCRIPT });
    const page = await context.newPage();

    try {
      const record = await processPostIsolated({ page, browser, context, runId, vendor, postUrl, notesOverride });
      return record;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await closeQuietly(page, context, browser);

      if (attempt < maxRetries) {
        await sleep(2000 + jitterMs(0, 3000));
      }
    }
  }

  throw lastErr ?? new Error("Unknown error after retries");
}

async function processPostIsolated(params: {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  runId: string;
  vendor: string;
  postUrl: string;
  notesOverride?: string;
}): Promise<CompetitorAdRecord> {
  const { page, browser, context, runId, vendor, postUrl, notesOverride } = params;
  const postId = postIdFromUrl(postUrl);
  const root = artifactRoot(runId);
  let browserClosed = false;

  try {
    // Step 1: Fetch HTML
    console.log(`  [${postId}] navigating to post URL...`);
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: ENV.BOT_NAV_TIMEOUT_MS });
    console.log(`  [${postId}] page loaded, extracting content...`);
    const pageTitle = (await page.title()) || "";
    const html = await page.content();
    const rawHtmlPath = path.join(root, "raw_html", `${postId}.html`);
    await fsp.writeFile(rawHtmlPath, html, "utf-8");

    // Step 2: Deterministic Cheerio parse
    console.log(`  [${postId}] running deterministic parser...`);
    const parsed = parsePpomppuPost(html, postUrl);

    // Step 3: If deterministic parse is sufficient, skip OCR/VLM
    if (parsed.confidence >= 0.9 && parsed.products.length > 0) {
      console.log(`  [${postId}] deterministic parse OK: ${parsed.products.length} products, confidence=${parsed.confidence.toFixed(2)}`);
      return buildRecordFromDeterministic({
        runId,
        vendor,
        postUrl,
        postTitle: pageTitle.trim() || parsed.title || "(untitled)",
        notesOverride,
        parsed,
      });
    }

    console.log(`  [${postId}] deterministic parse incomplete (confidence=${parsed.confidence.toFixed(2)}, products=${parsed.products.length}), falling back to OCR/VLM`);

    // Step 4: Fallback — screenshot + OCR/VLM pipeline
    console.log(`  [${postId}] choosing content selector...`);
    const rootSelector = await chooseContentSelector(page);
    console.log(`  [${postId}] selected: ${rootSelector}, collecting subtree...`);
    const snapshot = await subtree(page, rootSelector, {
      maxDepth: 5,
      maxSiblingsPerNode: 40,
      maxTotalNodes: 400,
      maxTextLengthPerNode: 160,
    });

    const htmlEvidence = extractTextBlocks(snapshot.nodes);
    let imageBuffers: ImageBuffer[] = await collectImages(page, rootSelector, postId);
    console.log(`  [${postId}] kept ${imageBuffers.length} user content images, closing browser before OCR/VLM...`);
    const postedAt = findPostedAt(htmlEvidence.map((src) => src.excerpt)) || (parsed.posted_at ? { iso: parsed.posted_at, raw: parsed.posted_at_raw } : null);

    const capturedAt = new Date().toISOString();
    const { products: htmlProducts, evidence: htmlProductEvidence } = extractProductsFromText(htmlEvidence);

    const evidenceSources: EvidenceSource[] = [...htmlEvidence];
    let products: AdProduct[] = htmlProducts.length > 0 ? htmlProducts : parsed.products;
    let extractionSource: CompetitorAdRecord["extraction_source"] = htmlProducts.length > 0 ? "html" : undefined;
    let confidence = htmlProducts.length > 0 ? 0.7 : Math.max(0, parsed.confidence);

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

    // All browser-dependent data collected — close browser before long OCR/VLM HTTP calls
    await closeQuietly(page, context, browser);
    browserClosed = true;

    for (const image of imageBuffers) {
      const imgPath = path.join(root, "images", postId, `${image.id}${image.ext}`);
      await fsp.mkdir(path.dirname(imgPath), { recursive: true });
      await fsp.writeFile(imgPath, image.buffer);
    }

    for (const image of imageBuffers) {
      try {
        console.log(`  [${postId}] processing image ${image.id} for OCR/VLM`);
        const ocr = await runOcr(image.buffer);
        if (!ocr) {
          console.log(`  [${postId}] OCR returned null for ${image.id}, skipping`);
          continue;
        }
        const ocrPath = path.join(root, "ocr", postId, `${image.id}.txt`);
        await fsp.mkdir(path.dirname(ocrPath), { recursive: true });
        await fsp.writeFile(ocrPath, ocr.text, "utf-8");
        console.log(`  [${postId}] OCR done for ${image.id}: confidence=${ocr.confidence.toFixed(2)}, ${ocr.text.length} chars`);
        const ocrExcerpt = clampText(ocr.text, 160);
        if (ocrExcerpt.length > 0) {
          ocrEvidence.push({ type: "ocr", excerpt: ocrExcerpt, image_ref: image.id });
        }

        if (ocr.confidence < 0.75) {
          console.log(`  [${postId}] OCR confidence low for ${image.id}, running VLM parse`);
          const vlm = await runVlmParse(image.buffer, ocr.text);
          const vlmPath = path.join(root, "vlm", postId, `${image.id}.json`);
          await fsp.mkdir(path.dirname(vlmPath), { recursive: true });
          await fsp.writeFile(vlmPath, JSON.stringify({ raw: vlm.raw, parsed: vlm.parsed }, null, 2));
          console.log(`  [${postId}] VLM done for ${image.id}: ${vlm.parsed ? "parsed" : "no JSON"}`);
          const vlmExcerpt = clampText(vlm.raw, 160);
          if (vlmExcerpt.length > 0) {
            vlmEvidence.push({ type: "vlm", excerpt: vlmExcerpt, image_ref: image.id });
          }

          if (vlm.parsed && Array.isArray(vlm.parsed.products)) {
            const parsedProducts = (vlm.parsed.products as Record<string, unknown>[])
              .filter((p) => p && typeof p === "object" && typeof (p as { name?: string }).name === "string")
              .map((p) => {
                const name = String(p.name).trim();
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
      } catch (err) {
        console.log(`  [${postId}] OCR/VLM failed for image ${image.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (vlmProducts.length > 0) {
      // Validate VLM output against deterministic HTML extraction
      const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, parsed);
      products = validated;
      extractionSource = extractionSource ? "mixed" : "vlm";
      confidence = Math.max(confidence, 0.85);

      if (conflicts.length > 0) {
        console.log(`  [${postId}] VLM validation conflicts: ${conflicts.join("; ")}`);
      }
    }

    evidenceSources.push(...ocrEvidence, ...vlmEvidence);

    if (!postedAt) {
      throw new Error("Missing posted_at; no parseable date found in content.");
    }

    if (products.length === 0) {
      throw new Error("Missing products; no structured product rows extracted.");
    }

    const sources = evidenceSources.length > 0 ? evidenceSources : htmlProductEvidence;
    const trimmedSources = sources.filter((source) => source.excerpt.trim().length > 0);
    if (trimmedSources.length === 0) {
      throw new Error("Missing evidence sources; no non-empty excerpts captured.");
    }
    const evidence: AdEvidence = { sources: trimmedSources };

    const record = buildRecordBase({
      runId,
      vendor,
      postUrl,
      postTitle: pageTitle.trim() || "(untitled)",
      postedAt: postedAt.iso,
      postedAtRaw: postedAt.raw,
      capturedAt,
      products,
      evidence,
      extractionSource: extractionSource || "mixed",
      confidence,
      notes: notesOverride,
    });

    if (parsed.account_type && !record.account_type) record.account_type = parsed.account_type;

    return record;
  } finally {
    if (!browserClosed) {
      await closeQuietly(page, context, browser);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { inputCsv, runId, rateLimitRps, showVendors } = parseArgs(process.argv.slice(2));

  // Standalone read-only operation
  if (showVendors) {
    const db = openDatabase();
    const profiles = listVendorProfiles(db);
    const counts = getRecordCount(db);
    db.close();

    if (profiles.length === 0) {
      console.log("No vendor profiles found.");
      return;
    }

    console.log(`Vendor Profiles (${profiles.length} vendors, ${counts.total} total records in DB):\n`);
    for (const p of profiles) {
      console.log(`  ${p.vendor_id}`);
      if (p.author_name) console.log(`    Author: ${p.author_name}`);
      console.log(`    Posts: ${p.total_posts}`);
      console.log(`    First seen: ${p.first_seen_at ?? "unknown"} (${p.first_seen_post_url ?? "N/A"})`);
      console.log(`    Last seen:  ${p.last_seen_at ?? "unknown"} (${p.last_seen_post_url ?? "N/A"})`);
      if (p.products.length > 0) {
        console.log(`    Products (${p.products.length}): ${p.products.join(", ")}`);
      }
      console.log("");
    }
    return;
  }

  await ensureArtifactDirs(runId);

  const db = openDatabase();

  const rows = loadCsvRows(inputCsv);
  if (rows.length === 0) {
    console.error("No rows found in input CSV.");
    db.close();
    process.exit(1);
  }

  // Within-run dedup only (cross-run handled by SQLite)
  const seenThisRun = new Set<string>();

  const outputPath = dataOutputPath(runId);
  const gzip = zlib.createGzip();
  const outStream = fs.createWriteStream(outputPath, { flags: "w" });
  gzip.pipe(outStream);

  const startedAt = new Date().toISOString();
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;
  let recordsWritten = 0;
  const errors: RunError[] = [];

  try {
    for (const row of rows) {
      const recordId = recordIdFrom(row.postUrl, row.vendor);

      // Cross-run dedup via SQLite
      if (isRecordKnown(db, recordId)) {
        skippedCount += 1;
        console.log(`  [${postIdFromUrl(row.postUrl)}] skipping (already in DB from prior run)`);
        continue;
      }
      // Within-run dedup
      if (seenThisRun.has(recordId)) {
        skippedCount += 1;
        console.log(`  [${postIdFromUrl(row.postUrl)}] skipping (already processed this run)`);
        continue;
      }

      console.log(`Processing: ${row.vendor} / ${postIdFromUrl(row.postUrl)}`);

      try {
        const record = await processPostWithRetry({
          runId,
          vendor: row.vendor,
          postUrl: row.postUrl,
          notesOverride: row.notesOverride,
        });

        gzip.write(`${JSON.stringify(record)}\n`);
        successCount += 1;
        recordsWritten += 1;
        seenThisRun.add(recordId);

        // Persist to SQLite
        insertRecord(db, {
          record_id: record.record_id,
          run_id: record.run_id,
          vendor: record.vendor,
          author_name: record.author_name,
          post_url: record.post_url,
          post_title: record.post_title,
          posted_at: record.posted_at,
          captured_at: record.captured_at,
          products: record.products,
          extraction_source: record.extraction_source,
          confidence: record.confidence,
        });

        const productNames = record.products.map((p) => p.name);
        upsertVendorProfile(db, record.vendor, {
          author_name: record.author_name,
          post_url: record.post_url,
          posted_at: record.posted_at,
          product_names: productNames,
        });
      } catch (err) {
        failureCount += 1;
        const reason = err instanceof Error ? err.message : String(err);
        const postId = postIdFromUrl(row.postUrl);
        const logPath = path.join(artifactRoot(runId), "logs", `${postId}.json`);
        await fsp.writeFile(logPath, JSON.stringify({ postUrl: row.postUrl, vendor: row.vendor, error: reason }, null, 2));
        errors.push({ post_url: row.postUrl, reason, artifact_ref: logPath });
        console.error(`  FAILED: ${reason}`);
      }

      const delayMs = Math.round(1000 / rateLimitRps) + jitterMs(100, 400);
      await sleep(delayMs);
    }
  } finally {
    gzip.end();
    await new Promise<void>((resolve, reject) => {
      outStream.on("close", () => resolve());
      outStream.on("error", (err) => reject(err));
    });
  }

  const finishedAt = new Date().toISOString();
  const counts = getRecordCount(db);
  db.close();

  const summary = {
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    total_posts: rows.length,
    success_count: successCount,
    failure_count: failureCount,
    skipped_count: skippedCount,
    records_written: recordsWritten,
    artifact_dir: artifactRoot(runId),
    output_path: outputPath,
    db_total_records: counts.total,
    db_distinct_vendors: counts.distinct_vendors,
    errors,
  };

  await fsp.writeFile(runSummaryPath(runId), JSON.stringify(summary, null, 2));

  console.log("Competitor ads extraction complete.");
  console.log(`  run_id         : ${runId}`);
  console.log(`  total_posts    : ${rows.length}`);
  console.log(`  success_count  : ${successCount}`);
  console.log(`  failure_count  : ${failureCount}`);
  console.log(`  skipped_count  : ${skippedCount}`);
  console.log(`  records_written: ${recordsWritten}`);
  console.log(`  output_path    : ${outputPath}`);
  console.log(`  db records     : ${counts.total} total, ${counts.distinct_vendors} vendors`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
