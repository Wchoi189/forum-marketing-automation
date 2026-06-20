import fs from "node:fs";
import type { Page } from "playwright";
import type { AdProduct, EvidenceSource } from "../types.js";
import { isImageLargeEnough } from "./image-utils.js";
import { cleanProductName, deduplicateProducts } from "../../competitor-ad-parser/product-name-utils.js";
import type { ProjectedNode } from "../../parser/index.js";

// ── Noise / stop-word patterns for text-block product extraction ─────────────
// These indicate the block is NOT a product offering (FAQ, payment info, etc.)

const NOISE_STARTS = [
  /^Q[.：\s]/i,
  /^A[.：\s]/i,
  /^질문/i,
  /^답변/i,
  /^공식\s*가격/i,
  /^원가/i,
  /^이메일\s*제출/i,
  /^문자/i,
  /^카톡/i,
  /^상품\s*결제/i,
  /^입금/i,
  /^계좌/i,
  /^쪽지/i,
  /^PPOMPPU\s*장터/i,
  /^뽐뿌\s*정보/i,
  /^회원가입/i,
  /^로그인/i,
  /^홈페이지/i,
  /^새로운\s*구독/i,
  /^유프리/i,
  /^검증된/i,
  /^이런\s*리스크/i,
  /^편리한\s*연장/i,
  /^먹튀/i,
  /^클릭하시면/i,
  /^최근\s*뽐뿌/i,
];

const NOISE_CONTAINS = [
  /입금\s*후/i,
  /입금자\s*알려/i,
  /계좌번호/i,
  /쪽지\s*주세요/i,
  /문자\/?카톡\s*메시지/i,
  /이메일\s*제출/i,
  // Korean sentence endings — descriptive/constraint text, not product names
  /변경\s*가능/i,
  /해지\s*되/i,
  /해지\s*불가/i,
  /문의\s*하/i,
  /상담\s*하/i,
];

// ── CSV parser ───────────────────────────────────────────────────────────────

export type CsvRow = {
  vendor: string;
  postUrl: string;
  notesOverride?: string;
};

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
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else if (ch !== "\r") { field += ch; }
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function loadCsvRows(inputCsv: string): CsvRow[] {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function clampText(value: string, maxLen: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

type ProjectedNodeLike = {
  text?: string;
  name?: string;
  path?: string;
  children: ProjectedNodeLike[];
};

export function extractTextBlocks(nodes: ProjectedNodeLike[]): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  const walk = (node: ProjectedNodeLike): void => {
    const hasChildText = node.children.some(
      (c) => (c.text || c.name || "").replace(/\s+/g, " ").trim().length >= 2,
    );
    if (!hasChildText) {
      const text = clampText(node.text || node.name || "", 160);
      if (text.length >= 2) {
        sources.push({ type: "html", excerpt: text, source_block: node.path });
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return sources;
}

export function findPostedAt(texts: string[]): { iso: string; raw?: string } | null {
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

export function extractProductsFromText(texts: EvidenceSource[]): { products: AdProduct[]; evidence: EvidenceSource[] } {
  const products: AdProduct[] = [];
  const evidence: EvidenceSource[] = [];

  for (const block of texts) {
    const text = block.excerpt;

    // ── Noise filter: reject FAQ, payment instructions, navigation ──
    if (NOISE_STARTS.some((p) => p.test(text))) continue;
    if (NOISE_CONTAINS.some((p) => p.test(text))) continue;

    // ── Signal check: must have a price or duration ──
    // Match both ₩18,900 and 18,900원 price formats
    const priceMatch = text.match(/₩\s*(\d{1,3}(?:,\d{3})+|\d+)/)
      || text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
    // Match both months (개월) and years (년) durations
    const durationMatch = text.match(/(\d{1,2})\s*개월/)
      || text.match(/(\d{1,2})\s*년/);
    const hasSignal = Boolean(priceMatch || durationMatch);
    if (!hasSignal) continue;

    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined;
    const durationFromMonths = text.match(/(\d{1,2})\s*개월/);
    const durationFromYears = text.match(/(\d{1,2})\s*년/);
    const duration = durationFromMonths
      ? Number(durationFromMonths[1])
      : durationFromYears
        ? Number(durationFromYears[1]) * 12
        : undefined;

    // ── Name extraction: derive name from text, but keep it short ──
    let name = cleanProductName(text
      .replace(/₩\s*\d{1,3}(?:,\d{3})+/g, "")
      .replace(/\d{1,3}(?:,\d{3})+\s*원/g, "")
      .replace(/\d+\s*원/g, "")
      .replace(/\d{1,2}\s*개월/g, "")
      .replace(/\d{1,2}\s*년/g, "")
      .replace(/\s{2,}/g, " ")
      .trim(), 50);

    // If name is too long after cleaning, this block is likely not a product heading
    if (name.length > 40) continue;
    if (!name || name.length < 2) continue;

    const product: AdProduct = { name: clampText(name, 120) };
    if (duration) product.duration_months = duration;
    if (price !== undefined) product.price_krw = price;
    if (price !== undefined && duration) {
      product.price_per_month_krw = Math.round(price / duration);
    }

    products.push(product);
    evidence.push(block);
  }

  return { products: deduplicateProducts(products), evidence };
}

// ── Content selection & image collection ─────────────────────────────────────

export async function chooseContentSelector(page: Page): Promise<string> {
  const selectors = [
    "div.JS_ContentMain td.board-contents",
    "td.board-contents",
    "div.JS_ContentMain",
    "#bbsview",
    "#bbsContents",
    "#view",
    "#viewContent",
    "div.view",
    'form[name="bbs_view"]',
    "#revolution_main_table",
    "article",
  ];

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

type ImageBuffer = { id: string; buffer: Buffer; ext: string; src?: string };

function isUserContentImage(src: string): boolean {
  const normalized = src.toLowerCase();
  if (normalized.includes("zboard/data")) return true;
  if (normalized.startsWith("data:")) return true;
  return false;
}

export async function collectImages(
  page: Page,
  rootSelector: string,
  postId: string,
): Promise<ImageBuffer[]> {
  const selector = `${rootSelector} img`;
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);
  const images: ImageBuffer[] = [];
  const MAX_IMAGES = 20;
  const MIN_DIMENSION = 100;

  for (let i = 0; i < count && images.length < MAX_IMAGES; i += 1) {
    const img = locator.nth(i);
    const src = (await img.getAttribute("src").catch(() => "")) || "";

    if (!isUserContentImage(src)) continue;

    try {
      const buffer = await img.screenshot({ type: "jpeg", quality: 70, timeout: 60000 });
      if (!isImageLargeEnough(buffer, MIN_DIMENSION)) continue;
      console.log(`  [${postId}] kept image ${i + 1}: ${src.slice(0, 80)} (${(buffer.length / 1024).toFixed(0)}KB)`);
      images.push({ id: `${postId}-${i + 1}`, buffer, ext: ".jpg", src });
    } catch {
      continue;
    }
  }

  return images;
}
