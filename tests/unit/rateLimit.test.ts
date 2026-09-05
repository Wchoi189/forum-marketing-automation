import test from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { detectRateLimit } from "../../lib/publisher/ui/rateLimit.js";

function mockPage(bodyText: string): Partial<Page> {
  return {
    textContent: async () => bodyText,
  };
}

test("detectRateLimit returns blocked: false when no rate limit message", async () => {
  const page = mockPage("일반 페이지 내용") as Page;
  const result = await detectRateLimit(page);
  assert.strictEqual(result.blocked, false);
});

test("detectRateLimit detects rate limit and parses remaining minutes", async () => {
  const bodyText = `
    !알립니다
    글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다.

    현재 서버시간: 2026-08-08 21:32:18
    이전 등록시간: 2026-08-08 20:39:33

    8분 후에 등록할 수 있습니다.
    이전 화면
  `;
  const page = mockPage(bodyText) as Page;
  const result = await detectRateLimit(page);

  assert.strictEqual(result.blocked, true);
  if (result.blocked) {
    assert.strictEqual(result.remainingMinutes, 8);
    assert.strictEqual(result.serverTime, "2026-08-08 21:32:18");
    assert.strictEqual(result.previousRegTime, "2026-08-08 20:39:33");
    assert.ok(result.message.includes("8분"));
  }
});

test("detectRateLimit handles small remaining minutes", async () => {
  const bodyText = `
    글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다.
    1분 후에 등록할 수 있습니다.
  `;
  const page = mockPage(bodyText) as Page;
  const result = await detectRateLimit(page);

  assert.strictEqual(result.blocked, true);
  if (result.blocked) {
    assert.strictEqual(result.remainingMinutes, 1);
  }
});

test("detectRateLimit defaults to 60 minutes when parsing fails", async () => {
  const bodyText = `
    글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다.
    (no time info)
  `;
  const page = mockPage(bodyText) as Page;
  const result = await detectRateLimit(page);

  assert.strictEqual(result.blocked, true);
  if (result.blocked) {
    assert.strictEqual(result.remainingMinutes, 60);
  }
});

test("detectRateLimit handles error gracefully", async () => {
  const page = {
    textContent: async () => {
      throw new Error("Page error");
    },
  } as unknown as Page;
  const result = await detectRateLimit(page);
  assert.strictEqual(result.blocked, false);
});

test("detectRateLimit detects rate limit from capturedDialogText", async () => {
  const page = mockPage("일반 게시판 목록") as Page;
  const dialogText = "글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다. (25분 후에 등록할 수 있습니다.)";
  const result = await detectRateLimit(page, dialogText);

  assert.strictEqual(result.blocked, true);
  if (result.blocked) {
    assert.strictEqual(result.remainingMinutes, 25);
  }
});

test("detectRateLimit matches variant phrasing (1시간 이내에 1개)", async () => {
  const page = mockPage("1시간 이내에 1개의 글만 등록 가능합니다. 15분 후 등록 가능.") as Page;
  const result = await detectRateLimit(page);

  assert.strictEqual(result.blocked, true);
  if (result.blocked) {
    assert.strictEqual(result.remainingMinutes, 15);
  }
});

test("detectRateLimit matches variant dialog text (60분이 지나야)", async () => {
  const page = mockPage("일반 본문") as Page;
  const dialogText = "60분이 지나야 새로운 글을 쓸 수 있습니다. 42분 후에 등록할 수 있습니다.";
  const result = await detectRateLimit(page, dialogText);

  assert.strictEqual(result.blocked, true);
  if (result.blocked) {
    assert.strictEqual(result.remainingMinutes, 42);
  }
});

