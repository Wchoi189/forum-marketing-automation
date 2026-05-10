# Competitor Intelligence Refactoring Roadmap

## Problem Statement

The competitor-ads-intel feature (`scripts/competitor-ads-intel.ts`) was built over multiple sessions into a 1145-line monolith. It handles browser lifecycle, retries, rate limiting, HTML parsing, OCR/VLM, SQLite dedup, JSONL output, and artifact management all inline. This is wasteful (reinventing what Crawlee does), hard to maintain, and locked to a single platform (Ppomppu only, CSV-only input).

## End Goal

- Replace plumbing with **Crawlee** (`PlaywrightCrawler`, `RequestQueue`, `Dataset`)
- Keep domain logic (Ppomppu parsing, Korean regex, evidence tracking, VLM validation)
- Add **multi-platform** support via `VendorStrategy` interface
- Add **vendor discovery** via `--scan-board` (auto-enumerate posters from board listings)
- Maintain backward compatibility (JSONL output, SQLite dedup)

## Architecture (Final State)

```
lib/competitor-intel/
  types.ts                    — Shared types
  vendor-strategy.ts          — VendorStrategy interface
  vendor-registry.ts          — Strategy registry + URL resolution
  index.ts                    — Barrel export
  ppomppu/
    patterns.ts               — Korean price/duration regexes
    ppomppu-strategy.ts       — PpomppuVendorStrategy implementation
  extraction/
    image-utils.ts            — JPEG/PNG dimension decoding, VLM guard
    ocr.ts                    — Ollama OCR pipeline
    vlm.ts                    — Ollama VLM JSON parsing
    validation.ts             — VLM-vs-HTML price/duration validation
    pipeline.ts               — Full extraction pipeline (CSV, selectors, images, records)
  storage/
    record-builder.ts         — Record ID generation + base builder
    jsonl-export.ts           — Crawlee Dataset -> JSONL gzip (S2)
    sqlite-adapter.ts         — Dataset -> SQLite sync (S4)
  crawler/                    — (S2, empty in S1)
    request-handler.ts        — Crawlee request handler
    crawlee-config.ts         — PlaywrightCrawler factory
  discovery/                  — (S3, empty in S1)
    board-scanner.ts          — CheerioCrawler for board pagination
    vendor-discovery.ts       — Scan -> filter -> queue orchestration

scripts/
  competitor-ads-intel.ts     — Thin CLI entry (args -> orchestration)
```

## Session Plan

### Session 1: Abstraction Layer (DONE)

**Status**: Complete. 2026-05-10.

**What was done**:
- Created `lib/competitor-intel/` module tree (1035 lines, 12 files)
- Defined `VendorStrategy` interface (7 methods)
- Created `PpomppuStrategy` wrapping existing `parsePpomppuPost`
- Extracted extraction pipeline: image-utils, ocr, vlm, validation, pipeline
- Extracted record builder: recordIdFrom, postIdFromUrl, buildRecordBase
- Created `VendorRegistry` with URL-based strategy resolution
- Rewrote `scripts/competitor-ads-intel.ts` from 1145 -> 285 lines
- TypeScript compiles cleanly

**What remains**: `crawler/` and `discovery/` directories are empty placeholders.

**See**: `.agent/session-handovers/handover-20260510-0030.json` for full handover details.

---

### Session 2: Crawlee Integration (DONE)

**Status**: Complete. 2026-05-10.

**What was done**:
- Installed `crawlee` v3.16.0 via npm
- Created `lib/competitor-intel/crawler/request-handler.ts` (252 lines) — Crawlee request handler with browser polyfill injection, HTML parsing, OCR/VLM fallback, Dataset push
- Created `lib/competitor-intel/crawler/crawlee-config.ts` (41 lines) — PlaywrightCrawler factory with high timeout (300s) for OCR/VLM
- Created `lib/competitor-intel/storage/jsonl-export.ts` (38 lines) — Dataset → gzip JSONL export for backward compat
- Rewrote `scripts/competitor-ads-intel.ts` (268 lines, was 285) — CSV → RequestQueue → crawler.run() → JSONL export → SQLite sync
- Deleted from `lib/competitor-intel/extraction/pipeline.ts` (220 lines, was 546): browser lifecycle (`chromium.launch`), retry loop, `sleep`/`jitter`, `processPostWithRetry`, `processPostIsolated`
- TypeScript compiles cleanly

**What got deleted**:
- Manual `chromium.launch()` per post → Crawlee manages browser pool
- Manual retry loop with jitter → `maxRequestRetries: 2`
- Manual `sleep` rate limiting → `maxRequestsPerMinute`
- Manual gzip JSONL streaming → `exportDatasetToJsonlGz`
- ~326 lines of boilerplate removed from pipeline.ts

**What stays**:
- SQLite dedup + vendor profiles (synced from Dataset at run end)
- JSONL output (exported from Dataset for backward compat)
- CLI arg parsing, `--show-vendors` flag
- Domain logic in extraction modules (CSV parser, content selector, image collector, text extractors)
- Deterministic Ppomppu parser + OCR/VLM fallback pipeline (now in request handler)

**Key design decisions**:
- Polyfill injected via `page.context().addInitScript()` in handler, then re-navigated
- OCR/VLM calls happen within the same handler; 300s timeout covers them
- Within-run dedup moved to pre-queue filtering (SQLite `isRecordKnown`)
- SQLite sync happens after crawler.run() completes, iterating Dataset items

**Verification**: npx tsc --noEmit passes. Needs end-to-end run with CSV.

**See**: `.agent/session-handovers/handover-20260510-0030.json` for Session 1 handover.

---

### Session 3: Vendor Discovery (DONE)

**Status**: Complete. 2026-05-10.

**What was done**:
- Created `lib/competitor-intel/discovery/board-scanner.ts` — Board pagination scanner using `fetch` with UA headers. Extracts post URLs + author names from Ppomppu board listings. Supports `maxPages` depth limit and `vendorKey` filter. Also exports `createBoardScanHandler` for Crawlee CheerioCrawler mode.
- Created `lib/competitor-intel/discovery/vendor-discovery.ts` — `discoverAndEnqueue()` filters discovered posts against SQLite dedup, enqueues into Crawlee RequestQueue. `groupByAuthor()` for reporting.
- Updated `scripts/competitor-ads-intel.ts` — Added `--scan-board <url>` mode with `--max-pages <n>` and `--vendor-key <pattern>` flags. Refactored CLI args into discriminated union (`show-vendors | csv | scan-board`). Extracted `syncDatasetToSqlite()` shared function (Dataset → JSONL export → SQLite sync).
- Exported `Database` type from `lib/competitor-ad-sqlite.ts`.
- Updated barrel exports in `index.ts`.
- TypeScript compiles cleanly (`npx tsc --noEmit` passes).

**What remains**: End-to-end verification run with `--scan-board`. Unit tests (Session 4).

**Key design decisions**:
- Board scanner uses plain `fetch` (no Crawlee CheerioCrawler) for simplicity — lightweight HTTP-only, no Playwright needed. CheerioCrawler handler also available via `createBoardScanHandler`.
- Pagination follows "다음"/"next" links or page number links up to `maxPages`.
- Vendor filtering happens at two levels: board scanner (author/title match) and discovery (SQLite dedup + queue).

---

### Session 4: Tests + Polish

**Status**: Complete. 2026-05-10.

**What was done**:
- Created `lib/competitor-intel/storage/sqlite-adapter.ts` — extracted `syncDatasetToSqlite()` from `scripts/competitor-ads-intel.ts` into a dedicated, testable adapter. Added `openWithKnownCheck()` convenience wrapper.
- Refactored `scripts/competitor-ads-intel.ts` to import `syncDatasetToSqlite` from the adapter module (removed ~50 lines of duplicated sync logic).
- Created 6 unit test files (75 tests):
  - `tests/unit/competitor-intel/image-utils.test.ts` (9) — JPEG/PNG dimension decoding, VLM validation, size checks
  - `tests/unit/competitor-intel/vendor-registry.test.ts` (7) — register, get, resolveFromUrl, list
  - `tests/unit/competitor-intel/vlm-validation.test.ts` (9) — VLM vs HTML price/duration cross-validation
  - `tests/unit/competitor-intel/ppomppu-parser.test.ts` (17) — title, vendor, date, products, account type, trust signals, images, confidence
  - `tests/unit/competitor-intel/board-scanner.test.ts` (12) — post extraction, vendor filtering, pagination, next-page detection
  - `tests/unit/competitor-intel/ocr-vlm.test.ts` (21) — extractJsonObject, estimateOcrConfidence, callOllamaGenerate (live Ollama)
- Created `tests/integration/competitor-intel.integration.test.ts` (8 tests) — CSV parsing, record builder, SQLite CRUD, vendor profiles
- Added `npm run test:competitor-intel` script
- Exported `extractPostsFromPage`, `extractNextPageUrl`, `PpomppuListingSelectors` from board-scanner for testability
- Created test image fixtures at `tests/fixtures/test-image-*.png`
- **All 83 tests green**, TypeScript compiles cleanly

**What was skipped**:
- Full browser crawler integration tests (need Playwright navigation to real URLs). Non-browser parts covered by `competitor-intel.integration.test.ts`.

---

## Session Dependencies

```
Session 1 (Abstraction) ──> Session 2 (Crawlee) ──> Session 3 (Discovery)
      |                                                    |
      +─────> Session 4 (Unit Tests, parallel with S2-S3)  |
      +──────────────────────────────────────────────────> Session 4 (Integration Tests)
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Crawlee over Crawl4AI | TypeScript native fit, same Playwright version, no Python bridge |
| Keep JSONL + SQLite alongside Crawlee Dataset | Backward compatibility with downstream consumers |
| VendorStrategy interface with 7 methods | Covers all platform-specific variation points |
| Don't modify existing parser module | Wraps `parsePpomppuPost`, doesn't change it |
| artifactRoot passed as parameter | Decouples extraction from path computation |

## Cloned Repositories

- `/parent/WEB_CRAWLER/crawlee` — TypeScript monorepo, `@crawlee/playwright` package (v3.16.0)
- `/parent/WEB_CRAWLER/crawl4ai` — Python package, reference for LLM extraction strategies
