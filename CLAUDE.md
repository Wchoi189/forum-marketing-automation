# Decision Authority

Default to execution. The operator's mid-session and end-of-session answers have
not improved outcomes and have added failure points; every question you skip
saves them a decision. Full protocol: `.agent/SESSION_PROTOCOL.md`.

1. **Decide from what exists.** If project principles, git history, the KEDB, or
   developer ergonomics settle a choice, make it. Do not ask, do not offer
   options, do not ask "now or later". If doing X completes the goal, do X.
2. **Make the call, act, log it.** For ambiguity or a close trade-off, take the
   reversible option, execute, and record it as a decision in the closing summary.
3. **Known false positives get the documented fix immediately**, with no
   confirmation. An undocumented gate failure is investigated, not escalated.
4. **Ask only when an action is** (a) irreversibly destructive — force-push,
   deleting work you did not create, deleting `artifacts/` databases; (b) an
   outward effect the task did not call for — a real ppomppu publish, posting
   credentials; or (c) in direct conflict with an instruction given this session.
   Never weaken a fail-closed publisher check or retry login without a Turnstile
   token (KE-004): that is not a question, the answer is no.
5. **Commit by default.** Finished work is committed in the same turn, on a
   branch (never on `main`). Stage explicit paths only, never `git add -A`: the
   tree often holds files from another session. No push or PR unless asked.
6. **Short closing.** What changed, what is next, a few lines. No operator-step
   lists, no restated blockers, no verification tallies, no closing question.
7. **Handover only when work stops unfinished** (context past ~4/5, or an
   external blocker). Say once, in one sentence, past ~2/3. Never for routine
   endings. A spec implementation session or milestone ends with the five-heading
   summary in the protocol file.

Hooks in `.claude/settings.json` enforce items 4–5 mechanically (blanket staging, force
push, `commit -a`, commits on `main`, `rm -r artifacts/`). A block names the safe
alternative: take it, do not ask.

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
- The `loginPromptVisible` diagnostic is **unreliable on the redirect hop**. When ppomppu redirects unauthenticated requests to `login.php?r_url=...`, the intermediate page shows "403 Forbidden" (nginx) or "Loading..." as its title — no "로그인" text exists in the body.
- **The write button is not a session signal** — guests see 글쓰기 too. `getBoardDiagnostics().sessionState` reads the header (`로그아웃` link vs `a.gnb-btn-login`); gate on `isSessionUsable()`.
- **The bot cannot log itself in.** Since 2026-10 the login form carries Cloudflare Turnstile; an expired session surfaces as `PUBLISHER_LOGIN_REQUIRED: reason=turnstile_unsolved` and needs a human-exported session (`npm run session:import`, runbook in `.agent/OPERATIONS.md`). Never add retries that post credentials without a Turnstile token (KE-004).
- ppomppu WAF returns 403 on Playwright's default headless user agent. `DEFAULT_BROWSER_USER_AGENT` in `config/env.ts` is required, not optional.

**Pipeline step tracking:** `publisherStepStore.ts` → `GET /api/publisher-status` (non-blocking). `src/hooks/useAppData.ts` runs a single adaptive interval: 5s base, dropping to 1.5s step polling while the publisher is running. Mapping: `playbookStepToCanvasStep()` in `publisherStepStore.ts`.

**Observer refresh:** `POST /api/run-observer` blocks for 5–30s. `src/hooks/useAppData.ts` fires `silentRefreshObserver()` (no loading state) on mount and after every publish run.

## Reference Tables

API surface, key env vars and the spec-kit layout live in `.agent/REFERENCE.md`. Env parsing is canonical in `config/env.ts`.

## Workspace Layout

| Path | Contents |
|------|----------|
| `.agent/` | Agent-facing docs: `ARCHITECTURE.md`, `OPERATIONS.md`, `KNOWN_ISSUES.md`, `SESSION_PROTOCOL.md`, `REFERENCE.md`, contracts, knowledge, session handovers |
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
