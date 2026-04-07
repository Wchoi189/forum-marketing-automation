import type { Locator, Page } from "playwright";

export type PlaybookAction = "navigate" | "click" | "change" | "select" | "submit" | "verify_text";

export type PlaybookStep = {
  step_id: string;
  action: PlaybookAction;
  url?: string;
  selector?: string;
  selectors?: string[][];
  value?: string;
  expected_text?: string;
};

export type PublisherPlaybook = {
  playbook_version: string;
  workflow_id: string;
  selector_profile?: "playwright";
  steps: PlaybookStep[];
};

export type PlaybookRuntimeContext = {
  boardEntryUrl: string;
  draftItemIndex?: number;
  /** Upper bound for verify_text waits (draft body may load async / live in an iframe). */
  verifyTextTimeoutMs?: number;
};

const DEFAULT_VERIFY_TEXT_TIMEOUT_MS = 20_000;

/** Playwright locator/action timeout for draft modal + submit (avoid default 30s). */
const PLAYBOOK_LOCATOR_TIMEOUT_MS = 3000;

async function waitForExpectedTextInAnyFrame(page: Page, text: string, timeoutMs: number): Promise<void> {
  const frames = page.frames();
  if (frames.length === 0) {
    throw new Error("expected text: no frames");
  }
  try {
    await Promise.any(
      frames.map((frame) =>
        frame.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs })
      )
    );
  } catch (err) {
    if (err instanceof AggregateError) {
      throw new Error(`expected text not found: ${text}`);
    }
    throw err;
  }
}

async function resolveFirstLocator(page: Page, step: PlaybookStep): Promise<Locator | null> {
  const candidates: string[] = [];
  if (Array.isArray(step.selectors)) {
    for (const chain of step.selectors) {
      if (Array.isArray(chain)) {
        for (const selector of chain) {
          if (typeof selector === "string" && selector.trim().length > 0) {
            candidates.push(selector);
          }
        }
      }
    }
  }
  if (typeof step.selector === "string" && step.selector.trim().length > 0) {
    candidates.push(step.selector);
  }
  const selectorWaitMs = 1500;
  const pollMs = 100;
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    const deadline = Date.now() + selectorWaitMs;
    while (true) {
      const count = await locator.count().catch(() => 0);
      if (count > 0) return locator;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  return null;
}

async function resolveFirstVisibleLocator(page: Page, step: PlaybookStep): Promise<{ locator: Locator; selector: string; rawIndex: number } | null> {
  const candidates: string[] = [];
  if (Array.isArray(step.selectors)) {
    for (const chain of step.selectors) {
      if (Array.isArray(chain)) {
        for (const selector of chain) {
          if (typeof selector === "string" && selector.trim().length > 0) {
            candidates.push(selector);
          }
        }
      }
    }
  }
  if (typeof step.selector === "string" && step.selector.trim().length > 0) {
    candidates.push(step.selector);
  }
  const selectorWaitMs = 1500;
  const pollMs = 100;
  const perSelectorScanLimit = 30;
  for (const selector of candidates) {
    const deadline = Date.now() + selectorWaitMs;
    let lastCount = 0;
    while (true) {
      const base = page.locator(selector);
      const count = await (typeof (base as unknown as { count?: () => Promise<number> }).count === "function"
        ? (base as unknown as { count: () => Promise<number> }).count()
        : base.first().count()).catch(() => 0);
      lastCount = count;
      if (count > 0) {
        const max = Math.min(count, perSelectorScanLimit);
        for (let i = 0; i < max; i += 1) {
          const candidate =
            typeof (base as unknown as { nth?: (index: number) => Locator }).nth === "function"
              ? (base as unknown as { nth: (index: number) => Locator }).nth(i)
              : base.first();
          const visible = await candidate.isVisible().catch(() => false);
          if (!visible) continue;
          return { locator: candidate, selector, rawIndex: i };
        }
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    if (step.step_id === "confirm-load-draft-modal" && lastCount > 0) {
      // Keep scanning selectors; fallback row/preview flow runs in runPublisherPlaybook().
    }
  }
  return null;
}

export async function runPublisherPlaybook(
  page: Page,
  playbook: PublisherPlaybook,
  runtime: PlaybookRuntimeContext
): Promise<void> {
  for (const step of playbook.steps) {
    if (step.action === "navigate") {
      const target = step.url ?? runtime.boardEntryUrl;
      await page.goto(target, { waitUntil: "domcontentloaded" });
      continue;
    }

    if (step.action === "verify_text") {
      if (!step.expected_text) throw new Error(`[Playbook] ${step.step_id}: expected_text is required`);
      const timeoutMs = runtime.verifyTextTimeoutMs ?? DEFAULT_VERIFY_TEXT_TIMEOUT_MS;
      try {
        await waitForExpectedTextInAnyFrame(page, step.expected_text, timeoutMs);
      } catch {
        throw new Error(`[Playbook] ${step.step_id}: expected text not found: ${step.expected_text}`);
      }
      continue;
    }

    if (step.step_id === "confirm-load-draft-modal") {
        const draftIndex = Math.max(1, Math.floor(runtime.draftItemIndex ?? 1));
        const modalRoot = page
          .locator("div")
          .filter({ hasText: "임시저장된 게시글" })
          .filter({ has: page.locator("button:has-text('닫기')") })
          .first();
        const modalVisible = await modalRoot.isVisible().catch(() => false);
        const rowLocator = modalRoot.locator("table tr").filter({ has: page.locator("td") });
        const rowCount = await rowLocator.count().catch(() => 0);
        if (modalVisible && rowCount >= draftIndex) {
          const targetRow = rowLocator.nth(draftIndex - 1);
          const rowCell = targetRow.locator("td").first();
          const rowTarget = targetRow
            .locator("a,button,td")
            .first();
          await rowTarget.click();
          // Row click selects a draft for *preview*; the real confirm is 불러오기 in tempas-preview (step intent).
          // Without it, body.freeze stays and 닫기 alone may not match site behavior.
          const draftModalShell = page
            .locator("div")
            .filter({ has: page.locator('button:has-text("불러오기")') })
            .filter({ has: page.locator('button:has-text("닫기")') })
            .first();
          const previewRoot = page.locator("div.tempas-preview").last();
          await previewRoot.waitFor({ state: "visible", timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS }).catch(() => null);
          const previewLoadBtn = previewRoot.locator('button:has-text("불러오기")').first();
          if ((await previewLoadBtn.count().catch(() => 0)) > 0) {
            await previewLoadBtn
              .click({ noWaitAfter: true, force: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS })
              .catch(async () => {
                await draftModalShell
                  .locator('button:has-text("불러오기")')
                  .first()
                  .click({ noWaitAfter: true, force: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS });
              });
          }
          await page
            .waitForFunction(() => !document.body.classList.contains("freeze"), {
              timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
            })
            .catch(() => null);
          const closeBtn = draftModalShell.locator('button:has-text("닫기")').first();
          if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
            if (await closeBtn.isVisible().catch(() => false)) {
              // tempas-preview .btn-area can sit above 닫기 and intercept pointer events (Playwright log).
              await closeBtn.click({
                noWaitAfter: true,
                force: true,
                timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
              });
              await page
                .waitForFunction(() => !document.body.classList.contains("freeze"), {
                  timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
                })
                .catch(() => null);
            }
            if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
              await page
                .locator("button.btn-tempas-close")
                .first()
                .evaluate((el) => (el as HTMLElement).click());
              await page
                .waitForFunction(() => !document.body.classList.contains("freeze"), {
                  timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
                })
                .catch(() => null);
            }
            if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
              await page.keyboard.press("Escape");
              await page
                .waitForFunction(() => !document.body.classList.contains("freeze"), {
                  timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
                })
                .catch(() => null);
            }
            if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
              throw new Error(
                `[Playbook] confirm-load-draft-modal: draft preview modal still open (body.freeze after close)`
              );
            }
          }
          continue;
        }
      throw new Error(`[Playbook] ${step.step_id}: no matching selector candidate`);
    }

    const resolvedVisible = await resolveFirstVisibleLocator(page, step);
    if (!resolvedVisible) {
      throw new Error(`[Playbook] ${step.step_id}: no matching selector candidate`);
    }
    const locator = resolvedVisible.locator;
    if (step.action === "click") {
      await locator.click();
      continue;
    }
    if (step.action === "change") {
      await locator.fill(step.value ?? "");
      continue;
    }
    if (step.action === "select") {
      await locator.selectOption({ label: step.value ?? "" });
      continue;
    }
    if (step.action === "submit") {
      // Do not wait for navigation here: bot.ts runs waitForPublishLandingUrl in parallel; waiting
      // in both places can block click() until nav-timeout (~30s) while the URL waiter fails first.
      await locator.click({ noWaitAfter: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS });
      continue;
    }

    throw new Error(`[Playbook] ${step.step_id}: unsupported action`);
  }
}
