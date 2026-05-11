import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { cleanProductName, deduplicateProducts } from "./product-name-utils.js";
import { getProductNameMap } from "../competitor-intel/extraction/product-catalog.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type PpomppuProduct = {
  name: string;
  plan_tier?: string;
  duration_months?: number;
  price_krw?: number;
  price_per_month_krw?: number;
  constraints?: string;
};

export type PpomppuParsedRecord = {
  title: string;
  vendor: string;
  posted_at: string;
  posted_at_raw: string;
  landing_url: string | null;
  products: PpomppuProduct[];
  trust_signals: string[];
  account_type: string | null;
  image_urls: string[];
  confidence: number;
  warnings: string[];
};

// ── Main entry point ─────────────────────────────────────────────────────────

export function parsePpomppuPost(html: string, postUrl: string): PpomppuParsedRecord {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const title = extractTitle($);
  if (!title) warnings.push("Missing title");

  const vendor = extractVendor($);
  if (!vendor) warnings.push("Missing vendor");

  const { posted_at, posted_at_raw } = extractDate($);
  if (!posted_at) warnings.push("Missing posted date");

  const landing_url = extractLandingUrl($, postUrl);

  const { contentText, $content } = extractContentBody($);

  const products = extractProducts($, $content);

  const trust_signals = extractTrustSignals(contentText, title);

  const account_type = classifyAccountType(contentText, title);

  const image_urls = extractImageUrls($, $content, postUrl);

  const record: PpomppuParsedRecord = {
    title,
    vendor,
    posted_at,
    posted_at_raw,
    landing_url,
    products,
    trust_signals,
    account_type,
    image_urls,
    confidence: 0,
    warnings,
  };

  record.confidence = computeConfidence(record);
  return record;
}

// ── Field extractors ─────────────────────────────────────────────────────────

function extractTitle($: cheerio.CheerioAPI): string {
  const h1 = $("#topTitle > h1").text().trim();
  if (h1) return h1;

  const og = $('meta[property="og:title"]').attr("content");
  if (og) return og;

  return "";
}

function extractVendor($: cheerio.CheerioAPI): string {
  // Child selector fails on Cheerio XHTML parsing; use descendant text extraction
  return $("li.topTitle-name").text().trim();
}

function extractDate($: cheerio.CheerioAPI): { posted_at: string; posted_at_raw: string } {
  const dateLi = $("ul.topTitle-mainbox > li")
    .filter((_, el) => $(el).text().includes("등록일"))
    .first();

  if (!dateLi.length) return { posted_at: "", posted_at_raw: "" };

  const raw = dateLi.text().replace("등록일", "").trim();
  const iso = parseKoreanDate(raw);
  return { posted_at: iso, posted_at_raw: raw };
}

function parseKoreanDate(raw: string): string {
  const match = raw.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return "";

  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:${s.padStart(2, "0")}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function extractLandingUrl($: cheerio.CheerioAPI, pageUrl: string): string | null {
  const linkA = $("li.topTitle-link > a").first();
  const raw = linkA.attr("href");
  if (!raw) return null;

  // Resolve relative redirector URLs
  const resolved = raw.startsWith("http") ? raw : new URL(raw, pageUrl).href;

  // Decode the base64-encoded target parameter
  try {
    const url = new URL(resolved);
    const target = url.searchParams.get("target");
    if (target) {
      return Buffer.from(target, "base64").toString("utf-8");
    }
  } catch {
    // fall through to return the resolved URL as-is
  }

  return resolved;
}

function extractContentBody($: cheerio.CheerioAPI): { contentText: string; $content: cheerio.Cheerio<any> } {
  const primary = "div.JS_ContentMain td.board-contents";
  const fallback = "div.JS_ContentMain";

  let $content = $(primary);
  if (!$content.length) {
    $content = $(fallback);
  }

  const contentText = $content.text().replace(/\s+/g, " ").trim();
  return { contentText, $content };
}

function extractProducts($: cheerio.CheerioAPI, $content: cheerio.Cheerio<any>): PpomppuProduct[] {
  const products: PpomppuProduct[] = [];
  const priceRe = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/;
  const priceWonRe = /₩\s*(\d{1,3}(?:,\d{3})+|\d+)/;
  const durationRe = /(\d{1,2})\s*개월/;
  const durationYearRe = /(\d{1,2})\s*년/;
  const saleRe = /판매\s*중단/;

  // Product category keywords — used both as heading detection and fallback name
  const productCategories = [
    "유튜브 프리미엄", "유튜브프리미엄", "넷플릭스", "디즈니", "웨이브", "티빙", "멜론", "지니뮤직", "쿠팡플레이", "애플뮤직",
    "YouTube Premium", "YouTube Music", "Netflix", "Gemini", "Disney+", "WAVVE", "TVING",
  ];

  // Noise patterns for fallback name rejection
  const noiseStarts = [
    /^Q[.：\s]/i, /^A[.：\s]/i, /^질문/i, /^답변/i,
    /^공식\s*가격/i, /^원가/i, /^이메일/i, /^문자/i,
    /^카톡/i, /^상품\s*결제/i, /^입금/i, /^계좌/i,
    /^쪽지/i, /^PPOMPPU\s*장터/i, /^뽐뿌\s*정보/i,
    /^회원가입/i, /^로그인/i, /^홈페이지/i,
    /^새로운\s*구독/i, /^유프리/i, /^검증된/i,
    /^이런\s*리스크/i, /^편리한\s*연장/i, /^먹튀/i,
    /^클릭하시면/i, /^최근\s*뽐뿌/i,
  ];

  // Track the most recent product heading as we walk elements
  let currentProductName = "";

  // ── Phase 1: try <p> elements ──
  const paragraphs = $content.find("p").toArray();
  for (const p of paragraphs) {
    processElement($, p);
  }

  // ── Phase 2: if no products found, try <div> product cards ──
  if (products.length === 0) {
    const divElements = findProductDivs($, $content, productCategories, noiseStarts);
    for (const el of divElements) {
      processElement($, el);
    }
  }

  return deduplicateProducts(products);

  // ── Inner helper ──
  function processElement(_$: cheerio.CheerioAPI, el: AnyNode): void {
    const text = $(el).text().trim();
    if (!text) return;

    // Check if this element is a product heading
    for (const cat of productCategories) {
      if (text.includes(cat)) {
        currentProductName = normalizeProductName(cat);
        break;
      }
    }

    const hasPrice = text.match(priceRe) || text.match(priceWonRe);
    const isSaleStopped = saleRe.test(text);

    if (!hasPrice && !isSaleStopped) return;

    const price = hasPrice ? Number(hasPrice[1].replace(/,/g, "")) : undefined;
    const durationMonths = text.match(durationRe);
    const durationYears = text.match(durationYearRe);
    const duration = durationMonths
      ? Number(durationMonths[1])
      : durationYears
        ? Number(durationYears[1]) * 12
        : undefined;

    if (isSaleStopped && !price) {
      products.push({
        name: currentProductName || "OTT 구독",
        duration_months: duration || undefined,
        constraints: "판매 중단",
        plan_tier: "highlighted",
      });
      return;
    }

    const parenMatch = text.match(/[（(]([^）)]+)[）)]/);
    const constraintText = parenMatch ? parenMatch[1].trim() : "";

    let rawName = text
      .replace(priceRe, "")
      .replace(priceWonRe, "")
      .replace(durationRe, "")
      .replace(durationYearRe, "")
      .replace(/[()（）]/g, "")
      .trim();

    if (!currentProductName && noiseStarts.some((n) => n.test(rawName))) return;
    if (!currentProductName && rawName.length > 60) return;

    const fallbackName = duration
      ? `${duration}개월`
      : normalizeProductName(cleanProductName(clampText(rawName, 120)));
    const name = currentProductName || fallbackName;
    if (!name || name.length < 2) return;
    if (name.length > 50 && !currentProductName) return;

    // Reject fallback names that are short meaningless phrases
    // (e.g. "월 환산 시 약" from "월 환산 시 약4,580원")
    if (!currentProductName && name.length < 10 && !/\d/.test(name)) return;

    const product: PpomppuProduct = { name: cleanProductName(clampText(name, 120)) };
    if (duration) product.duration_months = duration;
    if (price !== undefined) product.price_krw = price;
    if (price !== undefined && duration) {
      product.price_per_month_krw = Math.round(price / duration);
    }
    if (constraintText) product.constraints = constraintText;
    if ($(el).find("mark").length > 0 || $(el).find("b").length > 0) {
      product.plan_tier = "highlighted";
    }

    products.push(product);
  }
}

/**
 * Find divs that contain product keywords and price/duration info.
 * Only returns divs that are actual product cards, not generic containers.
 */
function findProductDivs(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<any>,
  categories: string[],
  noiseStarts: RegExp[],
): AnyNode[] {
  const results: AnyNode[] = [];
  $root.find("div").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length < 5 || text.length > 200) return;

    // Must contain at least one product category keyword OR be a compact price/duration div
    const hasCategory = categories.some((cat) => text.includes(cat));
    const isCompactPrice = /\d{1,3}(?:,\d{3})+/.test(text) || /₩/.test(text);
    const hasDuration = /(\d{1,2})\s*(개월|년|달)/.test(text);
    if (!hasCategory && !(isCompactPrice && hasDuration)) return;

    // Reject noise blocks
    if (noiseStarts.some((n) => n.test(text))) return;

    results.push(el);
  });
  return results;
}

function extractTrustSignals(bodyText: string, titleText: string): string[] {
  const joined = titleText + " " + bodyText;
  const signals: string[] = [];

  const patterns = [
    /누적후기\s*[\d,]+\+?\s*개/g,
    /후기\s*[\d,]+\+?\s*개/g,
    /복구\s*[\d,]+\s*개\s*진행/g,
  ];

  for (const pattern of patterns) {
    const matches = joined.match(pattern);
    if (matches) signals.push(...matches);
  }

  return Array.from(new Set(signals));
}

function classifyAccountType(bodyText: string, titleText: string): string | null {
  const joined = titleText + " " + bodyText;

  if (/직접\s*(로그인|결제)/.test(joined)) return "direct_login";
  if (/가족/.test(joined) && /공유|초대|파티/.test(joined)) return "family_share";
  if (/공유|초대|파티/.test(joined)) return "group_invite";
  if (/직접\s*로그인/.test(joined)) return "direct_login";

  return null;
}

function extractImageUrls($: cheerio.CheerioAPI, $content: cheerio.Cheerio<any>, pageUrl: string): string[] {
  const urls: string[] = [];

  const images = $content.find("img.clickWide").toArray();
  for (const img of images) {
    const src = $(img).attr("src");
    if (!src) continue;

    const resolved = src.startsWith("//")
      ? "https:" + src
      : src.startsWith("/")
        ? new URL(src, pageUrl).href
        : src;

    urls.push(resolved);
  }

  return urls;
}

function computeConfidence(record: PpomppuParsedRecord): number {
  let score = 0;
  if (record.title.length > 5) score += 0.15;
  if (record.vendor.length > 0) score += 0.15;
  if (record.posted_at.length > 0) score += 0.15;
  if (record.products.length > 0) score += 0.35;
  if (record.image_urls.length > 0) score += 0.1;
  if (record.trust_signals.length > 0) score += 0.1;
  return Math.min(1.0, score);
}

function clampText(value: string, maxLen: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function normalizeProductName(raw: string): string {
  for (const [pattern, normalized] of getProductNameMap()) {
    if (pattern.test(raw)) return normalized;
  }
  return cleanProductName(raw);
}
