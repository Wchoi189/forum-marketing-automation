/**
 * Shared content extraction utilities used across the competitor-intel pipeline.
 * Canonical single source for functions that were previously copy-pasted across
 * 4 files with subtle divergences.
 */

import * as cheerio from "cheerio";
import type { EvidenceSource } from "../types.js";

const CONTENT_SELECTORS = [
  "div.JS_ContentMain td.board-contents",
  "td.board-contents",
  "div.JS_ContentMain",
  "#bbsview",
  "#bbsContents",
  "#view",
  "#viewContent",
  "article",
];

const LEAF_ELEMENT_SELECTOR = "p, div, span, td, th, li, b, strong, em, h1, h2, h3, h4, h5, h6";

/**
 * Extract cleaned text from the main content area for LLM consumption.
 * Tries increasingly broad selectors; falls back to full body text.
 */
export function extractContentTextForLlm(html: string): string {
  const $ = cheerio.load(html);

  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector);
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 50) return text;
    }
  }

  return $("body").text().replace(/\s+/g, " ").trim();
}

/**
 * Quality check: are Cheerio-extracted products likely junk?
 * Returns true if most products have generic names or missing prices.
 * No products is not "junk" — it's "missing".
 */
export function productsLookJunk(products: Array<{ name: string; price_krw?: number }>): boolean {
  if (products.length === 0) return false;

  const junkSignals = products.filter((p) => {
    if (p.name === "OTT 구독" || p.name === "구독") return true;
    if (p.name.length <= 3 && /^\d+$/.test(p.name)) return true;
    if (/변경|가능|문의|상담|해지|가입|완료/.test(p.name)) return true;
    if (/가[\s]?격|이용\s?기간|기\s?간|할인|쿠폰/.test(p.name)) return true;
    if (p.price_krw === undefined && p.name.length < 15) return true;
    return false;
  });

  return junkSignals.length > products.length * 0.5;
}

/**
 * Extract leaf text nodes as EvidenceSource snippets from a subtree.
 * Only captures elements with no children (leaf nodes), clamped to 160 chars.
 */
export function extractLeafTextBlocks($: cheerio.CheerioAPI, selector: string): EvidenceSource[] {
  const sources: EvidenceSource[] = [];

  $(selector).find(LEAF_ELEMENT_SELECTOR).each((_i, el) => {
    if ($(el).children().length === 0) {
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160);
      if (text.length >= 2) {
        sources.push({ type: "html", excerpt: text, source_block: el.tagName || "unknown" });
      }
    }
  });

  return sources;
}

/**
 * Fraction of products that have BOTH price AND duration.
 * 0 when no products; used in LLM-vs-HTML priority decisions.
 */
export function computeCompletenessScore(prods: Array<{ price_krw?: number; duration_months?: number }>): number {
  if (prods.length === 0) return 0;
  const complete = prods.filter((p) => p.price_krw !== undefined && p.duration_months !== undefined).length;
  return complete / prods.length;
}
