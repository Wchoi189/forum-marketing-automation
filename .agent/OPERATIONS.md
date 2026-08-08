# Operations Guide

## Publisher Success Criteria

"Success" means more than a click:
- Draft is loaded into editor (required body text present).
- Submit action is triggered.
- URL transitions to a board list/view URL (not write screen).

If any criterion fails, return an error (do not emit optimistic success).

## Debug Artifact Workflow

### Environment Toggles

| Variable | Purpose |
|----------|---------|
| `PUBLISHER_DEBUG_SCREENSHOTS=true` | Step screenshots |
| `PUBLISHER_DEBUG_TRACE=true` | Playwright trace recording |
| `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT` (0–100) | Fraction of successful runs to persist trace |

Artifacts stored under `artifacts/publisher-runs/<timestamp>/`.

On failure, always capture `error.png` when a page exists.

### Trace Replay

```bash
npx playwright show-trace <path-to-trace.zip>
```

### Escalation

Temporarily set `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT=100` (and optionally `LOG_LEVEL=debug`).

## Retention & Garbage Collection

Every directory that grows without bound has exactly one owner listed here. If
you add a directory that accumulates files, add a row — an unowned directory is
how `.agent/session-handovers/` reached 49 files and `artifacts/` reached 13 MB
inside git.

| Path | Grows from | Retention | Enforced by |
|------|-----------|-----------|-------------|
| `artifacts/publisher-runs/` | Debug screenshots and traces | Delete dirs older than 7 days; hard cap 500 MB, oldest-first | `rotateArtifacts()` + `capArtifactsBySize()` |
| `artifacts/*.tmp` | Interrupted atomic writes | Delete when older than 1 hour | `cleanOrphanedTempFiles()` |
| `activity_log.json` | Every observer/publisher run | Truncate to newest 500 once it exceeds 1000 | `rotateActivityLog()` |
| `.agent/session-handovers/` | One file per agent session | Keep newest 10, move rest to `archive/` | `rotateSessionHandovers()` |
| `ppomppu_profile/` | Chromium caches | Rebuildable cache subdirs deleted | `cleanBrowserProfile()` |
| `artifacts/competitor-ads/` | Intel pipeline (SQLite + LLM cache) | **Durable — never collected** | — |
| `artifacts/kakao-history/` | Kakao ingest | **Durable — never collected** | — |
| `artifacts/runtime-controls.json` | Control panel writes | **Durable — never collected** | — |
| `artifacts/publisher-history.json` | Publisher run log | **Durable — never collected** | — |
| `data/` | Kakao pipeline inputs and outputs | **Durable — never collected.** Untracked from git 2026-08-08; raw records backed up outside the repo | — |
| `dist/`, `node_modules/.vite/` | Builds | Manual | `npm run clean:all` |

`runGarbageCollection()` runs at startup and every 6 hours, production only
(`NODE_ENV=production && !DEV_SKIP_BOT`). Trigger it manually with
`POST /api/resource/gc`.

**GC scope is `artifacts/publisher-runs/`, not `artifacts/`.** The module-local
`PUBLISHER_RUNS_DIR` in `lib/resourceMonitor.ts` is deliberately narrower than
`ENV.ARTIFACTS_DIR`. Widening it would delete the competitor-intel database.
`tests/unit/resourceMonitor.test.ts` guards this.

`npm run clean:all` prunes regenerable files on demand; `-- --dry-run` lists
what it would remove without deleting.

## Selector Strategy

- Prefer stable class/text combinations and scoped locators over absolute XPath.
- Use XPath only as a scoped fallback when sibling relationships are the only reliable signal.
- Keep locators resilient to duplicated labels in list rows/modals.

## Regression Prevention

| Change Type | Command |
|-------------|---------|
| Code edits | `npm run lint` |
| API/publisher changes | `npm run test:integration` |
| Parser/runtime changes | `npm run test` |

Do not weaken fail-closed checks without explicit approval.

## Gap Health Semantics

**`gap` = number of posts AHEAD of ours** (`sharePlanIndex` in `bot.ts`).

`SAFE` means gap ≥ threshold — safe to publish NOW. It is NOT a system health indicator.

| Gap | Meaning |
|-----|---------|
| 0–threshold, rising | Normal — just published |
| ≈ threshold | Normal — about to publish |
| threshold+1 to +2 | Acceptable overshoot |
| threshold+3 to +5 | Warning — recheck loop slow |
| threshold+6+ | **Critical** — scheduler stalled |

**Do not be misled by `Decision: SAFE` in logs.** A gap of 14 with threshold 4 means we are 10 posts overdue.

Confirm via `GET /api/control-panel` → `lastObserverResult`.

**Scheduler is gap-driven, not time-driven.** After successful publish, enters gap-recheck mode (3min → 1.5min → 30s). Base interval (60 min) applies only after errors. See [KE-001](KNOWN_ISSUES.md) if 60-min gaps appear.