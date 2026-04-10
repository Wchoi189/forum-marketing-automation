# Code Map

## Server / Bot

| File | Role |
|------|------|
| `server.ts` | Express app factory + `startScheduler()`. Scheduler starts `enabled=true` by default. |
| `bot.ts` | `runObserver()` and `runPublisher()`. Both are **blocking** — HTTP callers wait for full completion. Observer always runs *inside* publisher as the gap-check first step. |
| `config/env.ts` | All env var parsing and defaults. Only place to read/write env. |
| `contracts/models.ts` | Shared TS types for API responses and DB records. |
| `lib/playbookRunner.ts` | Executes JSON playbook steps in order. Step IDs: `navigate-board`, `click-write`, `open-saved-drafts`, `confirm-load-draft-modal`, `verify-required-body`, `set-youtube-category`, `submit-post`. |
| `lib/publisher/flow/runPublisherFlow.ts` | Splits playbook into non-submit and submit halves. Runs non-submit sequentially, then submit in parallel with `waitForPublishLandingUrl`. |
| `lib/publisherStepStore.ts` | Shared in-memory step tracker. Written by `bot.ts` as publisher progresses; read by `GET /api/publisher-status`. |
| `lib/publisherHistory.ts` | Append-only JSONL + Parquet log of every publisher run. |
| `lib/trendInsights.ts` | Hourly post-rate profile and scheduler interval multiplier from activity logs. |
| `lib/runtimeControls.ts` | Persisted gap threshold file override (read/write). |

## Frontend

| File | Role |
|------|------|
| `src/App.tsx` | All dashboard state, routing, and API calls (~1800 lines). Four route-driven views: Overview / Operations / Controls / Publisher Runs. |
| `src/PipelineCanvas.tsx` | ReactFlow canvas. Prop `currentStep: PipelineStepId`. Six stages: `navigate → login-page → login → write-post → restore-draft → publish`. |
| `src/AnalyticsPage.tsx` | Competitor EDA charts. Standalone route `/analytics`. |

## Non-Obvious Architecture Facts

**Publisher execution order:**
1. `runObserver()` — gap check; skip publish if gap too small (`gap_policy` decision)
2. `chromium.launchPersistentContext` — reuses saved session; login only triggered if write button absent
3. `runPublisherFlow` — non-submit playbook steps, then submit + URL verification in parallel
4. Success requires verified redirect to board list/view URL, not just a successful click

**Scheduler:** Calls `runPublisher(false)` on each tick. Skips tick if `running=true`. Gap-policy skip is logged as non-success but is normal operation, not an error.

**Pipeline step tracking:** `publisherStepStore.ts` → `GET /api/publisher-status` (non-blocking). App.tsx polls every 1.5s when `loading || autoPublisher.running`. Mapping: `playbookStepToCanvasStep()` in `publisherStepStore.ts`.

**Observer refresh:** `POST /api/run-observer` blocks for 5–30s. App.tsx fires `silentRefreshObserver()` (no loading state) on mount and after every publish run.

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

## Key Env Vars

| Var | Default | Effect |
|-----|---------|--------|
| `DRY_RUN_MODE` | `false` | Skips submit click; records `dry_run` decision |
| `BROWSER_HEADLESS` | `true` | Set `false` to watch browser |
| `RUN_INTERVAL_MINUTES` | `60` | Scheduler base interval |
| `MANUAL_OVERRIDE_ENABLED` | `true` | Gates force-publish |
| `PUBLISHER_DEBUG_SCREENSHOTS` | `false` | Saves step screenshots to `artifacts/` |
| `PUBLISHER_DEBUG_TRACE` | `false` | Saves Playwright trace zip |
| `OUR_AUTHOR_SUBSTRING` | `'shareplan'` | Substring matched (case-insensitive) to identify our posts for SoV computation |
| `XAI_API_KEY` | _(absent)_ | Enables Grok 4 AI advisor. If absent, advisor endpoints return `null` recommendation |
| `AI_ADVISOR_ENABLED` | `true` | Kill-switch for advisor without removing the API key |
| `AI_ADVISOR_TIMEOUT_MS` | `8000` | Per-call timeout in ms (1000–30000). Advisor skips on timeout |

Full parsing in `config/env.ts`. Schema in `.planning/spec-kit/manifest/schemas/env.schema.json`.

## Operational Rules

See `AGENTS.md` — publisher success criteria, env var discipline, selector strategy, regression checklist.
