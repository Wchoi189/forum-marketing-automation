import type { Locator, Page } from "playwright";

import { PLAYBOOK_LOCATOR_TIMEOUT_MS } from "../core/timeouts.js";
import type { PlaybookRuntimeContext } from "../../playbookRunner.js";
import { logger } from "../../logger.js";
import { LOG_EVENT } from "../../logEvents.js";

const DRAFT_MODAL_FALLBACK_VISIBLE_TIMEOUT_MS = 500;
const DRAFT_MODAL_ACTION_TIMEOUT_MS = 500;

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
  await fallback.waitFor({ state: "visible", timeout: DRAFT_MODAL_FALLBACK_VISIBLE_TIMEOUT_MS }).catch(() => null);
  if (await fallback.isVisible().catch(() => false)) return fallback;

  return null;
}

type DraftRowSelection = {
  rowCell: Locator;
  clickedRawRowIndex: number;
  selectableRowCount: number;
  totalRowCount: number;
  clickedLabel: string | null;
};

type DraftRowResolution = {
  selection: DraftRowSelection | null;
  totalRowCount: number;
  selectableRowCount: number;
};

async function resolveDraftRow(modalRoot: Locator, page: Page, draftIndex: number): Promise<DraftRowResolution> {
  const rowLocator = modalRoot.locator("table tr").filter({ has: page.locator("td") });
  const rowCount = await rowLocator.count().catch(() => 0);
  if (rowCount === 0) {
    return {
      selection: null,
      totalRowCount: 0,
      selectableRowCount: 0,
    };
  }

  const selectableRows: Array<{ row: Locator; rawIndex: number }> = [];
  for (let i = 0; i < rowCount; i += 1) {
    const row = rowLocator.nth(i);
    const rowVisible = await row.isVisible().catch(() => false);
    if (!rowVisible) continue;

    // Draft tables often interleave hidden/preview rows; only count visible actionable rows.
    const rowTarget = row.locator("a:visible, button:visible, td:not([colspan]):visible").first();
    const targetCount = await rowTarget.count().catch(() => 0);
    if (targetCount === 0) continue;
    if (!(await rowTarget.isVisible().catch(() => false))) continue;

    selectableRows.push({ row, rawIndex: i });
  }

  if (selectableRows.length < draftIndex) {
    return {
      selection: null,
      totalRowCount: rowCount,
      selectableRowCount: selectableRows.length,
    };
  }

  const selected = selectableRows[draftIndex - 1];
  const rowTarget = selected.row.locator("a:visible, button:visible, td:not([colspan]):visible").first();
  const clickedLabel = (await selected.row.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 140) || null;
  await rowTarget.click({ timeout: DRAFT_MODAL_ACTION_TIMEOUT_MS });

  return {
    selection: {
      rowCell: selected.row.locator("td:not([colspan]):visible, td:visible").first(),
      clickedRawRowIndex: selected.rawIndex + 1,
      selectableRowCount: selectableRows.length,
      totalRowCount: rowCount,
      clickedLabel,
    },
    totalRowCount: rowCount,
    selectableRowCount: selectableRows.length,
  };
}

async function clickPreviewLoadButton(page: Page, draftModalShell: Locator): Promise<void> {
  const previewRoot = page.locator("div.tempas-preview").last();
  await previewRoot.waitFor({ state: "visible", timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS }).catch(() => null);

  const previewLoadBtn = previewRoot.locator('button:has-text("불러오기")').first();
  if ((await previewLoadBtn.count().catch(() => 0)) === 0) return;

  await previewLoadBtn
    .click({ noWaitAfter: true, force: true, timeout: DRAFT_MODAL_ACTION_TIMEOUT_MS })
    .catch(async () => {
      await draftModalShell
        .locator('button:has-text("불러오기")')
        .first()
        .click({ noWaitAfter: true, force: true, timeout: DRAFT_MODAL_ACTION_TIMEOUT_MS });
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
        timeout: DRAFT_MODAL_ACTION_TIMEOUT_MS
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

  const rowResolution = await resolveDraftRow(modalRoot, page, draftIndex);
  if (!rowResolution.selection) {
    throw new Error(
      `[Playbook] ${stepId}: no matching selector candidate (requestedDraftIndex=${draftIndex}, totalRows=${rowResolution.totalRowCount}, selectableRows=${rowResolution.selectableRowCount})`
    );
  }
  const rowCell = rowResolution.selection.rowCell;

  runtime.draftRowSelection = {
    requestedDraftIndex: draftIndex,
    clickedRawRowIndex: rowResolution.selection.clickedRawRowIndex,
    selectableRows: rowResolution.selection.selectableRowCount,
    totalRows: rowResolution.selection.totalRowCount,
    clickedLabel: rowResolution.selection.clickedLabel,
  };

  logger.info(
    {
      event: LOG_EVENT.publisherDraftRowSelected,
      stepId,
      requestedDraftIndex: draftIndex,
      clickedRawRowIndex: rowResolution.selection.clickedRawRowIndex,
      selectableRows: rowResolution.selection.selectableRowCount,
      totalRows: rowResolution.selection.totalRowCount,
      clickedLabel: rowResolution.selection.clickedLabel,
    },
    "[Publisher] Draft row selected"
  );

  await clickPreviewLoadButton(page, draftModalShell);
  await waitForBodyUnfreeze(page);
  await clearFreezeWithCloseFallbacks(page, draftModalShell);

  if (await page.evaluate(() => document.body.classList.contains("freeze"))) {
    throw new Error(
      `[Playbook] confirm-load-draft-modal: draft preview modal still open (body.freeze after close)`
    );
  }
}

