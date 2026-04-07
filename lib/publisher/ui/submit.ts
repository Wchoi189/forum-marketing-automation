import type { Frame, Locator, Page } from "playwright";

import { PLAYBOOK_LOCATOR_TIMEOUT_MS, PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS } from "../core/timeouts.js";

export async function clickSubmitButton(locator: Locator): Promise<void> {
  await locator.click({ noWaitAfter: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS });
}

/** Post-submit landing page for this Zboard (list or view), not the compose screen. */
export function isPublishSuccessUrl(href: string, boardId: string): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.searchParams.get("id") !== boardId) return false;
  if (u.searchParams.get("page") === "write") return false;
  if (/write\.php/i.test(u.pathname)) return false;
  // Interim "ok" page after submit — must not count as success until real list/view.
  if (/write_ok\.php/i.test(u.pathname)) return false;
  if (u.pathname.includes("zboard.php")) return true;
  if (u.pathname.includes("view.php")) return true;
  if (u.searchParams.has("no")) return true;
  return false;
}

/**
 * After submit, wait until main frame URL is a final board list/view (not compose / write_ok).
 * Uses domcontentloaded so slow full "load" on the destination cannot false-timeout the waiter.
 */
export async function waitForPublishLandingUrl(
  page: Page,
  boardId: string,
  timeoutMs: number
): Promise<void> {
  const navigatedUrls: string[] = [];
  const onNav = (frame: Frame) => {
    if (frame === page.mainFrame()) {
      try {
        navigatedUrls.push(frame.url());
      } catch {
        navigatedUrls.push("(url_unavailable)");
      }
    }
  };
  page.on("framenavigated", onNav);
  const tailChain = () => navigatedUrls.slice(-12).join(" -> ");
  try {
    await page.waitForURL((u) => isPublishSuccessUrl(u.href, boardId), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded"
    });
  } catch (firstErr) {
    let href = "";
    try {
      href = page.url();
    } catch {
      href = "(url_unavailable)";
    }
    if (isPublishSuccessUrl(href, boardId)) {
      return;
    }
    await page.waitForTimeout(PUBLISHER_POST_SUBMIT_URL_RETRY_BUFFER_MS).catch(() => null);
    try {
      href = page.url();
    } catch {
      href = "(url_unavailable)";
    }
    if (isPublishSuccessUrl(href, boardId)) {
      return;
    }
    const base =
      firstErr instanceof Error && /timeout/i.test(firstErr.message)
        ? `PUBLISHER_POST_SUBMIT_TIMEOUT: no final list/view within ${timeoutMs}ms (boardId=${boardId})`
        : `PUBLISHER_POST_SUBMIT_VERIFY_FAILED: ${String((firstErr as Error)?.message ?? firstErr)}`;
    throw new Error(`${base} | lastUrl="${href}" | mainFrameNavTail="${tailChain()}"`);
  } finally {
    page.off("framenavigated", onNav);
  }
}


