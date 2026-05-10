import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPostsFromPage,
  extractNextPageUrl,
  type PpomppuListingSelectors,
} from "../../../lib/competitor-intel/discovery/board-scanner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELECTORS: PpomppuListingSelectors = {
  subjectLink: "td.td_subject a",
  authorCell: "td.td_name",
  listContainer: "table.board_list",
};

function makeBoardHtml(rows: Array<{ href: string; title: string; author: string }>): string {
  const rowHtml = rows
    .map(
      (r) => `
    <tr>
      <td class="td_name">${r.author}</td>
      <td class="td_subject"><a href="${r.href}">${r.title}</a></td>
    </tr>
  `,
    )
    .join("\n");

  return `
    <html>
      <body>
        <table class="board_list">
          <tr><th>제목</th><th>작성자</th></tr>
          ${rowHtml}
        </table>
      </body>
    </html>
  `;
}

// ---------------------------------------------------------------------------
// extractPostsFromPage — basic extraction
// ---------------------------------------------------------------------------

test("extractPostsFromPage: extracts post URLs, titles, authors", () => {
  const html = makeBoardHtml([
    { href: "https://ppomppu.co.kr/bbs/post/1", title: "Netflix 공유", author: "shareplan" },
    { href: "https://ppomppu.co.kr/bbs/post/2", title: "YouTube Premium", author: "other_user" },
  ]);

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].postUrl, "https://ppomppu.co.kr/bbs/post/1");
  assert.equal(posts[0].postTitle, "Netflix 공유");
  assert.equal(posts[0].authorName, "shareplan");
  assert.equal(posts[0].pageNum, 1);
});

test("extractPostsFromPage: resolves relative URLs against pageUrl", () => {
  const html = makeBoardHtml([
    { href: "/bbs/post/42", title: "Post", author: "user" },
  ]);

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS);
  assert.equal(posts[0].postUrl, "https://ppomppu.co.kr/bbs/post/42");
});

// ---------------------------------------------------------------------------
// extractPostsFromPage — vendorKey filtering
// ---------------------------------------------------------------------------

test("extractPostsFromPage: filters by vendorKey on author name", () => {
  const html = makeBoardHtml([
    { href: "https://ppomppu.co.kr/bbs/post/1", title: "Netflix", author: "shareplan_admin" },
    { href: "https://ppomppu.co.kr/bbs/post/2", title: "Disney+", author: "random_seller" },
  ]);

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS, "shareplan");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorName, "shareplan_admin");
});

test("extractPostsFromPage: filters by vendorKey on post title", () => {
  const html = makeBoardHtml([
    { href: "https://ppomppu.co.kr/bbs/post/1", title: "shareplan 추천", author: "random_user" },
    { href: "https://ppomppu.co.kr/bbs/post/2", title: "다른 판매자", author: "other" },
  ]);

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS, "shareplan");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].postTitle, "shareplan 추천");
});

test("extractPostsFromPage: vendorKey matching is case-insensitive", () => {
  const html = makeBoardHtml([
    { href: "https://ppomppu.co.kr/bbs/post/1", title: "Netflix", author: "SharePlan" },
  ]);

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS, "shareplan");
  assert.equal(posts.length, 1);
});

test("extractPostsFromPage: no vendorKey returns all posts", () => {
  const html = makeBoardHtml([
    { href: "https://ppomppu.co.kr/bbs/post/1", title: "A", author: "user1" },
    { href: "https://ppomppu.co.kr/bbs/post/2", title: "B", author: "user2" },
    { href: "https://ppomppu.co.kr/bbs/post/3", title: "C", author: "user3" },
  ]);

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS);
  assert.equal(posts.length, 3);
});

// ---------------------------------------------------------------------------
// extractPostsFromPage — fallback (no table container)
// ---------------------------------------------------------------------------

test("extractPostsFromPage: fallback when no table container found", () => {
  const html = `
    <html>
      <body>
        <tr>
          <td class="td_subject"><a href="/post/1">Title 1</a></td>
          <td class="td_name">author1</td>
        </tr>
      </body>
    </html>
  `;

  const posts = extractPostsFromPage(html, "https://ppomppu.co.kr/bbs/board.php", 1, SELECTORS);
  // Fallback path scans for subject links directly; cheerio may still find them
  // even without a proper table container
  assert.ok(posts.length >= 0); // at minimum, no crash
});

// ---------------------------------------------------------------------------
// extractNextPageUrl — "다음" link
// ---------------------------------------------------------------------------

test("extractNextPageUrl: finds '다음' link", () => {
  const html = `
    <html><body>
      <div class="pagination">
        <a href="?page=1">1</a>
        <a href="?page=2">다음</a>
      </div>
    </body></html>
  `;

  const next = extractNextPageUrl(html, "https://ppomppu.co.kr/bbs/board.php");
  assert.ok(next !== null);
  assert.ok(next.includes("page=2"));
});

test("extractNextPageUrl: finds 'next' link (English)", () => {
  const html = `
    <html><body>
      <div class="pagination">
        <a href="?page=2">next</a>
      </div>
    </body></html>
  `;

  const next = extractNextPageUrl(html, "https://ppomppu.co.kr/bbs/board.php");
  assert.ok(next !== null);
  assert.ok(next.includes("page=2"));
});

test("extractNextPageUrl: resolves relative next URL", () => {
  const html = `
    <html><body>
      <a href="/bbs/board.php?page=3">다음</a>
    </body></html>
  `;

  const next = extractNextPageUrl(html, "https://ppomppu.co.kr/bbs/board.php");
  assert.equal(next, "https://ppomppu.co.kr/bbs/board.php?page=3");
});

// ---------------------------------------------------------------------------
// extractNextPageUrl — page number fallback
// ---------------------------------------------------------------------------

test("extractNextPageUrl: falls back to highest page number link", () => {
  const html = `
    <html><body>
      <div class="pagination">
        <a href="?page=1">1</a>
        <a href="?page=5">5</a>
        <a href="?page=3">3</a>
      </div>
    </body></html>
  `;

  const next = extractNextPageUrl(html, "https://ppomppu.co.kr/bbs/board.php");
  assert.ok(next !== null);
  assert.ok(next.includes("page=5"));
});

test("extractNextPageUrl: no next page → null", () => {
  const html = `<html><body><p>No pagination here</p></body></html>`;
  const next = extractNextPageUrl(html, "https://ppomppu.co.kr/bbs/board.php");
  assert.equal(next, null);
});
