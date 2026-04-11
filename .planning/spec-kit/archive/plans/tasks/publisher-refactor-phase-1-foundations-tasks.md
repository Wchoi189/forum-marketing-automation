# Phase 1 Task Checklist - Foundations

Related sprint (archived): [`/parent/marketing-automation/.planning/spec-kit/archive/plans/sprints/publisher-refactor-sprint-1-foundations.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/sprints/publisher-refactor-sprint-1-foundations.md)

## Implementation Tasks
- [x] Inventory timeout constants and selector-resolution helpers currently embedded in runtime files.
  - Timeout / wait constants found:
    - `lib/playbookRunner.ts`: `DEFAULT_VERIFY_TEXT_TIMEOUT_MS=20_000`, `PLAYBOOK_LOCATOR_TIMEOUT_MS=3000`, selector polling (`selectorWaitMs=1500`, `pollMs=100`), visible-scan guard (`perSelectorScanLimit=30`).
    - `bot.ts`: `BOT_MAX_WAIT_MS=3000` (navigation/URL/locator waits), `PUBLISHER_POST_SUBMIT_WAIT_MS` is env-driven and passed as `verifyTextTimeoutMs` and to `waitForPublishLandingUrl`.
    - `bot.ts`: URL verify retry buffer `waitForTimeout(400)` inside `waitForPublishLandingUrl`.
  - Selector-resolution / candidate logic found:
    - `lib/playbookRunner.ts`: `resolveFirstLocator()` and `resolveFirstVisibleLocator()` build candidate selector list from `step.selectors` + `step.selector`, then poll for attachment/visibility with bounded scanning.
    - `bot.ts`: publish success URL gate `isPublishSuccessUrl()` (fail-closed against `write.php` + `write_ok.php`).
    - `bot.ts`: board row CSS selectors (`BOARD_ROW_SELECTOR`) and observer row-field fallback selector arrays inside `$$eval` (not publisher-step resolution, but still selector policy embedded in runtime).
- [x] Create `lib/publisher/core/timeouts.ts` and move timeout policy values without semantic changes.
- [x] Create `lib/publisher/ui/selectorResolver.ts` and move selector/actionability logic as-is.
- [x] Update call sites to import extracted modules while preserving execution order.
- [x] Keep old and new branches functionally equivalent before any cleanup simplification.

## Regression Guards
- [x] Confirm no submit-flow or modal semantics changed in this phase.
- [x] Confirm fail-closed decisions remain at the same decision points.

## Validation Gates
- [x] Run `npm run lint`.
- [x] Run `npm run test:integration`.
