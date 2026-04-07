import type { Locator, Page } from "playwright";

export type SelectorResolutionStep = {
  step_id: string;
  selector?: string;
  selectors?: string[][];
};

async function buildSelectorCandidates(step: SelectorResolutionStep): Promise<string[]> {
  const candidates: string[] = [];

  if (Array.isArray(step.selectors)) {
    for (const chain of step.selectors) {
      if (!Array.isArray(chain)) continue;
      for (const selector of chain) {
        if (typeof selector === "string" && selector.trim().length > 0) {
          candidates.push(selector);
        }
      }
    }
  }

  if (typeof step.selector === "string" && step.selector.trim().length > 0) {
    candidates.push(step.selector);
  }

  return candidates;
}

export async function resolveFirstLocator(page: Page, step: SelectorResolutionStep): Promise<Locator | null> {
  const candidates = await buildSelectorCandidates(step);
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

export async function resolveFirstVisibleLocator(
  page: Page,
  step: SelectorResolutionStep
): Promise<{ locator: Locator; selector: string; rawIndex: number } | null> {
  const candidates = await buildSelectorCandidates(step);
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

