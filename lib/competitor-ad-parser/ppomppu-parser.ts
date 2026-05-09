import * as cheerio from "cheerio";

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
  const durationRe = /(\d{1,2})\s*개월/;
  const saleRe = /판매\s*중단/;

  // Product category keywords — used both as heading detection and fallback name
  const productCategories = ["유튜브 프리미엄", "유튜브프리미엄", "넷플릭스", "디즈니", "웨이브", "티빙", "멜론", "지니뮤직", "쿠팡플레이", "애플뮤직"];
  const normalizeCategory = (name: string) => name === "유튜브프리미엄" ? "유튜브 프리미엄" : name;

  // Track the most recent product heading as we walk paragraphs
  let currentProductName = "";

  const paragraphs = $content.find("p").toArray();
  for (const p of paragraphs) {
    const text = $(p).text().trim();
    if (!text) continue;

    // Check if this paragraph is a product heading (contains a category keyword)
    for (const cat of productCategories) {
      if (text.includes(cat)) {
        currentProductName = normalizeCategory(cat);
        break;
      }
    }

    const priceMatch = text.match(priceRe);
    const durationMatch = text.match(durationRe);
    const isSaleStopped = saleRe.test(text);

    // Only treat as a product row if it has a price signal
    if (!priceMatch && !isSaleStopped) continue;

    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined;
    const duration = durationMatch ? Number(durationMatch[1]) : undefined;

    if (isSaleStopped && !price) {
      products.push({
        name: currentProductName || "OTT 구독",
        duration_months: duration || undefined,
        constraints: "판매 중단",
        plan_tier: "highlighted",
      });
      continue;
    }

    // Extract constraint text from parentheses (e.g. "기존 계정에 적용 가능")
    const parenMatch = text.match(/[（(]([^）)]+)[）)]/);
    const constraintText = parenMatch ? parenMatch[1].trim() : "";

    const name = currentProductName || (duration ? `${duration}개월` : clampText(text.replace(priceRe, "").replace(durationRe, "").replace(/[()（）]/g, "").trim(), 120));
    if (!name || name.length < 2) continue;

    const product: PpomppuProduct = { name: clampText(name, 120) };
    if (duration) product.duration_months = duration;
    if (price !== undefined) product.price_krw = price;
    if (price !== undefined && duration) {
      product.price_per_month_krw = Math.round(price / duration);
    }
    if (constraintText) {
      product.constraints = constraintText;
    }
    if ($(p).find("mark").length > 0 || $(p).find("b").length > 0) {
      product.plan_tier = "highlighted";
    }

    products.push(product);
  }

  return products;
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
