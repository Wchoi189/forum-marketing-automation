# bot.ts Refactoring Audit Directive

**Date:** 2026-05-13
**Status:** Bugs fixed, refactoring deferred
**Parent:** Resource Optimization Roadmap (Phase 5 complete)

## Bugs Fixed This Session

| # | Location | Fix |
|---|----------|-----|
| 1 | [bot.ts:546,561](bot.ts#L546) | `page.url()` returns `string`, not `Promise`. Removed erroneous `.catch(() => '')` calls |
| 2 | [bot.ts:1222-1242](bot.ts#L1222) | `context.on('request'/'response')` — these events belong to `Page`, not `BrowserContext`. Moved listeners inside the `try` block after `page = await context.newPage()` and changed to `page.on()` |

## Audit Findings

### Finding 1: Monolithic File — 1,380 lines, 33 top-level definitions

**Severity:** High — cognitive overload for AI and humans alike

bot.ts packs too many concerns into a single file:

| Lines | Concern | Approx. size |
|-------|---------|--------------|
| 1-54 | Imports, types, constants | ~54 |
| 55-207 | Utility functions (randomInt, sleep, clamp helpers, formatting) | ~153 |
| 209-244 | Controls (get/set observer & publisher controls) | ~36 |
| 246-403 | Observer policy loading + JSON parsing | ~158 |
| 404-510 | Board diagnostics + login flow | ~107 |
| 511-688 | Parser signal collection + board artifact capture | ~178 |
| 690-752 | Logging (saveLog, recordPublisherRun) | ~63 |
| 759-1096 | Observer (runObserver, _executeObserverRun) | ~338 |
| 1103-1380 | Publisher (runPublisher, _executePublisherRun) | ~278 |

**Recommended extraction targets (in priority order):**

1. **`lib/observer/observerRun.ts`** — Extract `_executeObserverRun()` + `runObserver()` + `captureBoardRowRegionArtifact()` + row parsing logic (~400 lines)
2. **`lib/publisher/publisherRun.ts`** — Extract `_executePublisherRun()` + `runPublisher()` + `recordPublisherRun()` (~280 lines)
3. **`lib/observer/policyLoader.ts`** — Extract `loadObserverPolicy()`, `loadObserverPolicyBase()`, `resolveEffectiveGapThresholdMin()`, `readPlanningJson()` (~160 lines)
4. **`lib/observer/boardDiagnostics.ts`** — Extract `getBoardDiagnostics()`, `fillAndSubmitLoginForm()`, `attemptPpomppuLoginFromBoard()` (~110 lines)
5. **`lib/observer/parserSignal.ts`** — Extract `collectParserSignal()`, `flattenProjectedNodes()`, `combinedConfidence()`, `createManualReviewMessage()` (~110 lines)
6. **`lib/controls.ts`** — Extract `get/setObserverControls()`, `get/setPublisherControls()` (~36 lines)

After extraction, bot.ts would be ~150 lines of re-exports and type definitions.

**Risk:** Moderate. The observer/publisher code has tight coupling through shared types (`ActivityLog`, `ParserSignal`) and the `finish()` closure. Extract `finish()` into a small `lib/publisher/publisherFinish.ts` helper, or leave it in bot.ts as an adapter layer.

### Finding 2: Duplicate Browser Debug Setup (Observer vs Publisher)

**Severity:** Low — duplicated code, not a bug

Both observer ([bot.ts:818-857](bot.ts#L818)) and publisher ([bot.ts:1235-1273](bot.ts#L1235)) register identical `page.on('request'/response')` and `cookies()` logging blocks.

**Fix:** Extract a `setupBrowserDebugLogging(page: Page)` helper into a shared module. This is a 20-line extraction that appears in two places.

### Finding 3: Inline `$$eval` Row Parser (90 lines of DOM scraping)

**Severity:** Medium — this is the core business logic but it's an anonymous function passed to `$$eval`, making it untestable in isolation

Located at [bot.ts:891-976](bot.ts#L891). The selector fallback chains, confidence scoring, and notice-detection logic are all inlined inside a callback stringified by Playwright.

**Fix:** Extract to a named function `parseBoardRows(trs: Element[]): Post[]` in `lib/observer/boardParser.ts`. Since `$$eval` serializes the callback, it must remain a plain function (no closures over module-scoped vars). A standalone exportable function can be unit-tested with mock DOM data.

### Finding 4: `server.ts` is 1,949 lines

**Severity:** Medium — similar cognitive load problem

server.ts contains the Express app, all 12 API routes, resource management, NL webhook, AI advisor, and more. It should be split into route modules:

- `routes/api/logs.ts` — `/api/logs`, `/api/board-stats`, `/api/competitor-stats`
- `routes/api/control.ts` — `/api/control-panel`, `/api/run-observer`, `/api/run-publisher`
- `routes/api/health.ts` — `/api/health/resources`, `/api/resource/gc`
- `routes/api/ai.ts` — `/api/ai-recommendation`
- `routes/api/nl.ts` — `/api/nl-command`

server.ts becomes the app factory (~200 lines).

**Risk:** Low-medium. Route handlers already use a `deps` object pattern — extraction is straightforward.

### Finding 5: Module-level side effects

**Severity:** Low — prevents clean unit testing

[bot.ts:180](bot.ts#L180) calls `registerSignalHandlers()` at module load time. This binds `SIGINT`/`SIGTERM` immediately on import, making any test file that imports bot.ts interfere with process lifecycle.

**Fix:** Export `registerSignalHandlers()` and call it from `server.ts` during app startup instead of at module scope.

### Finding 6: Hardcoded ppomppu URL in login recovery

**Severity:** Low — maintenance risk

[bot.ts:488](bot.ts#L488) has `'https://www.ppomppu.co.kr/zboard/login.php'` hardcoded. The board URL should come from `policy.boardUrl` like the rest of the code.

## Recommended AI Model for Refactoring

### Per-file model recommendations

| Refactoring | Minimum Model | Rationale |
|-------------|---------------|-----------|
| Finding 1: Extract modules from bot.ts | **Sonnet 4.6+** | Requires understanding cross-module dependencies, import/export graph, and shared type boundaries. A model with strong code reasoning is needed to preserve behavior across extractions. Haiku would likely miss subtle dependencies. |
| Finding 2: Extract debug logging helper | **Any** (Haiku OK) | Simple duplication removal, well-scoped. |
| Finding 3: Extract `$$eval` parser | **Sonnet 4.6+** | The callback serialization constraint (`$$eval` stringifies functions) means the extracted function cannot reference module scope. Requires understanding Playwright's serialization semantics. |
| Finding 4: Split server.ts routes | **Sonnet 4.6+** | Many API routes with shared `deps` object; requires tracking which route uses which dependency across 1,949 lines. |
| Finding 5: Move signal handler registration | **Any** (Haiku OK) | Simple scope change. |
| Finding 6: Fix hardcoded URL | **Any** (Haiku OK) | One-line change. |

### Overall recommendation

**Sonnet 4.6** for the extraction work. The two monolithic files (bot.ts at 1,380 lines, server.ts at 1,949 lines) require cross-file dependency tracking and semantic understanding of the publisher/observer execution flow. Haiku will miss subtle coupling (e.g., the `finish()` closure in publisher, the `previousBoardSnapshot` module state in parser signal). Opus 4.7 would be overkill but safe.

### Suggested execution order

1. **Finding 5** first (signal handler) — lowest risk, eliminates test interference
2. **Finding 2** (debug logging dedup) — small, validates extraction patterns
3. **Finding 6** (hardcoded URL) — trivial
4. **Finding 3** (board parser extraction) — enables unit testing of row parsing
5. **Finding 1** (bot.ts module extraction) — largest change, do after smaller extractions establish patterns
6. **Finding 4** (server.ts route split) — separate session, after bot.ts is stable
