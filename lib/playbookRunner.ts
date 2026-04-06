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
};

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
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    const count = await locator.count();
    if (count > 0) {
      return locator;
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
      const hasText = await page.getByText(step.expected_text, { exact: false }).first().isVisible().catch(() => false);
      if (!hasText) {
        throw new Error(`[Playbook] ${step.step_id}: expected text not found: ${step.expected_text}`);
      }
      continue;
    }

    const locator = await resolveFirstLocator(page, step);
    if (!locator) {
      throw new Error(`[Playbook] ${step.step_id}: no matching selector candidate`);
    }

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
      await locator.evaluate((el) => {
        if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
          el.click();
          return;
        }
        (el as HTMLElement).click();
      });
      continue;
    }

    throw new Error(`[Playbook] ${step.step_id}: unsupported action`);
  }
}
