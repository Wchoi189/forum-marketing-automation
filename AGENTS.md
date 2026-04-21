# Agent Operating Guide

This project runs a Playwright-based observer/publisher workflow for the Ppomppu OTT board.

## Primary Goals
- Keep publishing behavior deterministic and fail-closed.
- Preserve contract alignment between runtime code and spec-kit manifests.
- Avoid silent regressions in publisher steps (draft load, modal confirm, submit, redirect verification).

## Semantic Spec Goals
- Keep specs machine-readable and semantically meaningful.
- Every major spec should state:
  - `purpose` (why this spec exists),
  - `design_intent` (what decision it protects),
  - `change_impact` (who/what is affected by changes).
- Prefer concise structured fields over long prose.

## Environment Variable Ground Rules
- Canonical runtime parsing/validation lives in `config/env.ts`.
- Canonical contract list lives in `.agent/contracts/env.contract.json`.
- Canonical schema constraints live in `.planning/spec-kit/manifest/schemas/env.schema.json`.
- When adding/changing any env var, update all three files in the same change.
- Never log or commit secret values (for example `PPOMPPU_USER_PW`).

## Publisher Success Criteria
- "Success" means more than a click:
  - Draft is loaded into editor (required body text present).
  - Submit action is triggered.
  - URL transitions to a board list/view URL (not write screen).
- If any criterion fails, return an error (do not emit optimistic success).

## Debug Artifact Workflow
- Optional env toggles:
  - `PUBLISHER_DEBUG_SCREENSHOTS=true` for step screenshots.
  - `PUBLISHER_DEBUG_TRACE=true` to record a Playwright trace for the publisher browser session.
  - `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT` (0–100): when tracing is enabled, fraction of **successful** runs that persist `trace.zip`. Failures always persist the trace. Use `100` for legacy "save every trace" behavior; default `0` is failure-only persistence.
- Artifacts are stored under `artifacts/publisher-runs/<timestamp>/` (and `artifacts/publisher-runs/failures/<timestamp>/error.png` when no run dir was allocated).
- On publisher failure, always capture `error.png` when a page exists.
- For trace replay: `npx playwright show-trace <path-to-trace.zip>`.
- Escalation: temporarily set `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT=100` (and optionally `LOG_LEVEL=debug` to see `publisher.artifacts.trace.discarded` when sampling skips success traces).

## Selector Strategy
- Prefer stable class/text combinations and scoped locators over absolute XPath.
- Use XPath only as a scoped fallback when sibling relationships are the only reliable signal.
- Keep locators resilient to duplicated labels in list rows/modals.

## UI Refactor Guidelines
- Target a SaaS-style app shell with persistent left navigation and route-driven pages.
- Use "one page, one primary decision" to reduce dashboard sprawl.
- Keep data orchestration in hooks/containers and rendering in presentational components.
- Preserve existing API behavior during UI decomposition unless explicitly changing contracts.

## AI-Friendly Development Guidelines
- Use feature-slice changes (route + state + API usage + tests + spec update).
- Update reviewer-pack docs in `.planning/spec-kit/specs/` with runtime-facing changes.
- Favor deterministic acceptance criteria and explicit failure behavior over vague narratives.

## Agent Memory Loop (MemPalace)

**MANDATORY at session start — run before reading any source files:**
```bash
npm run mempalace:wake-up
```
Then call `mempalace_status` (MCP) to confirm palace state.

- Source of truth: local files always win over palace if they conflict:
  - `.agent/state/state.index.json`
  - `.agent/session-handovers/handover-*.json`
- Indexing scope: memory/context artifacts only:
  - include `.agent/state`, `.agent/session-handovers`, `.planning/spec-kit/specs`, relevant planning JSON
  - exclude `src/**`, `lib/**`, `tests/**`, `.env*`, large debug artifacts
- Session flow:
  - **start**: `npm run mempalace:wake-up` (seeds palace, wakes up on `marketing_automation` wing)
  - **mid-task**: `npm run mempalace:checkpoint` after each meaningful decision or completed slice
  - **end**: `npm run mempalace:handover -- --file .agent/session-handovers/handover-YYYYMMDD-HHMM.json`
- First-run or stale wing: `npm run mempalace:seed` before wake-up
- Identity sync is automatic (pass `--no-sync-identity` to opt out)
- Skill reference: `.agent/skills/mempalace-management.md`
- Spec reference: `.planning/spec-kit/specs/mempalace-memory-loop-v1.json`

## Gap Health — Critical Semantics

**`gap` = number of posts AHEAD of ours** (`sharePlanIndex` in `bot.ts`).
`SAFE` means gap ≥ threshold, i.e., it is safe to publish RIGHT NOW — it is NOT a system health indicator.

| Gap | Meaning |
|-----|---------|
| 0–threshold, rising | Normal — just published, monitoring for next opportunity |
| ≈ threshold | Normal — about to publish on next recheck |
| threshold+1 to +2 | Acceptable overshoot |
| threshold+3 to +5 | Warning — recheck loop slow or board very active |
| threshold+6+ | **Critical** — scheduler likely stalled post-publish; check `running` flag |

**Do not be misled by `Decision: SAFE` in logs.** A gap of 14 with threshold 4 means
we are 10 posts overdue, not that the board is healthy. Confirm via
`GET /api/control-panel` → `lastObserverResult` and publisher history JSONL interval widths.

**Scheduler is gap-driven, not time-driven.** After a successful publish, the scheduler
enters gap-recheck mode immediately (3min → 1.5min → 30s intervals as gap approaches
threshold). The base interval (default 60 min) applies only after errors or non-publish
decisions. If you see 60-minute gaps in publisher history, the post-publish recheck loop
has broken down — see KE-001.

## Known Error Database (KEDB)

Structured bug records with symptoms, root cause, diagnosis path, and lessons learned.
**Check this before diagnosing any publisher/observer anomaly.**

Location: `.planning/known-issues/`

| ID | Title | Severity |
|----|-------|----------|
| [KE-001](.planning/known-issues/KE-001-scheduler-gap-recheck.md) | Scheduler reverts to 60-min interval after successful publish | critical |

When you confirm a new bug required >1 debugging iteration or produced misleading symptoms,
add an entry: copy the frontmatter from an existing entry, increment the ID, fill all sections.

## Regression Prevention Checklist (Agents)
- Run `npm run lint` after code edits.
- Run `npm run test:integration` for API/publisher behavior changes.
- Run full `npm run test` for broader parser/runtime changes.
- Do not weaken fail-closed checks without explicit approval.

