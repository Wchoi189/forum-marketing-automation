/**
 * Board scanner — CheerioCrawler for board pagination.
 *
 * Fetches board listing pages, extracts post URLs + author names,
 * and follows pagination links up to a configurable depth.
 * No browser needed — lightweight HTTP + Cheerio parsing.
 */

import * as cheerio from "cheerio";
import type { CheerioCrawlingContext } from "crawlee";

export type BoardPost = {
  postUrl: string;
  authorName: string;
  postTitle: string;
  pageNum: number;
};

export type ScanOptions = {
  boardUrl: string;
  maxPages?: number;
  vendorKey?: string;
};

export type PpomppuListingSelectors = {
  /** Selector for the post title/subject link */
  subjectLink: string;
  /** Selector for the author name cell */
  authorCell: string;
  /** Selector for the listing table or container */
  listContainer: string;
};

/**
 * Known board listing selectors per vendor.
 * Ppomppu uses a standard zboard-style table layout.
 */
const PPOMPPU_LISTING_SELECTORS: PpomppuListingSelectors = {
  subjectLink: "a.baseList-title",
  authorCell: "span.list_name",
  listContainer: "table.table",
};

function resolvePageUrl(boardUrl: string, page: number): string {
  const url = new URL(boardUrl);
  if (page <= 1) {
    url.searchParams.delete("page");
    return url.toString();
  }
  url.searchParams.set("page", String(page));
  return url.toString();
}

function extractBoardId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("id");
  } catch {
    return null;
  }
}

export function extractPostsFromPage(
  html: string,
  pageUrl: string,
  pageNum: number,
  selectors: PpomppuListingSelectors,
  vendorKey?: string,
): BoardPost[] {
  const $ = cheerio.load(html);
  const posts: BoardPost[] = [];

  // Extract the board ID from the source URL to filter cross-board links
  const sourceBoardId = extractBoardId(pageUrl);

  const $container = $(selectors.listContainer).first();
  if (!$container.length) {
    // Fallback: scan the whole page for subject links
    $(selectors.subjectLink).each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const postUrl = href.startsWith("http") ? href : new URL(href, pageUrl).href;
      if (sourceBoardId && extractBoardId(postUrl) !== sourceBoardId) return;
      const title = $(el).text().trim();
      const authorName = $(el).closest("tr").find(selectors.authorCell).text().trim();

      if (vendorKey && !authorName.toLowerCase().includes(vendorKey.toLowerCase()) && !title.toLowerCase().includes(vendorKey.toLowerCase())) {
        return;
      }

      posts.push({ postUrl, authorName: authorName || "unknown", postTitle: title || "(untitled)", pageNum });
    });
    return posts;
  }

  // Walk each row in the listing
  const $rows = $container.find("tr");
  $rows.each((_, row) => {
    const $a = $(row).find(selectors.subjectLink).first();
    if (!$a.length) return;

    const href = $a.attr("href");
    if (!href) return;

    const postUrl = href.startsWith("http") ? href : new URL(href, pageUrl).href;
    if (sourceBoardId && extractBoardId(postUrl) !== sourceBoardId) return;

    const title = $a.text().trim();
    const authorName = $(row).find(selectors.authorCell).text().trim();

    // Filter by vendor key if provided
    if (vendorKey) {
      const key = vendorKey.toLowerCase();
      const matches =
        authorName.toLowerCase().includes(key) ||
        title.toLowerCase().includes(key);
      if (!matches) return;
    }

    posts.push({ postUrl, authorName: authorName || "unknown", postTitle: title || "(untitled)", pageNum });
  });

  return posts;
}

export function extractNextPageUrl(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);

  // Strategy 1: Look for a "next" link in pagination
  // Common patterns: "다음", "next", page nav with > or >>
  const nextPageLink = $("a").filter((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    return text === "다음" || text === "next" || text === ">" || text === "»";
  });

  if (nextPageLink.length) {
    const href = nextPageLink.attr("href");
    if (href) return href.startsWith("http") ? href : new URL(href, pageUrl).href;
  }

  // Strategy 2: Find the highest page number link and return it as a fallback
  // This is less reliable but works when there's no explicit "next" button
  const pageLinks = $("a").toArray()
    .map((el) => ({
      href: $(el).attr("href") ?? "",
      text: $(el).text().trim(),
    }))
    .filter((item) => item.text.match(/^\d+$/));

  if (pageLinks.length === 0) return null;

  // Find highest page number
  let maxPage = 0;
  let maxPageHref = "";
  for (const item of pageLinks) {
    const pageNum = Number(item.text);
    if (pageNum > maxPage) {
      maxPage = pageNum;
      maxPageHref = item.href;
    }
  }

  if (maxPageHref) {
    return maxPageHref.startsWith("http") ? maxPageHref : new URL(maxPageHref, pageUrl).href;
  }

  return null;
}

function extractCurrentPage(html: string): number {
  const $ = cheerio.load(html);

  // Look for the current page marker (often a span or strong with the page number)
  // or parse from the URL query parameter
  const currentPage = $("span.current, strong.current, .on").first();
  if (currentPage.length) {
    const pageNum = Number(currentPage.text().trim());
    if (Number.isFinite(pageNum) && pageNum > 0) return pageNum;
  }

  // Fallback: parse from URL
  try {
    const url = new URL(html.includes("<html") ? html.substring(0, 200) : "");
    const page = url.searchParams.get("page");
    if (page) return Number(page);
  } catch {
    // Not parseable as URL
  }

  return 1;
}

/**
 * Scan a board listing page (and follow pagination) to discover vendor posts.
 * Returns a list of { postUrl, authorName, postTitle }.
 */
export async function scanBoard(opts: ScanOptions): Promise<BoardPost[]> {
  const { boardUrl, maxPages = 10, vendorKey } = opts;
  const allPosts: BoardPost[] = [];
  const seenUrls = new Set<string>();
  let currentPageUrl = boardUrl;

  for (let page = 1; page <= maxPages; page++) {
    const url = resolvePageUrl(boardUrl, page);
    console.log(`  Scanning board page ${page}: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      console.warn(`  Board page ${page} returned ${response.status}; stopping pagination.`);
      break;
    }

    // Decode EUC-KR response (Ppomppu serves euc-kr, not UTF-8)
    const buf = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";
    const encoding = contentType.includes("euc-kr") ? "euc-kr" : "utf-8";
    const html = new TextDecoder(encoding).decode(buf);
    const posts = extractPostsFromPage(html, url, page, PPOMPPU_LISTING_SELECTORS, vendorKey);

    for (const post of posts) {
      if (!seenUrls.has(post.postUrl)) {
        seenUrls.add(post.postUrl);
        allPosts.push(post);
      }
    }

    console.log(`  Found ${posts.length} posts on page ${page} (${allPosts.length} total unique)`);

    // Check if there are more pages
    const nextUrl = extractNextPageUrl(html, url);
    if (!nextUrl) {
      console.log(`  No next page found; stopping after page ${page}.`);
      break;
    }
  }

  return allPosts;
}

/**
 * CheerioCrawler-compatible request handler for board scanning.
 * Use this when you want Crawlee to manage the HTTP requests instead of raw fetch.
 */
export function createBoardScanHandler(
  deps: { selectors: PpomppuListingSelectors; vendorKey?: string; seenUrls: Set<string>; results: BoardPost[] },
) {
  return function handler(context: CheerioCrawlingContext): void {
    const { $, request } = context;
    const { selectors, vendorKey, seenUrls, results } = deps;

    // Extract posts from this page
    const html = $.html();
    const pageNum = extractCurrentPage(html);
    const posts = extractPostsFromPage(html, request.url, pageNum, selectors, vendorKey);

    for (const post of posts) {
      if (!seenUrls.has(post.postUrl)) {
        seenUrls.add(post.postUrl);
        results.push(post);
      }
    }
  };
}
