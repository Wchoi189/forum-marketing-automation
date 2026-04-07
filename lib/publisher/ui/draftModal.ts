import type { Locator, Page } from "playwright";

import { PLAYBOOK_LOCATOR_TIMEOUT_MS } from "../core/timeouts.js";
import type { PlaybookRuntimeContext } from "../../playbookRunner.js";

function getDraftIndex(runtime: PlaybookRuntimeContext): number {
  return Math.max(1, Math.floor(runtime.draftItemIndex ?? 1));
}

function getDraftModalRoot(page: Page): Locator {
  return page
    .locator('.popup_layer:visible, .layer_popup:visible, .pop_layer:visible, [class*="layer_popup"]:visible, [class*="pop_layer"]:visible')
    .filter({ hasText: "임시저장된 게시글" })
    .filter({ has: page.locator("table") })
    .first();
}

function getDraftModalFallbackRoot(page: Page): Locator {
  return page
    .locator("div")
    .filter({ hasText: "임시저장된 게시글" })
    .filter({ has: page.locator("button:has-text('닫기')") })
    .first();
}

async function resolveVisibleDraftModalRoot(page: Page): Promise<Locator | null> {
  const primary = getDraftModalRoot(page);
  await primary.waitFor({ state: "visible", timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS }).catch(() => null);
  if (await primary.isVisible().catch(() => false)) return primary;

  const fallback = getDraftModalFallbackRoot(page);
  await fallback.waitFor({ state: "visible", timeout: 1500 }).catch(() => null);
  if (await fallback.isVisible().catch(() => false)) return fallback;

  return null;
}

async function resolveDraftRow(modalRoot: Locator, page: Page, draftIndex: number): Promise<Locator | null> {
  const rowLocator = modalRoot.locator("table tr").filter({ has: page.locator("td") });
  const rowCount = await rowLocator.count().catch(() => 0);
  if (rowCount < draftIndex) return null;

  const targetRow = rowLocator.nth(draftIndex - 1);
  const rowTarget = targetRow.locator("a,button,td").first();
  await rowTarget.click();
  return targetRow.locator("td").first();
}

async function clickPreviewLoadButton(page: Page, draftModalShell: Locator): Promise<void> {
  const previewRoot = page.locator("div.tempas-preview").last();
  await previewRoot.waitFor({ state: "visible", timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS }).catch(() => null);

  const previewLoadBtn = previewRoot.locator('button:has-text("불러오기")').first();
  if ((await previewLoadBtn.count().catch(() => 0)) === 0) return;

  await previewLoadBtn
    .click({ noWaitAfter: true, force: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS })
    .catch(async () => {
      await draftModalShell
        .locator('button:has-text("불러오기")')
        .first()
        .click({ noWaitAfter: true, force: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS });
    });
}

async function waitForBodyUnfreeze(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !document.body.classList.contains("freeze"), {
      timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
    })
    .catch(() => null);
}

async function clearFreezeWithCloseFallbacks(page: Page, draftModalShell: Locator): Promise<void> {
  const closeBtn = draftModalShell.locator('button:has-text("닫기")').first();
  if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({
        noWaitAfter: true,
        force: true,
        timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS
      });
      await waitForBodyUnfreeze(page);
    }
    if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
      await page
        .locator("button.btn-tempas-close")
        .first()
        .evaluate((el) => (el as HTMLElement).click());
      await waitForBodyUnfreeze(page);
    }
    if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
      await page.keyboard.press("Escape");
      await waitForBodyUnfreeze(page);
    }
  }
}

export async function confirmLoadDraftFromModal(
  page: Page,
  runtime: PlaybookRuntimeContext,
  stepId: string
): Promise<void> {
  const draftIndex = getDraftIndex(runtime);
  const modalRoot = await resolveVisibleDraftModalRoot(page);
  if (!modalRoot) {
    throw new Error(`[Playbook] ${stepId}: no matching selector candidate`);
  }

  const draftModalShell = page
    .locator("div")
    .filter({ has: page.locator('button:has-text("불러오기")') })
    .filter({ has: page.locator('button:has-text("닫기")') })
    .first();

  const rowCell = await resolveDraftRow(modalRoot, page, draftIndex);
  if (!rowCell) {
    throw new Error(`[Playbook] ${stepId}: no matching selector candidate`);
  }

  await clickPreviewLoadButton(page, draftModalShell);
  await waitForBodyUnfreeze(page);
  await clearFreezeWithCloseFallbacks(page, draftModalShell);

  if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
    throw new Error(
      `[Playbook] confirm-load-draft-modal: draft preview modal still open (body.freeze after close)`
    );
  }
}

