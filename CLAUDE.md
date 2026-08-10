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
| `lib/analytics/` | Derived numbers from history, no browser and no state writes: `trends.ts` (hourly post-rate profile, scheduler interval multiplier, share of voice), `schedulerSignals.ts` and `schedulerDiagnostics.ts` (signal classification and its bound-calibration view), `boardStats.ts` (the `/api/board-stats` and `/api/competitor-stats` summaries), `competitors.ts` (competitor EDA payload). `boardStats.ts` takes `ourAuthorSubstring` as an argument — routes pass `ENV.OUR_AUTHOR_SUBSTRING`, never a literal. |
| `lib/logging/` | `logger` (pino) and `LOG_EVENT`. Always imported together. `lib/logCache.ts` is *not* part of this module — it caches `activity_log.json`, and folding it in would make logging and `resourceMonitor` mutually importing. |
| `lib/browser/` | Chromium lifecycle: shared browser and contexts, page debug handlers, `evaluate()` name polyfill. Absorbed the former `lib/playwright/`. |
| `lib/kakao/` | KakaoTalk skill: payload types and validator, Postgres message log (`db`, a namespace export), auto-reply. |
| `lib/state/` | **Single source of truth for runtime state.** In-memory controls + atomic persistence to `ARTIFACTS_DIR/runtime-controls.json` with optimistic concurrency (`stateVersion`). Import only from `lib/state/index.js`. Replaced `lib/controls.ts` and `lib/runtimeControls.ts`, both deleted 2026-08-08. |
| `lib/resourceMonitor.ts` | Garbage collection and resource metrics. `PUBLISHER_RUNS_DIR` is scoped to `artifacts/publisher-runs/` — **not** all of `ARTIFACTS_DIR`. Widening it would delete the competitor-intel database. |
| `lib/competitor-intel/` | Crawlee-based competitor ad extraction pipeline. Hybrid: Cheerio noise reduction → Ollama structured extraction. Entry: `scripts/competitor-ads-intel.ts`. See AGENTS.md for operational guide and `.planning/competitor-intel-playbook.md` for extraction knowledge base. |
| `config/product-catalog.json` | **Source of truth** for product name mapping. Vendors use varied names for the same product — this JSON maps regex patterns to canonical names. **Do not add product names in TypeScript code** — add entries to this JSON file. See `.agent/knowledge/product-catalog.md` for the workflow. |
| `lib/competitor-store/` | SQLite corpus of extracted ads (`sqlite.ts`) and the dashboard read model over it (`queries.ts`). **Not** inside `lib/competitor-intel/`: that barrel re-exports the Crawlee crawler, and `routes/api/logs.ts` opens this database on every dashboard request. Dependency runs one way, intel → store. |
| `lib/competitor-ad-parser/` | Deterministic Cheerio-based Ppomppu ad HTML parser (`parsePpomppuPost`). No browser needed. Used by `scripts/competitor-ads-intel.ts`. |
| `lib/parser/` | DOM projection system (`subtree`, `pageOutline`, `snapshotDiff`). Used by observer and parser MCP. |

## Frontend

| File | Role |
|------|------|
| `src/App.tsx` | Shell and routing only (156 lines). State lives in `src/hooks/`, views in `src/pages/`. |
| `src/hooks/useAppData.ts` | Dashboard data orchestration: fetching, polling, refresh. The former App.tsx god-object's state layer. |
| `src/pages/` | One file per route: Overview, Operations, Controls, PublisherRuns, CompetitorIntel, KakaoDashboard, Analytics. |
| `src/PipelineCanvas.tsx` | ReactFlow canvas. Prop `currentStep: PipelineStepId`. Six stages: `navigate → login-page → login → write-post → restore-draft → publish`. |
| `src/pages/AnalyticsPage.tsx` | Competitor EDA shell for `/analytics`: filter sidebar, KPI row, tab bar. Lazy-loaded in `src/main.tsx` so recharts stays out of the main chunk. |
| `src/hooks/useCompetitorAnalytics.ts` | Filter state + fetch for `/api/analytics/competitors`. The page owns view state only. |
| `src/components/analytics/` | One file per tab (`MarketTab`, `RankingsTab`, `BotIntelTab`) plus the pieces two of them share: `Heatmap`, `AuthorDrawer`, `BotBadge`, `KpiCard`. |

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

`.structure.json` is the machine-readable version of this section, enforced by
`npm run lint:structure` (part of `npm run lint`, and a separate CI step). The root
is an **allowlist**: a new file or directory there fails the build until it is
declared with a reason. Root-level markdown is limited to `README.md` (humans),
`CLAUDE.md` (this file), and `AGENTS.md`. New agent-facing docs go in `.agent/`,
not the root.

The same file also declares module entry points (`lib/state`, `lib/publisher`, …
must be imported through their `index.ts`) and a 500-line size budget with named
exemptions. The module rule is a **ratchet**: today's 76 violations are recorded as
`module_boundary_baseline`, and adding a 77th fails. Lower the number whenever a
refactor drops it — `lint:structure` prints the new value. Install the matching
pre-commit hook with `npm run hooks:install`.

**When a `lib/` entry becomes a directory:** it owns a domain concept with more
than one file's worth of behavior, and it gets an `index.ts` plus an entry in
`module_entry_points`. A single-purpose utility with no internal structure stays
a loose file. A loose file that grows a companion becomes a directory in the
same change.

## Spec-Kit Layout

`.planning/spec-kit/` holds three kinds of document, and the directory says which:

| Path | Contents | Status field |
|------|----------|--------------|
| `contracts/` | Behavior contracts, policies, rulesets. **Loaded at runtime** by `config/runtime-validation.ts` and `lib/observer/policyLoader.ts` | None — a contract is current or superseded, never "done" |
| `reference/` | Reviewer pack: API/route catalogs, screen inventories, design guidelines, risk registers | None |
| `specs/active/` | In-flight and proposed work. **The only directory to read when orienting** | `proposed` or `active` |
| `specs/shipped/` | Implemented; kept for the design rationale | `shipped` |
| `specs/archive/` | Superseded or abandoned | `superseded` |
| `plans/`, `tasks/`, `manifest/` | Execution plans, task lists, runtime manifests and JSON schemas | None |

Status vocabulary is **closed** — `proposed | active | shipped | superseded` — and
the directory must agree with the field. `npm run lint:structure` fails on a
mismatch, an unknown status, a spec loose in `specs/`, or a status field appearing
on a contract. Markdown specs declare status in YAML frontmatter.

`contracts/` is the only spec-kit directory besides `manifest/` copied into the
Docker image. A file the runtime reads belongs there, not in `specs/`.

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
