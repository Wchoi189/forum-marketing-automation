/**
 * yt-pipeline-demo.ts
 *
 * Demonstrates the 7-stage multi-stage parser on stored raw HTML files.
 * No live site access. No LLM calls (deterministic stages only for efficiency demo).
 *
 * Runs Stage 0 (HTML → clean text) and Stage 2 (noise filter) on every YouTube post.
 * Uses stored record products from prior crawl for the market overview table.
 * Shows how the pipeline gates LLM calls — efficiency gain measured from char counts.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/yt-pipeline-demo.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

import { locateElements } from "../lib/competitor-intel/pipeline/stage0-locate/index.js";
import { filterNoise } from "../lib/competitor-intel/pipeline/stage2-filter/index.js";
import type { Stage1Output } from "../lib/competitor-intel/pipeline/stage1-classify/types.js";

const gunzip = promisify(zlib.gunzip);

// ── Paths ─────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(".");
const MARKET_DATA_DIR = path.join(PROJECT_ROOT, "artifacts", "competitor-ads", "market-data-2026-05-26-b");
const REPORT_OUTPUT = path.join(PROJECT_ROOT, "artifacts", "competitor-ads", "yt-pipeline-demo-report.md");
const JSONL_PATH = path.join(MARKET_DATA_DIR, "data", "records.jsonl.gz");
const HTML_DIR = path.join(MARKET_DATA_DIR, "raw_html");

// ── Types ─────────────────────────────────────────────────────────────────────

type StoredProduct = {
  name: string;
  duration_months?: number;
  price_krw?: number;
  price_per_month_krw?: number;
};

type StoredRecord = {
  vendor: string;
  author_name?: string;
  post_url: string;
  post_title: string;
  posted_at: string;
  products: StoredProduct[];
  account_type: string;
  confidence: number;
};

type EfficiencyMetrics = {
  htmlChars: number;
  bodyChars: number;
  filteredChars: number;
  signalScore: number;
  llmRequired: boolean;
  blocksRemoved: number;
  blocksKept: number;
  stage0Ms: number;
  stage2Ms: number;
};

type DemoPost = {
  record: StoredRecord;
  efficiency: EfficiencyMetrics;
  ytProducts: StoredProduct[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function postIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function isYouTubePost(record: StoredRecord): boolean {
  const title = record.post_title.toLowerCase();
  if (title.includes("youtube") || title.includes("유튜브")) return true;
  return record.products.some((p) =>
    p.name.toLowerCase().includes("youtube") || p.name.includes("유튜브")
  );
}

function ytProductsFromRecord(record: StoredRecord): StoredProduct[] {
  return record.products.filter((p) =>
    p.name.toLowerCase().includes("youtube") || p.name.includes("유튜브")
  );
}

function formatKrw(n?: number): string {
  if (n == null) return "—";
  return `₩${n.toLocaleString("ko-KR")}`;
}

function formatDuration(months?: number): string {
  if (months == null) return "—";
  if (months === 1) return "1개월";
  if (months === 3) return "3개월";
  if (months === 6) return "6개월";
  if (months === 12) return "1년";
  if (months === 18) return "18개월";
  if (months === 24) return "2년";
  if (months === 36) return "3년";
  if (months === 60) return "5년";
  return `${months}개월`;
}

function accountTypeLabel(at: string): string {
  if (at === "family_share") return "Family/공유";
  if (at === "individual") return "Individual/개인";
  return at || "Unknown";
}

function pct(reduced: number, original: number): string {
  if (original === 0) return "—";
  return `${Math.round((1 - reduced / original) * 100)}%`;
}

// Stage 1 mock — all YouTube posts treated as direct_offer (accurate for subscription ads)
const MOCK_STAGE1: Stage1Output = {
  postType: "direct_offer",
  classifierConfidence: 0.9,
  classifierEvidence: {
    excerpt: "",
    reasoning: "demo-mock: YouTube subscription posts are direct_offer",
  },
  skipExtraction: false,
};

// ── Processing ────────────────────────────────────────────────────────────────

async function processPost(record: StoredRecord): Promise<DemoPost | null> {
  const pid = postIdFromUrl(record.post_url);
  const htmlPath = path.join(HTML_DIR, `${pid}.html`);

  let html: string;
  try {
    html = await fs.readFile(htmlPath, "utf-8");
  } catch {
    return null;
  }

  const htmlChars = html.length;

  // Stage 0: HTML → clean text (Cheerio/trafilatura, no LLM)
  const t0 = Date.now();
  const stage0 = await locateElements(html, record.post_url);
  const stage0Ms = Date.now() - t0;
  const bodyChars = stage0.bodyText.length;

  // Stage 2: Noise filter (deterministic, no LLM)
  const t2 = Date.now();
  const stage2 = filterNoise(stage0, MOCK_STAGE1);
  const stage2Ms = Date.now() - t2;

  const filteredChars = stage2.contentForLlm.length;
  const blocksRemoved = stage2.removedBlocks?.length ?? 0;
  const blocksKept = stage2.cleanBlocks.length;

  const efficiency: EfficiencyMetrics = {
    htmlChars,
    bodyChars,
    filteredChars,
    signalScore: stage2.signalScore,
    llmRequired: stage2.llmRequired,
    blocksRemoved,
    blocksKept,
    stage0Ms,
    stage2Ms,
  };

  // Product data from stored record (extracted by prior pipeline run)
  const ytProducts = ytProductsFromRecord(record);

  return { record, efficiency, ytProducts };
}

// ── Report ────────────────────────────────────────────────────────────────────

function buildReport(posts: DemoPost[]): string {
  const lines: string[] = [];
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");

  lines.push(`# YouTube Premium Market Overview`);
  lines.push(`**Pipeline:** Multi-Stage Parser v1 — Deterministic Stages Demo`);
  lines.push(`**Source:** \`market-data-2026-05-26-b\` — stored HTML, no live site`);
  lines.push(`**Generated:** ${ts} UTC`);
  lines.push(`**Posts processed:** ${posts.length} YouTube-related`);
  lines.push(``);

  // ── SECTION 1: Market Overview ─────────────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Section 1: YouTube Premium Market Overview`);
  lines.push(``);
  lines.push(`Extracted from ${posts.length} vendor posts. Product data sourced from prior pipeline run.`);
  lines.push(``);

  // Deduplicate by vendor → collect all unique YT products
  type VendorEntry = {
    vendor: string;
    accountType: string;
    ytProducts: StoredProduct[];
    postCount: number;
  };

  const vendorMap = new Map<string, VendorEntry>();
  for (const p of posts) {
    if (p.ytProducts.length === 0) continue;
    const key = p.record.vendor;
    const existing = vendorMap.get(key);
    if (!existing) {
      vendorMap.set(key, {
        vendor: p.record.vendor,
        accountType: p.record.account_type,
        ytProducts: [...p.ytProducts],
        postCount: 1,
      });
    } else {
      existing.postCount++;
      for (const prod of p.ytProducts) {
        const dup = existing.ytProducts.find(
          (e) => e.name === prod.name && e.duration_months === prod.duration_months && e.price_krw === prod.price_krw
        );
        if (!dup) existing.ytProducts.push(prod);
      }
    }
  }

  const vendors = [...vendorMap.values()].sort((a, b) => a.vendor.localeCompare(b.vendor));

  // ── 1a: Full plan catalog ──────────────────────────────────────────────────
  lines.push(`### 1a. Full Subscription Plan Catalog`);
  lines.push(``);
  lines.push(`| Vendor | Plan Type | Term | Total Price | ₩/month equiv. |`);
  lines.push(`|--------|-----------|------|------------|----------------|`);

  for (const v of vendors) {
    const planType = accountTypeLabel(v.accountType);
    const sorted = [...v.ytProducts].sort((a, b) => (a.duration_months ?? 0) - (b.duration_months ?? 0));
    for (const p of sorted) {
      lines.push(
        `| ${v.vendor} | ${planType} | ${formatDuration(p.duration_months)} | ${formatKrw(p.price_krw)} | ${formatKrw(p.price_per_month_krw)} |`
      );
    }
  }

  lines.push(``);

  // ── 1b: Plan type split ────────────────────────────────────────────────────
  const familyVendors = vendors.filter((v) => v.accountType === "family_share");
  const individualVendors = vendors.filter((v) => v.accountType === "individual");
  const unknownVendors = vendors.filter((v) => v.accountType !== "family_share" && v.accountType !== "individual");

  lines.push(`### 1b. Subscription Type Distribution`);
  lines.push(``);
  lines.push(`| Type | Vendors | % |`);
  lines.push(`|------|---------|---|`);
  lines.push(`| Family / 공유 (shared seat) | ${familyVendors.length} | ${Math.round(familyVendors.length / vendors.length * 100)}% |`);
  lines.push(`| Individual / 개인 | ${individualVendors.length} | ${Math.round(individualVendors.length / vendors.length * 100)}% |`);
  if (unknownVendors.length > 0) {
    lines.push(`| Unknown | ${unknownVendors.length} | ${Math.round(unknownVendors.length / vendors.length * 100)}% |`);
  }
  lines.push(``);
  lines.push(`**Family vendors:** ${familyVendors.map((v) => v.vendor).join(", ")}`);
  lines.push(``);
  lines.push(`**Individual vendors:** ${individualVendors.map((v) => v.vendor).join(", ")}`);
  lines.push(``);

  // ── 1c: Price by term ─────────────────────────────────────────────────────
  lines.push(`### 1c. Price Range by Term Length`);
  lines.push(``);

  const byTerm = new Map<number, { prices: number[]; perMonth: number[]; vendors: string[] }>();
  for (const v of vendors) {
    for (const p of v.ytProducts) {
      if (!p.duration_months || !p.price_krw) continue;
      const entry = byTerm.get(p.duration_months) ?? { prices: [], perMonth: [], vendors: [] };
      entry.prices.push(p.price_krw);
      if (p.price_per_month_krw) entry.perMonth.push(p.price_per_month_krw);
      if (!entry.vendors.includes(v.vendor)) entry.vendors.push(v.vendor);
      byTerm.set(p.duration_months, entry);
    }
  }

  const sortedTerms = [...byTerm.entries()].sort((a, b) => a[0] - b[0]);

  lines.push(`| Term | # Vendors | Price Range | Avg ₩/month | Vendors |`);
  lines.push(`|------|-----------|-------------|-------------|---------|`);

  for (const [months, data] of sortedTerms) {
    const min = Math.min(...data.prices);
    const max = Math.max(...data.prices);
    const priceRange = min === max ? formatKrw(min) : `${formatKrw(min)} – ${formatKrw(max)}`;
    const avgMonthly = data.perMonth.length > 0
      ? Math.round(data.perMonth.reduce((a, b) => a + b, 0) / data.perMonth.length)
      : Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length / months);
    lines.push(
      `| ${formatDuration(months)} | ${data.vendors.length} | ${priceRange} | ${formatKrw(avgMonthly)} | ${data.vendors.join(", ")} |`
    );
  }

  lines.push(``);

  // ── SECTION 2: Efficiency Analysis ────────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Section 2: Pipeline Efficiency Analysis`);
  lines.push(``);
  lines.push(`Measures token reduction at each deterministic stage before any LLM is invoked.`);
  lines.push(``);
  lines.push(`**Old method baseline:** raw HTML sent directly to LLM (Ollama gemma2:27b).`);
  lines.push(`**New method:** Stage 0 strips HTML boilerplate → Stage 2 filters noise blocks → LLM receives only signal-dense content.`);
  lines.push(``);

  const n = posts.length;
  const totalHtml = posts.reduce((s, p) => s + p.efficiency.htmlChars, 0);
  const totalBody = posts.reduce((s, p) => s + p.efficiency.bodyChars, 0);
  const totalFiltered = posts.reduce((s, p) => s + p.efficiency.filteredChars, 0);
  const llmSkipCount = posts.filter((p) => !p.efficiency.llmRequired).length;
  const llmNeededCount = n - llmSkipCount;

  // Chars that WOULD have been sent to LLM (only for posts where LLM is needed)
  const htmlForLlmPosts = posts.filter((p) => p.efficiency.llmRequired).reduce((s, p) => s + p.efficiency.htmlChars, 0);
  const filteredForLlmPosts = posts.filter((p) => p.efficiency.llmRequired).reduce((s, p) => s + p.efficiency.filteredChars, 0);

  lines.push(`### 2a. Aggregate Char Reduction (${n} posts)`);
  lines.push(``);
  lines.push(`| Stage | Input chars | Output chars | Reduction |`);
  lines.push(`|-------|-------------|--------------|-----------|`);
  lines.push(`| Old method (raw HTML → LLM) | ${totalHtml.toLocaleString()} | ${totalHtml.toLocaleString()} | 0% (baseline) |`);
  lines.push(`| **Stage 0**: HTML → body text | ${totalHtml.toLocaleString()} | ${totalBody.toLocaleString()} | **${pct(totalBody, totalHtml)}** |`);
  lines.push(`| **Stage 2**: body text → filtered | ${totalBody.toLocaleString()} | ${totalFiltered.toLocaleString()} | **${pct(totalFiltered, totalBody)}** |`);
  lines.push(`| **Combined** (new method total) | ${totalHtml.toLocaleString()} | ${totalFiltered.toLocaleString()} | **${pct(totalFiltered, totalHtml)}** |`);
  lines.push(``);

  const avgHtml = Math.round(totalHtml / n);
  const avgBody = Math.round(totalBody / n);
  const avgFiltered = Math.round(totalFiltered / n);

  lines.push(`### 2b. Per-Post Averages`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Avg raw HTML size | ${avgHtml.toLocaleString()} chars |`);
  lines.push(`| Avg body text after Stage 0 | ${avgBody.toLocaleString()} chars |`);
  lines.push(`| Avg filtered content after Stage 2 | ${avgFiltered.toLocaleString()} chars |`);
  lines.push(`| Stage 0 reduction | ${pct(avgBody, avgHtml)} per post |`);
  lines.push(`| Stage 2 reduction | ${pct(avgFiltered, avgBody)} per post |`);
  lines.push(`| **End-to-end reduction** | **${pct(avgFiltered, avgHtml)} per post** |`);
  lines.push(``);

  lines.push(`### 2c. LLM Call Elimination (Stage 2 Signal Score ≥ 0.85)`);
  lines.push(``);
  lines.push(`When Stage 2 signal score is high enough, Stage 3 LLM extraction is skipped entirely.`);
  lines.push(`Cheerio regex extraction from Stage 2 cleanBlocks provides the product data directly.`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Posts where LLM is **skipped** | ${llmSkipCount} / ${n} (${Math.round(llmSkipCount / n * 100)}%) |`);
  lines.push(`| Posts requiring LLM extraction | ${llmNeededCount} / ${n} |`);
  if (llmNeededCount > 0) {
    lines.push(`| Old method: chars sent to LLM for those posts | ${htmlForLlmPosts.toLocaleString()} |`);
    lines.push(`| New method: filtered chars sent to LLM | ${filteredForLlmPosts.toLocaleString()} |`);
    lines.push(`| LLM input reduction for LLM-needed posts | **${pct(filteredForLlmPosts, htmlForLlmPosts)}** |`);
  }
  lines.push(``);

  lines.push(`### 2d. Signal Score Distribution`);
  lines.push(``);
  lines.push(`Stage 2 signal score = confidence that Cheerio extraction covers all products.`);
  lines.push(`Score ≥ 0.85 → LLM skipped. Score 0.60–0.84 → LLM supplementary. Score < 0.60 → LLM primary.`);
  lines.push(``);

  const scoreBuckets = {
    high: posts.filter((p) => p.efficiency.signalScore >= 0.85).length,
    mid: posts.filter((p) => p.efficiency.signalScore >= 0.6 && p.efficiency.signalScore < 0.85).length,
    low: posts.filter((p) => p.efficiency.signalScore < 0.6).length,
  };

  const avgScore = posts.reduce((s, p) => s + p.efficiency.signalScore, 0) / n;

  lines.push(`| Score Range | Posts | LLM Decision | Meaning |`);
  lines.push(`|-------------|-------|--------------|---------|`);
  lines.push(`| ≥ 0.85 (high) | ${scoreBuckets.high} | **Skipped** | Cheerio found price+duration+product — sufficient |`);
  lines.push(`| 0.60–0.84 (mid) | ${scoreBuckets.mid} | Required | Structured data present but LLM refines |`);
  lines.push(`| < 0.60 (low) | ${scoreBuckets.low} | Required | Low structure — LLM is primary extractor |`);
  lines.push(`| **Average score** | **${avgScore.toFixed(3)}** | | |`);
  lines.push(``);

  // ── SECTION 3: Noise Block Analysis ───────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Section 3: Noise Block Removal (Stage 2)`);
  lines.push(``);

  const totalBlocksRemoved = posts.reduce((s, p) => s + p.efficiency.blocksRemoved, 0);
  const totalBlocksKept = posts.reduce((s, p) => s + p.efficiency.blocksKept, 0);
  const totalBlocks = totalBlocksRemoved + totalBlocksKept;
  const avgRemoved = Math.round(totalBlocksRemoved / n);
  const avgKept = Math.round(totalBlocksKept / n);

  lines.push(`Stage 2 splits body text into blocks (newline-separated) and removes:`);
  lines.push(`- License footers, disclaimers, account-policy text`);
  lines.push(`- Long blocks (>100 chars) with no price, duration, or product keyword`);
  lines.push(`- Noise patterns (payment terms, boilerplate service descriptions)`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total blocks ingested | ${totalBlocks.toLocaleString()} |`);
  lines.push(`| Blocks removed (noise) | ${totalBlocksRemoved.toLocaleString()} (${pct(totalBlocksKept, totalBlocks)} removed) |`);
  lines.push(`| Blocks kept (signal) | ${totalBlocksKept.toLocaleString()} |`);
  lines.push(`| Avg blocks removed per post | ${avgRemoved} |`);
  lines.push(`| Avg blocks kept per post | ${avgKept} |`);
  lines.push(``);

  // ── SECTION 4: Timing ─────────────────────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Section 4: Per-Stage Timing (Deterministic Stages)`);
  lines.push(``);

  const totalS0Ms = posts.reduce((s, p) => s + p.efficiency.stage0Ms, 0);
  const totalS2Ms = posts.reduce((s, p) => s + p.efficiency.stage2Ms, 0);
  const avgS0Ms = Math.round(totalS0Ms / n);
  const avgS2Ms = Math.round(totalS2Ms / n);

  lines.push(`| Stage | Description | Total (${n} posts) | Avg/post |`);
  lines.push(`|-------|-------------|----------|---------|`);
  lines.push(`| Stage 0 | HTML → clean text (Cheerio) | ${totalS0Ms}ms | ${avgS0Ms}ms |`);
  lines.push(`| Stage 2 | Noise filter (pattern matching) | ${totalS2Ms}ms | ${avgS2Ms}ms |`);
  lines.push(`| Stages 0+2 combined | Deterministic preprocessing | ${totalS0Ms + totalS2Ms}ms | ${avgS0Ms + avgS2Ms}ms |`);
  lines.push(``);
  lines.push(`> Stages 1 (classify) and 3 (LLM extract) not timed here — they call Ollama.`);
  lines.push(`> Expected LLM overhead when Ollama is online: ~3–10s per call, model-dependent.`);
  lines.push(``);

  // ── SECTION 5: Per-Post Detail ────────────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Section 5: Per-Post Efficiency Detail`);
  lines.push(``);
  lines.push(`| Vendor | HTML chars | Body chars | Filtered chars | HTML→Filtered | Signal | LLM skip | YT products |`);
  lines.push(`|--------|-----------|-----------|----------------|---------------|--------|----------|-------------|`);

  for (const p of posts) {
    const e = p.efficiency;
    lines.push(
      `| ${p.record.vendor} | ${e.htmlChars.toLocaleString()} | ${e.bodyChars.toLocaleString()} | ${e.filteredChars.toLocaleString()} | ${pct(e.filteredChars, e.htmlChars)} | ${e.signalScore.toFixed(2)} | ${e.llmRequired ? "No" : "**Yes**"} | ${p.ytProducts.length} |`
    );
  }

  lines.push(``);

  // ── Footer ─────────────────────────────────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Methodology`);
  lines.push(``);
  lines.push(`- **HTML source:** \`artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/\` (90 files, SHA-256-named)`);
  lines.push(`- **Post filter:** title or products contain "youtube" or "유튜브" → ${n} posts`);
  lines.push(`- **Stage 0:** \`locateElements(html, url)\` — Cheerio DOM projection, returns bodyText`);
  lines.push(`- **Stage 1:** Mocked as \`direct_offer\` (all YouTube subscription posts qualify)`);
  lines.push(`- **Stage 2:** \`filterNoise(stage0, stage1)\` — pattern-based block filter, computes signalScore`);
  lines.push(`- **LLM skip threshold:** Stage 2 signalScore ≥ 0.85 (defined in stage2-filter/index.ts)`);
  lines.push(`- **Product data:** From prior crawl JSONL records (old pipeline reference baseline)`);
  lines.push(`- **Old method baseline:** Assumes full raw HTML sent to Ollama per post (no pre-filtering)`);
  lines.push(``);

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== YouTube Pipeline Demo (Deterministic Stages) ===");
  console.log(`HTML source: ${HTML_DIR}`);
  console.log(`Output report: ${REPORT_OUTPUT}`);
  console.log("");

  // Load JSONL manifest
  console.log("Loading JSONL manifest...");
  const compressed = await fs.readFile(JSONL_PATH);
  const decompressed = await gunzip(compressed);
  const records: StoredRecord[] = decompressed
    .toString("utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredRecord);

  const ytRecords = records.filter(isYouTubePost);
  console.log(`YouTube posts: ${ytRecords.length}/${records.length}`);
  console.log("");
  console.log("Running Stage 0 (HTML→text) + Stage 2 (noise filter) on each post...");
  console.log("");

  const posts: DemoPost[] = [];
  let skipped = 0;

  for (let i = 0; i < ytRecords.length; i++) {
    const record = ytRecords[i];
    const result = await processPost(record);
    if (!result) {
      skipped++;
      continue;
    }
    const e = result.efficiency;
    const reduction = Math.round((1 - e.filteredChars / e.htmlChars) * 100);
    console.log(
      `  [${(i + 1).toString().padStart(2)}/${ytRecords.length}] ${record.vendor.padEnd(20)}` +
      ` html:${e.htmlChars.toString().padStart(7)} → body:${e.bodyChars.toString().padStart(6)} → filtered:${e.filteredChars.toString().padStart(6)}` +
      ` (${reduction.toString().padStart(2)}% reduction)` +
      ` signal:${e.signalScore.toFixed(2)} LLM:${e.llmRequired ? "needed" : "SKIP  "} yt:${result.ytProducts.length}`
    );
    posts.push(result);
  }

  console.log("");
  console.log(`Processed: ${posts.length} | Skipped (no HTML): ${skipped}`);

  // Summary stats
  const n = posts.length;
  const totalHtml = posts.reduce((s, p) => s + p.efficiency.htmlChars, 0);
  const totalFiltered = posts.reduce((s, p) => s + p.efficiency.filteredChars, 0);
  const llmSkipped = posts.filter((p) => !p.efficiency.llmRequired).length;
  const overallReduction = Math.round((1 - totalFiltered / totalHtml) * 100);

  console.log("");
  console.log("=== Efficiency Summary ===");
  console.log(`Total HTML chars (old-method baseline): ${totalHtml.toLocaleString()}`);
  console.log(`Total filtered chars (new-method LLM input): ${totalFiltered.toLocaleString()}`);
  console.log(`Overall char reduction: ${overallReduction}%`);
  console.log(`LLM skipped (Cheerio sufficient): ${llmSkipped}/${n} posts (${Math.round(llmSkipped / n * 100)}%)`);

  console.log("\nBuilding report...");
  const report = buildReport(posts);
  await fs.writeFile(REPORT_OUTPUT, report, "utf-8");
  console.log(`Report written: ${REPORT_OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
