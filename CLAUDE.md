# Code Map

## Server / Bot

| File | Role |
|------|------|
| `server.ts` | Express app factory + `startScheduler()` (skipped when `DEV_SKIP_BOT=true`). Scheduler starts `enabled=true` by default. |
| `bot.ts` | `runObserver()` and `runPublisher()`. Both are **blocking** — HTTP callers wait for full completion. Observer always runs *inside* publisher as the gap-check first step. |
| `config/env.ts` | All env var parsing and defaults. Only place to read/write env. |
| `contracts/models.ts` | Shared TS types for API responses and DB records. |
| `lib/playbookRunner.ts` | Executes JSON playbook steps in order. Step IDs: `navigate-board`, `click-write`, `open-saved-drafts`, `confirm-load-draft-modal`, `verify-required-body`, `set-youtube-category`, `submit-post`. |
| `lib/publisher/flow/runPublisherFlow.ts` | Splits playbook into non-submit and submit halves. Runs non-submit sequentially, then submit in parallel with `waitForPublishLandingUrl`. |
| `lib/publisherStepStore.ts` | Shared in-memory step tracker. Written by `bot.ts` as publisher progresses; read by `GET /api/publisher-status`. |
| `lib/publisherHistory.ts` | Append-only JSONL + Parquet log of every publisher run. |
| `lib/trendInsights.ts` | Hourly post-rate profile and scheduler interval multiplier from activity logs. |
| `lib/state/` | **Single source of truth for runtime state.** In-memory controls + atomic persistence to `ARTIFACTS_DIR/runtime-controls.json` with optimistic concurrency (`stateVersion`). Import only from `lib/state/index.js`. Replaced `lib/controls.ts` and `lib/runtimeControls.ts`, both deleted 2026-08-08. |
| `lib/resourceMonitor.ts` | Garbage collection and resource metrics. `PUBLISHER_RUNS_DIR` is scoped to `artifacts/publisher-runs/` — **not** all of `ARTIFACTS_DIR`. Widening it would delete the competitor-intel database. |
| `lib/competitor-intel/` | Crawlee-based competitor ad extraction pipeline. Hybrid: Cheerio noise reduction → Ollama structured extraction. Entry: `scripts/competitor-ads-intel.ts`. See AGENTS.md for operational guide and `.planning/competitor-intel-playbook.md` for extraction knowledge base. |
| `config/product-catalog.json` | **Source of truth** for product name mapping. Vendors use varied names for the same product — this JSON maps regex patterns to canonical names. **Do not add product names in TypeScript code** — add entries to this JSON file. See `.agent/knowledge/product-catalog.md` for the workflow. |
| `lib/competitor-ad-parser/` | Deterministic Cheerio-based Ppomppu ad HTML parser (`parsePpomppuPost`). No browser needed. Used by `scripts/competitor-ads-intel.ts`. |
| `lib/parser/` | DOM projection system (`subtree`, `pageOutline`, `snapshotDiff`). Used by observer and parser MCP. |

## Frontend

| File | Role |
|------|------|
| `src/App.tsx` | Shell and routing only (156 lines). State lives in `src/hooks/`, views in `src/pages/`. |
| `src/hooks/useAppData.ts` | Dashboard data orchestration: fetching, polling, refresh. The former App.tsx god-object's state layer. |
| `src/pages/` | One file per route: Overview, Operations, Controls, PublisherRuns, CompetitorIntel, KakaoDashboard. |
| `src/PipelineCanvas.tsx` | ReactFlow canvas. Prop `currentStep: PipelineStepId`. Six stages: `navigate → login-page → login → write-post → restore-draft → publish`. |
| `src/AnalyticsPage.tsx` | Competitor EDA charts. Standalone route `/analytics`. Largest frontend file (799 lines) — decomposition candidate. |

## Non-Obvious Architecture Facts

**Publisher execution order:**
1. `runObserver()` — gap check; skip publish if gap too small (`gap_policy` decision)
2. `chromium.launchPersistentContext` — reuses saved session; login only triggered if write button absent
3. `runPublisherFlow` — non-submit playbook steps, then submit + URL verification in parallel
4. Success requires verified redirect to board list/view URL, not just a successful click

**Scheduler:** Calls `runPublisher(false)` on each tick. Skips tick if `running=true`. Gap-policy skip is logged as non-success but is normal operation, not an error.

**ppomppu login recovery gotchas:**
- The `loginPromptVisible` diagnostic is **unreliable on the redirect hop**. When ppomppu redirects unauthenticated requests to `login.php?r_url=...`, the intermediate page shows "403 Forbidden" (nginx) or "Loading..." as its title — no "로그인" text exists in the body. The code now attempts login unconditionally whenever the write button is missing.
- ppomppu WAF returns 403 on Playwright's default headless user agent. `DEFAULT_BROWSER_USER_AGENT` in `config/env.ts` is required, not optional.

**Pipeline step tracking:** `publisherStepStore.ts` → `GET /api/publisher-status` (non-blocking). `src/hooks/useAppData.ts` runs a single adaptive interval: 5s base, dropping to 1.5s step polling while the publisher is running. Mapping: `playbookStepToCanvasStep()` in `publisherStepStore.ts`.

**Observer refresh:** `POST /api/run-observer` blocks for 5–30s. `src/hooks/useAppData.ts` fires `silentRefreshObserver()` (no loading state) on mount and after every publish run.

## API Surface

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/logs` | `ActivityLog[]` from `activity_log.json` |
| GET | `/api/board-stats` | `{ turnoverRate, shareOfVoice }` derived from logs |
| GET | `/api/competitor-stats` | `CompetitorStat[]` from logs |
| GET | `/api/trend-insights` | Hourly profile + scheduler multiplier |
| GET | `/api/control-panel` | Full scheduler + observer state. `autoPublisher.running` = actively publishing. `nextTickEta` = ISO string of next attempt. |
| POST | `/api/control-panel` | Save controls. Body = `ControlPanelState`. |
| POST | `/api/run-observer` | **Blocking** 5–30s. Returns `{ success, log }`. |
| POST | `/api/run-publisher` | **Blocking** 30–120s. Returns `PublisherRunResult`. |
| GET | `/api/publisher-status` | `{ step: PublisherCanvasStep\|null, running: bool }`. Non-blocking. |
| GET | `/api/publisher-history` | `PublisherHistoryEntry[]`. Query: `?limit=N`. |
| GET | `/api/ai-recommendation` | `{ recommendation: AiAdvisorOutput\|null, contextBuiltAt, source }`. Returns `null` if `XAI_API_KEY` absent or advisor disabled. |
| GET | `/api/health/resources` | RSS, heap, artifacts size, activity log count, browser profile stats, Chromium process count, threshold warnings. |
| POST | `/api/resource/gc` | Triggers artifact rotation (deletes dirs >7 days old) and activity log pruning. Returns summary. |

## Key Env Vars

| Var | Default | Effect |
|-----|---------|--------|
| `DRY_RUN_MODE` | `false` | Skips submit click; records `dry_run` decision |
| `BROWSER_HEADLESS` | `true` | Set `false` to watch browser |
| `RUN_INTERVAL_MINUTES` | `60` | Scheduler base interval |
| `MANUAL_OVERRIDE_ENABLED` | `true` | Gates force-publish |
| `PUBLISHER_DEBUG_SCREENSHOTS` | `false` | Saves step screenshots to `artifacts/` |
| `PUBLISHER_DEBUG_TRACE` | `false` | Saves Playwright trace zip |
| `DEV_SKIP_BOT` | `false` | Skips scheduler/observer/publisher. Use during `npm run dev` to avoid resource contention between Vite and Playwright |
| `OUR_AUTHOR_SUBSTRING` | `'shareplan'` | Substring matched (case-insensitive) to identify our posts for SoV computation |
| `XAI_API_KEY` | _(absent)_ | Enables Grok 4 AI advisor. If absent, advisor endpoints return `null` recommendation |
| `AI_ADVISOR_ENABLED` | `true` | Kill-switch for advisor without removing the API key |
| `AI_ADVISOR_TIMEOUT_MS` | `8000` | Per-call timeout in ms (1000–30000). Advisor skips on timeout |
| `NL_WEBHOOK_ENABLED` | `true` | Kill-switch for `/api/nl-command`. Returns 503 when false |
| `NL_WEBHOOK_SECRET` | _(absent)_ | If set, requests must include `Authorization: Bearer <secret>` |

Full parsing in `config/env.ts`. Schema in `.planning/spec-kit/manifest/schemas/env.schema.json`.

## Workspace Layout

| Path | Contents |
|------|----------|
| `.agent/` | Agent-facing docs: `ARCHITECTURE.md`, `OPERATIONS.md`, `KNOWN_ISSUES.md`, contracts, knowledge, session handovers |
| `.planning/` | Specs, roadmaps, audits, known-issue writeups |
| `archive/` | Frozen, unreferenced content. Nothing here is loaded at runtime. See `archive/README.md` |
| `artifacts/`, `data/`, `dist/` | Generated. All gitignored — do not commit files here |

Root-level markdown is limited to `README.md` (humans), `CLAUDE.md` (this file),
and `AGENTS.md`. New agent-facing docs go in `.agent/`, not the root.

**Retention:** every directory that grows without bound has an owner row in the
table in `.agent/OPERATIONS.md`. Add one when you add such a directory.
`npm run clean:all -- --dry-run` shows what is prunable.

## Environment Loading

`config/env.ts` calls `dotenv.config()` **without** `override: true`, so explicit
process environment beats `.env`. That is what lets Docker, CI, and
`scripts/run-tests.sh` redirect paths. Restoring `override: true` re-breaks them.

Tests run through `scripts/run-tests.sh`, which points `ARTIFACTS_DIR`,
`BOT_PROFILE_DIR`, and `ACTIVITY_LOG_PATH` at a temp directory removed on exit.
Never write a test that assumes `PROJECT_ROOT + "artifacts"`.

Absolute host paths in source (`/parent/…`, `/app/…`, `/home/…`) are rejected by
`.ast-grep/rules/no-absolute-host-paths.yml`.

## Operational Rules

See `AGENTS.md` — publisher success criteria, env var discipline, selector strategy, regression checklist.
