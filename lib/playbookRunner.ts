import type { Locator, Page } from "playwright";

import { DEFAULT_VERIFY_TEXT_TIMEOUT_MS, PLAYBOOK_LOCATOR_TIMEOUT_MS } from "./publisher/core/timeouts.js";
import { resolveFirstVisibleLocator } from "./publisher/ui/selectorResolver.js";
import { confirmLoadDraftFromModal } from "./publisher/ui/draftModal.js";
import { clickSubmitButton } from "./publisher/ui/submit.js";

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

export type DraftRowSelectionDiagnostics = {
  requestedDraftIndex: number;
  clickedRawRowIndex: number;
  selectableRows: number;
  totalRows: number;
  clickedLabel?: string | null;
};

export type PlaybookRuntimeContext = {
  boardEntryUrl: string;
  draftItemIndex?: number;
  /** Upper bound for verify_text waits (draft body may load async / live in an iframe). */
  verifyTextTimeoutMs?: number;
  /** Populated by confirm-load-draft-modal to expose selected row context to callers. */
  draftRowSelection?: DraftRowSelectionDiagnostics;
};

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

export async function runPublisherPlaybook(
  page: Page,
  playbook: PublisherPlaybook,
  runtime: PlaybookRuntimeContext,
  onStepStart?: (stepId: string) => void
): Promise<void> {
  for (const step of playbook.steps) {
    onStepStart?.(step.step_id);
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
      await confirmLoadDraftFromModal(page, runtime, step.step_id);
      continue;
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
      await clickSubmitButton(locator);
      continue;
    }

    throw new Error(`[Playbook] ${step.step_id}: unsupported action`);
  }
}
