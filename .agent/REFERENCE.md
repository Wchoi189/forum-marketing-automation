# Reference

Lookup tables moved out of `CLAUDE.md` so the always-loaded context stays small.
Read a section when you need it. Verify against the code before relying on a row:
the API table is known to lag the routes (tracked in
`.planning/initiatives/publisher-modernization/specs/active/r5-doc-and-contract-drift-v1.json`).
For env vars, `config/env.ts` is canonical.

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
| POST | `/api/session/import` | Bearer `SESSION_IMPORT_SECRET`. Body `{ cookies, source? }` (browser cookie export). Probes the board with the merged cookies and saves only when `logged_in`. `200 imported\|unchanged`, `422` not logged in, `409` publisher running, `503` secret unset. |

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
| `SESSION_IMPORT_SECRET` | _(absent)_ | Bearer secret for `/api/session/import`; endpoint returns 503 when absent. Generated into `.env.docker` by `npm run session:sync-setup` |

Full parsing in `config/env.ts`. Schema in `.planning/spec-kit/manifest/schemas/env.schema.json`.

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
