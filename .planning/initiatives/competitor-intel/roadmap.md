# Competitor Intelligence + Publisher Reliability — Implementation Plan

**Date:** 2026-05-11
**Branch:** `fiori-integration`
**Scope:** Competitor Intel pipeline refactor, dashboard polish, publisher bug fix

---

## Sprint 1 — Publisher Click Navigation Bug (Critical)

### Problem
The `click-write` step in `playbookRunner.ts:99` calls `await locator.click()` with no `noWaitAfter` option and no custom timeout. Playwright's default behavior waits up to 30 seconds for a navigation to complete after the click. The click itself succeeds (`click action done` in call log) but Playwright then blocks on `waiting for scheduled navigations to finish`, timing out after 30 seconds. This causes **repeated `UNCLASSIFIED_ERROR` publisher failures** on every scheduler tick.

Compare to `clickSubmitButton()` in [submit.ts:6](lib/publisher/ui/submit.ts#L6) which correctly uses `{ noWaitAfter: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS }` — the `click-write` step never got this treatment.

### Fix (single file, ~3 lines)
- [lib/playbookRunner.ts](lib/playbookRunner.ts#L98-L100): Change `await locator.click()` to `await locator.click({ noWaitAfter: true, timeout: PLAYBOOK_LOCATOR_TIMEOUT_MS })`
- For `change` and `select` actions, also add `noWaitAfter: true` since navigating to the write page already happened — no further navigation should be waited on during form filling.

### Why this works
- The board page is already loaded; clicking "글쓰기" triggers a JavaScript redirect to the write page
- `noWaitAfter: true` tells Playwright to not block waiting for navigation — the next step (`open-saved-drafts`) will handle waiting for the write page to be ready via `resolveFirstVisibleLocator`
- Matches the pattern already used for the `submit` action

### Testing
- Run `npm run dev` and wait for the next scheduler tick (~60 min) or trigger via `POST /api/run-publisher`
- Success: publisher completes without `UNCLASSIFIED_ERROR`, `decision: "published_verified"` logged
- Verify the debug screenshot `02-write-page.png` (next step after click) shows the write page loaded

---

## Sprint 2 — Shared Code Extraction (Refactor)

### Problem
The hybrid extraction pipeline has **identical code copy-pasted across 4 files**:

| Function | Files |
|----------|-------|
| `extractContentTextForLlm()` | `ppomppu-parser.ts`, `request-handler.ts`, `re-extract-price-matrix.ts`, `test-all-vendors.ts` |
| `productsLookJunk()` | `request-handler.ts`, `re-extract-price-matrix.ts`, `test-all-vendors.ts` |
| `extractLeafTextBlocks()` / leaf text extraction | `re-extract-price-matrix.ts`, `request-handler.ts` |
| Priority logic (llmWins / completenessScore) | `request-handler.ts`, `re-extract-price-matrix.ts`, `test-all-vendors.ts` |

Each copy is slightly different, making bug fixes hard to keep in sync.

### Approach
Create `lib/competitor-intel/extraction/content-utils.ts` with:
- `extractContentTextForLlm(html: string): string` — canonical content extraction
- `productsLookJunk(products): boolean` — canonical junk detection
- `computePriorityDecision(llmProducts, htmlProducts, parsedProducts): { products, source, confidence }` — canonical priority logic

Update all 4 consumers to import from the shared module. Delete duplicate definitions.

### Testing
- `npx tsc --noEmit --skipLibCheck` passes
- `npx tsx scripts/test-all-vendors.ts` — all 5 vendors pass
- `npx tsx scripts/test-full-pipeline.ts` — 97%+ success rate maintained
- `npx tsx scripts/re-extract-price-matrix.ts` — database output identical to before

---

## Sprint 3 — Ollama Parallelization Strategy ✅ COMPLETE

### Decision: Option A + C (no parallelism, caching + incremental)

See Sprint 4 for implementation details.

---

## Sprint 4 — Incremental Extraction + Cache ✅ COMPLETE

### What was built

- **LLM response cache:** `lib/competitor-intel/cache/llmCache.ts` — disk cache at `artifacts/competitor-ads/llm-cache/` keyed by MD5(prompt+model), 7-day TTL
- **Cache integration:** `runTextExtraction()` in `lib/competitor-intel/extraction/text-extraction.ts` checks cache before Ollama call, writes result after
- **Incremental mode:** `--incremental` flag on `re-extract-price-matrix.ts` skips files whose `record_id` exists in DB with matching `content_hash`
- **DB migration:** auto-adds `content_hash` column to existing databases via `ALTER TABLE` in `openDatabase()`

### Testing
- Run `re-extract-price-matrix.ts --incremental` twice — second run should skip all files (0 LLM calls)
- Add a new HTML file to the test directory, run again — only the new file is processed
- Verify vendor profiles are correctly merged (product lists grow, not replaced)

---

## Sprint 5 — Dashboard Polish ✅ COMPLETE

### Fixes applied
1. **Vendor card `authorName`** — Added `author_name: result.vendor` to `upsertVendorProfile` call in `re-extract-price-matrix.ts`. Vendor cards now show the store name extracted from `topTitle-name`.

2. **Pricing tab duplicates** — Refactored `getProductPrices()` in `competitor-intel-ui.ts` to dedup by `(productName, vendor)` only, keeping the most recent post's price. Rows ordered by `posted_at DESC` so first occurrence per product+vendor wins.

3. **Timeline no data** — Replaced `DATE(posted_at)` with `strftime('%Y-%m-%d', posted_at)` in `getActivityTimeline()`. SQLite's `DATE()` function doesn't parse ISO 8601 with `T` separator; `strftime` handles both formats.

---

## Sprint 6 — Production Crawler Integration ✅ COMPLETE

### Audit
All Sprint 6 tasks were already satisfied by Sprint 2 and Sprint 4 implementations:
1. **Shared `content-utils.ts`** — [request-handler.ts:24](lib/competitor-intel/crawler/request-handler.ts#L24) imports `extractContentTextForLlm`, `productsLookJunk`, `computeCompletenessScore`
2. **LLM cache** — [text-extraction.ts:115](lib/competitor-intel/extraction/text-extraction.ts#L115) calls `cacheGet`/`cachePut` (7-day TTL, MD5 key)
3. **Vendor profile upsert** — [sqlite-adapter.ts:58](lib/competitor-intel/storage/sqlite-adapter.ts#L58) calls `upsertVendorProfile` with `author_name` for each synced record
4. **Dedup** — Crawlee RequestQueue (`uniqueKey = vendor|url`) + `isRecordKnown()` SQLite check in CSV mode and `discoverAndEnqueue` in scan-board mode

### Testing
- `npx tsc --noEmit --skipLibCheck` clean
- Full pipeline runs via `scripts/competitor-ads-intel.ts` (CSV and scan-board modes)

---

## Execution Order

| Sprint | Dependency | Effort | Risk | Status |
|--------|-----------|--------|------|--------|
| 1 — Publisher bug | None | 30 min | Low (3-line fix) | ✅ |
| 2 — Shared extraction | None | 2-3 hours | Medium (refactor 4 files) | ✅ |
| 3 — Ollama strategy | Decision only | 0 (analysis) | N/A | ✅ |
| 4 — Incremental + cache | Sprint 2 | 2 hours | Low | ✅ |
| 5 — Dashboard polish | None | 1-2 hours | Low | ✅ |
| 6 — Production crawler | Sprint 2, 4 | 0 (already done) | Low | ✅ |

All sprints complete.
