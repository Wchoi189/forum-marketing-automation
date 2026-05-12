# Resource Exhaustion & Stability Audit — Fix Plan

**Created:** 2026-05-12
**Branch:** `fiori-integration`
**Status:** Phase 1 COMPLETE (2026-05-12). Phase 2 DONE (2026-05-12). Phase 3 DONE (2026-05-12). Phase 4 DONE (merged into Phase 1).

## Audit Findings

Three independent audits confirmed the following issues. The 58GB VSZ and blank white screen were caused by a combination of **Vite watching 72K+ Chromium profile files** (ppomppu_profile/), **no bot isolation in dev mode**, and **unbounded resource accumulation** over time.

### Root Causes Confirmed

| # | Cause | Evidence | Impact |
|---|-------|----------|--------|
| 1 | **Vite watches `ppomppu_profile/`** (72,544 files, 1.2GB Chromium profile) | Not in `server.watch.ignored` | Massive file watcher pressure, tsx compilation of binary/cache files |
| 2 | **Vite watches `artifacts/`** (663 files, 141MB screenshots/traces) | Not in `server.watch.ignored` | HMR trigger storms from publisher writes |
| 3 | **Vite watches `storage/`** (Crawlee datasets) | Not in `server.watch.ignored` | Unnecessary file watching |
| 4 | **Vite watches `dist/`** (416 build artifacts) | Not in `server.watch.ignored` | Build output fed back into watcher |
| 5 | **Bot starts on every `npm run dev`** | Scheduler ticks at 10s, launches Playwright | CPU contention with Vite bundling |
| 6 | **No Chromium memory limits** | Only `--disable-blink-features=AutomationControlled` | Each renderer allocates unbounded virtual memory |
| 7 | **No orphan cleanup on startup** | `launchPersistentContext` locks USER_DATA_DIR | Failed launches when orphans hold the lock |
| 8 | **No signal handler for graceful shutdown** | SIGKILL bypasses `context.close()` finally | Orphaned Chromium on Ctrl+C |

---

## Phase 1 — Stop the Bleeding (Critical)

**Goal:** Eliminate the immediate resource exhaustion that causes blank screens and BSODs.

### 1.1 — Expand Vite watch exclusions

**Files:** `vite.config.ts`, `server.ts` (Vite middleware config)

**Current exclusions** (only server-written runtime files):
```ts
ignored: ['**/activity_log.json', '**/artifacts/**', '**/.agent/**', '**/storage/**', '**/templates/**']
```

**Add these directories** (they exist but are NOT excluded from the Vite file watcher):
- `**/ppomppu_profile/**` — 72K Chromium profile files
- `**/node_modules/**` — should already be excluded by Vite default, but verify
- `**/.git/**` — should already be excluded by Vite default
- `**/.venv/**` — 1.3K Python files
- `**/dist/**` — build output
- `**/data/**` — Kakao DB data files
- `**/mempalace*/**` — if mempalace directories exist
- `**/kakaoauto-controller-preview/**` — nested project with its own `vite.config.ts` and `package.json`

**Also:** Clean the Vite cache (`rm -rf node_modules/.vite`) as part of the fix, since the 96MB cache may be corrupted from the previous runaway state.

### 1.2 — Disable debug artifacts by default

**File:** `.env`

Set:
```
PUBLISHER_DEBUG_SCREENSHOTS=false
PUBLISHER_DEBUG_TRACE=false
```

These are currently `true` in `.env` and write full-page screenshots + trace zips on every publisher run. They should only be enabled during active debugging sessions.

### 1.3 — Add Chromium memory/process limits

**File:** `bot.ts` (line 44, `CHROMIUM_LAUNCH_ARGS`)

Add:
- `--js-flags=--max-old-space-size=2048` — cap V8 heap per Chromium process
- `--disable-gpu` — skip GPU compositing (not needed for headless automation)
- `--disable-dev-shm-usage` — avoid /dev/shm issues in containers

Both the observer (line 813) and publisher (line 1241) spread `CHROMIUM_LAUNCH_ARGS`, so a single change covers both.

### 1.4 — Add SIGTERM/SIGINT graceful shutdown handler

**File:** `bot.ts` or `server.ts`

Register signal handlers that:
1. Set a module-level `shuttingDown = true` flag
2. Call `context.close()` on any active browser contexts (publisher and observer)
3. Stop the scheduler
4. Exit cleanly

This prevents orphaned Chromium processes when the user presses Ctrl+C.

### 1.5 — Kill orphaned Chromium on startup

**File:** `bot.ts` (before `launchPersistentContext`)

Before launching Chromium, check if another Chromium process holds the `USER_DATA_DIR` lock (`.lock` file exists + process is alive). If so, kill the orphan process before attempting a new launch. This prevents the "Target page, context or browser has been closed" error on the second publisher tick.

**Status:** Phase 1 is partially done — `DEV_SKIP_BOT` (env var + server gate) is already implemented.

---

## Phase 2 — Server-Side Safeguards (High)

**Goal:** Prevent unbounded memory growth and event-loop blocking in API endpoints.

### 2.1 — Paginate `/api/logs`

**File:** `server.ts` (line 334-337)

Add `?limit=N` (default 100, max 500) and `?before=timestamp` for cursor-based pagination. Update frontend consumer in `useAppData.ts` to request paginated logs.

### 2.2 — Add rate limiting middleware

**File:** `server.ts`

Install `express-rate-limit`. Apply to:
- `/api/logs` — 30 req/min
- `/api/analytics/competitors` — 10 req/min (expensive computation)
- `/api/trend-insights` — 10 req/min
- `/api/run-publisher` — 2 req/min
- `/api/run-observer` — 5 req/min
- All other API — 100 req/min (generous default)

### 2.3 — Replace `readFileSync` with async streaming for Kakao logs

**Files:** `server.ts` (lines 1398, 1444)

Replace `fs.readFileSync(logPath, "utf-8")` with:
- Async `fs.readFile` + line streaming for `/api/kakao/logs`
- For `/api/kakao/status` (just needs line count), use `wc -l` equivalent or read file in chunks

### 2.4 — Cap competitor analytics data structures

**File:** `lib/competitorAnalytics.ts`

Add max bounds to:
- `timeSeries` array length (cap at 500 buckets)
- `byAuthor` map entries (cap at 20 authors)
- `events` array (cap at 1000 events)

### 2.5 — Stream publisher history reads

**File:** `lib/publisherHistory.ts`

Read JSONL files line-by-line using `fs.createReadStream` + readline instead of loading entire files into memory.

### 2.6 — Fix pg.Pool leak on startup failure

**File:** `lib/kakaoDb.ts` (line 35)

Call `pool.end()` when `pool.connect()` fails during startup, instead of abandoning the pool object.

---

## Phase 3 — Frontend Resource Fixes (Medium)

**Goal:** Eliminate polling storms and unbounded state in React.

### 3.1 — Deduplicate publisher-status polling

**File:** `src/hooks/useAppData.ts` (lines 367-410)

Currently two intervals poll `/api/publisher-status`:
- 5s unconditional (line 368)
- 1.5s when running (line 334, triggered by `startPublisherPolling`)

Consolidate to one adaptive interval:
- 1.5s when `autoPublisher.running === true`
- 5s otherwise
- Use `useRef` for the interval ID to avoid cleanup races

### 3.2 — Stabilize useEffect dependency arrays

**File:** `src/hooks/useAppData.ts` (line 289-307)

The 60-second poll effect has 8 `useCallback` dependencies. When any changes, the entire effect re-runs (destroying and recreating intervals). Fix by:
- Using `useRef` for stable function references
- Or extracting the effect to a `useInterval` custom hook

### 3.3 — Paginate log consumption on frontend

**File:** `src/App.tsx`, `src/hooks/useAppData.ts`

After 2.1 is done, update the frontend to request paginated logs and accumulate them in state with a max size (e.g., last 200 entries).

### 3.4 — Debounce heavy endpoint polling

**File:** `src/hooks/useAppData.ts` (lines 169-173)

`fetchStats` hits 3 concurrent heavy endpoints. Debounce to 180s (currently fires every 60s).

---

## Phase 4 — Observability & Monitoring (Low)

**Goal:** Detect resource issues before they cause crashes.

### 4.1 — Resource health endpoint

**File:** `server.ts` (new route)

Add `GET /api/health/resources` returning:
- `process.memoryUsage()` (RSS, heapUsed, external)
- `process.cpuUsage()` (user/system seconds)
- Active browser context count
- Orphan Chromium process count (scan `ps` output or check `.lock` file)
- Disk usage of `artifacts/` directory
- File count of watched directories (alert if ppomppu_profile exceeds threshold)

### 4.2 — Artifact rotation

**File:** New `scripts/rotate-artifacts.ts`

Delete artifact directories older than 7 days. Run on server startup and optionally on a daily cron.

### 4.3 — Log warnings on resource thresholds

**File:** `bot.ts`, `server.ts`

Log warnings when:
- RSS exceeds 1GB
- Chromium process count > 6
- `artifacts/` exceeds 500MB
- Any single API response exceeds 5MB

### 4.4 — Add a `maxLogEntries` cap to activity log

**File:** `bot.ts` (where logs are appended)

Rotate `activity_log.json` when it exceeds 1000 entries (keep last 500). Or switch to daily JSONL files with automatic cleanup.

---

## Implementation Order

### Phase 1 — DONE (2026-05-12)

- [x] 1.1 Vite watch exclusions + cache clean — `vite.config.ts`, `server.ts` (added 12 ignored patterns)
- [x] 1.2 Disable debug artifacts — `.env` set `PUBLISHER_DEBUG_SCREENSHOTS=false`, `PUBLISHER_DEBUG_TRACE=false`
- [x] 1.3 Chromium memory limits — `bot.ts` added `--js-flags=--max-old-space-size=2048`, `--disable-gpu`, `--disable-dev-shm-usage`
- [x] 1.4 Signal handlers — `bot.ts` added SIGINT/SIGTERM handlers with `shutdownBrowser()`
- [x] 1.5 Orphan cleanup — `bot.ts` added `killOrphanChromium()` called before `launchPersistentContext`
- [x] 1.6 Resource GC + monitoring — New `lib/resourceMonitor.ts` with artifact rotation, log pruning, threshold checks
- [x] 1.7 API endpoints — `GET /api/health/resources`, `POST /api/resource/gc`
- [x] 1.8 Startup GC — `server.ts` runs `runGarbageCollection()` + `checkResourceThresholds()` on boot
- [x] 1.9 Dev mode gate — `DEV_SKIP_BOT=true` in `.env`, skips scheduler/observer/publisher

### Phase 2 — DONE (2026-05-12)

| Item | Status | Notes |
|------|--------|-------|
| 2.1 Log pagination | DONE | `?limit=N` (default 200, max 500), returns `{ logs, hasMore, oldestTimestamp, totalCount }` |
| 2.2 Rate limiting | DONE | `express-rate-limit` installed. Per-endpoint: logs=30/min, analytics=10/min, publisher=2/min, observer=5/min, default=100/min. Kakao webhook excluded. |
| 2.3 Async file reads | DONE | `/api/kakao/status` and `/api/kakao/logs` now use `fs.promises.readFile` |
| 2.4 Analytics caps | DONE | `sortedWindow` capped at 500, `events` at 1000, `summary` at 20 authors, `timeSeries` at 500 buckets, `heatmap.cells` at 500, `byAuthor` only for 20 botAuthors |
| 2.5 History streaming | SKIPPED | Already uses async reads + per-file reverse iteration. Daily JSONL files are small. |
| 2.6 Pool leak fix | DONE | `pool.end()` called before `pool = null` on connection failure in `lib/kakaoDb.ts` |

### Phase 3 — DONE (2026-05-12)

| Item | Status | Notes |
|------|--------|-------|
| 3.1 Poll deduplication | DONE | Consolidated to single 5s base interval + 1.5s step poll when running. Removed double polling. |
| 3.2 Effect stabilization | DONE | All mount effect deps are `useCallback` with `[]` — stable. Removed unused sequence refs. |
| 3.3 Frontend pagination | DONE | `fetchLogs` requests `?limit=200`, extracts `data.logs`. Response shape: `{ logs, hasMore, oldestTimestamp, totalCount }` |
| 3.4 Debounce heavy polls | DONE | `fetchStats` debounced to 180s (was firing every 60s + on silent refresh) |

### Phase 4 — DONE (monitoring, merged into Phase 1)

- [x] 4.1 Resource endpoint — `GET /api/health/resources` returns full metrics
- [x] 4.2 Artifact rotation — `runGarbageCollection()` deletes dirs >7 days old
- [x] 4.3 Threshold warnings — `checkResourceThresholds()` logs on startup + per-request
- [x] 4.4 Log rotation — `rotateActivityLog()` caps at 1000 entries, keeps 500

## Dependencies Between Phases

- Phase 2.1 (log pagination) → Phase 3.3 (frontend pagination) — server change first
- ~~Phase 1.2 (disable debug artifacts) → Phase 4.4 (log rotation)~~ — Phase 4.4 DONE in Phase 1
- ~~Phase 4.2 (artifact rotation) needs Phase 1.2 done first~~ — DONE in Phase 1

## Notes from Gemini Observations

- 55GB+ VSZ persists even with bot disabled — confirms the Vite watcher + tsx compilation of `ppomppu_profile/` is the primary VSZ contributor, not Playwright
- 75,592 files outside `.git`/`node_modules` being watched — Vite's file watcher is under massive pressure
- `kakaoauto-controller-preview/` is a nested project with its own `vite.config.ts` and `package.json` — could cause tsx/Vite dependency resolution loops
- Vite cache (`node_modules/.vite/`) was 96MB — may be corrupted from runaway compilation
- Inotify limit is 1,048,576 (high enough) — not the bottleneck
- No symlink loops found — ruled out as a cause
- VS Code server + Claude Code binary together claim ~130GB VSZ — this is the tooling environment, not our app, but adds to host page file pressure
