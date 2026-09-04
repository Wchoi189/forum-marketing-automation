/**
 * Rate limit detection for ppomppu.co.kr write page.
 *
 * Ppomppu enforces a 60-minute cooldown between posts. When clicking "글쓰기"
 * during this cooldown, a rate limit page is shown with remaining time.
 */

import type { Page } from "playwright";
import { logger, LOG_EVENT } from "../../logging/index.js";

/** Korean text indicating rate limit is active. */
export const RATE_LIMIT_MARKER = "글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다";

/** Regex patterns matching Ppomppu rate limit warning messages (in alert dialogs or write page). */
const RATE_LIMIT_REGEX = /(?:60분|1시간)\s*(?:이내|이\s*지나야|에\s*1개)|글\s*등록\s*후\s*60분이\s*지나야/i;

/** Regex to extract remaining minutes from rate limit message. */
const REMAINING_TIME_REGEX = /(\d+)\s*분\s*(?:후에\s*등록할\s*수\s*있습니다|후\s*등록|후)/;

export type RateLimitInfo = {
  /** Rate limit is active. */
  blocked: true;
  /** Server time shown on the page. */
  serverTime: string | null;
  /** Previous registration time shown on the page. */
  previousRegTime: string | null;
  /** Minutes until posting is allowed again. */
  remainingMinutes: number;
  /** Raw error message from the page. */
  message: string;
};

export type RateLimitStatus =
  | { blocked: false }
  | RateLimitInfo;

/**
 * Check if the current page or an intercepted dialog shows a rate limit message.
 * Should be called after clicking "글쓰기" button.
 */
export async function detectRateLimit(
  page: Page,
  capturedDialogText?: string | null
): Promise<RateLimitStatus> {
  try {
    const bodyText = await page.textContent("body").catch(() => "");
    const fullText = [capturedDialogText, bodyText].filter(Boolean).join("\n");

    const isRateLimited =
      Boolean(capturedDialogText && RATE_LIMIT_REGEX.test(capturedDialogText)) ||
      fullText.includes(RATE_LIMIT_MARKER) ||
      RATE_LIMIT_REGEX.test(fullText);

    if (!isRateLimited) {
      return { blocked: false };
    }

    // Extract remaining minutes
    const match = fullText.match(REMAINING_TIME_REGEX);
    let remainingMinutes = 60; // Default to full hour if parsing fails
    if (match) {
      const parsed = parseInt(match[1] ?? "", 10);
      if (!isNaN(parsed) && parsed > 0) {
        remainingMinutes = parsed;
      }
    }

    // Extract server time
    const serverTimeMatch = fullText.match(/현재\s*서버시간:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    const serverTime = serverTimeMatch?.[1] ?? null;

    // Extract previous registration time
    const prevRegMatch = fullText.match(/이전\s*등록시간:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    const previousRegTime = prevRegMatch?.[1] ?? null;

    const source = capturedDialogText && RATE_LIMIT_REGEX.test(capturedDialogText) ? "dialog" : "page";

    const info: RateLimitInfo = {
      blocked: true,
      serverTime,
      previousRegTime,
      remainingMinutes,
      message: `글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다 (${remainingMinutes}분 후에 등록 가능)`,
    };

    logger.info(
      {
        event: LOG_EVENT.publisherRateLimited,
        source,
        remainingMinutes,
        serverTime,
        previousRegTime,
        dialogText: capturedDialogText ?? undefined,
      },
      `[Publisher] Rate limit detected (${source}) — ${remainingMinutes} minutes remaining`
    );

    return info;
  } catch (error) {
    logger.warn(
      { event: "publisher_rate_limit_check_error", error },
      "[Publisher] Failed to check rate limit"
    );
    return { blocked: false };
  }
}