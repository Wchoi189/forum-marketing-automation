# Logging Modernization Plan (Pino + Structured Storage)

## Purpose
- Reduce log volume growth while preserving fail-closed debugging and auditability.
- Standardize runtime logs into structured events that are easy to query and transform.
- Add a storage path to analytics-friendly formats (pandas dataframe + parquet).

## Design Intent
- Keep runtime behavior unchanged first; improve observability format before changing retention semantics.
- Separate high-frequency operational events from heavy diagnostic artifacts.
- Retain enough forensic data for publisher failures (screenshots, optional traces), but avoid collecting heavy artifacts on all successful runs.

## Change Impact
- Affects `bot.ts` observer/publisher logging, publisher diagnostics helpers, and ops retention policy.
- Enables downstream AI/analytics workflows by making log records machine-friendly.
- Requires integration tests and lint checks after each phase to prevent publisher regressions.

---

## Phase 1 - Foundation (in progress)
### Scope
- Introduce shared `pino` logger with JSON output.
- Replace high-volume `console.log/error` calls in observer/publisher paths with structured log events.

### Acceptance Criteria
- Logs are emitted as structured JSON (timestamped, levelled).
- Existing observer/publisher control flow and success/failure behavior remain unchanged.

### Status
- [x] Add `pino` dependency.
- [x] Add shared logger module (`lib/logger.ts`).
- [x] Migrate top-level observer/publisher and diagnostics console calls.

---

## Phase 2 - Event Taxonomy and Noise Reduction
### Status
- [x] Add core event envelope fields to observer/publisher logs (`event`, `status`, `durationMs`, `errorCode` where applicable).
- [x] Add publisher `runId` correlation across start/skip/finish/failure events.
- [x] Normalize scheduler/server runtime logs to the same event taxonomy.
- [x] Add shared typed event-name constants (`lib/logEvents.ts`) to reduce naming drift.
- [x] Normalize API-route-level error and validation logs to the same event taxonomy.

### Scope
- Define event names and common fields:
  - `event`, `runId`, `decision`, `status`, `durationMs`, `artifactDir`, `errorCode`.
- Introduce level policy:
  - `info`: normal milestones
  - `warn`: recoverable anomalies
  - `error`: failed run outcomes
  - `debug`: deep diagnostics gated by env flag
- Remove or demote repeated low-signal messages.

### Acceptance Criteria
- Every publisher run can be reconstructed from structured events.
- No duplicate milestone logs at different levels.
- Debug-only events are disabled by default.

---

## Phase 3 - Heavy Artifact Policy (Trace/Screenshot Controls)
### Scope
- Keep `PUBLISHER_DEBUG_TRACE=false` by default.
- Capture trace on failure only (or sampling policy) instead of all successful runs.
- Keep failure screenshot capture mandatory.
- Document runbook rules for when to enable full trace collection.

### Acceptance Criteria
- Trace generation rate drops substantially on normal runs.
- Failure triage still has required artifacts (`error.png`; optional trace when enabled by policy).

---

## Phase 4 - Storage Model Upgrade (JSONL + Parquet)
### Status
- [x] Introduce append-only JSONL event stream for publisher runtime history (`artifacts/publisher-history/YYYY-MM-DD.jsonl`).
- [x] Keep API compatibility by reading JSONL first with fallback to legacy `artifacts/publisher-history.json`.
- [x] Add ETL script to convert JSONL to parquet datasets (`runs.parquet`, `errors.parquet`, optional `posts.parquet`).
- [x] Wire parquet ETL into scheduled ops/retention workflow (`ops/systemd/cleanup-artifacts.sh`).

### Scope
- Introduce append-only JSONL event stream for runtime logs.
- Build ETL script:
  - Input: JSONL
  - Output: parquet datasets (`runs.parquet`, `errors.parquet`, optional `posts.parquet`)
- Add partitioning strategy (for example by date `YYYY-MM-DD`).

### Acceptance Criteria
- Runtime logging no longer rewrites whole log arrays on each run.
- Data can be loaded in pandas with stable schemas.
- Storage footprint is reduced versus JSON history-only approach.

---

## Phase 5 - Retention, Governance, and Ops
### Status
- [x] Expand cleanup policy to include JSONL and parquet retention windows.
- [x] Add trace retention policy split by outcome/severity.
- [x] Add operator docs for debug escalation, trace replay, and parquet querying (`ops/systemd/README.md`).
- [x] Confirm Phase 5 acceptance criteria are satisfied and documented.

### Scope
- Expand cleanup policy to include:
  - JSONL retention windows
  - parquet archive retention
  - trace retention by outcome/severity
- Add operator docs for:
  - debug escalation path
  - how to replay trace
  - how to query parquet outputs

### Acceptance Criteria
- Retention policy is explicit, automated, and environment-configurable.
- Audit trail remains available for agreed windows.

### Acceptance Status
- [x] Retention policy is explicit, automated, and environment-configurable (`ops/systemd/cleanup-artifacts.sh`, `ops/systemd/README.md`).
- [x] Audit trail remains available for agreed windows via differentiated retention (failure/severe traces, success traces, JSONL, parquet).

---

## Validation Checklist (run each phase)
- `npm run lint`
- `npm run test:integration`
- Spot-check:
  - Observer error path
  - Gap policy skip path
  - Publisher success path
  - Publisher failure artifact path

## Rollback Strategy
- Keep logger adapter minimal so we can revert to console output quickly if needed.
- Avoid schema-breaking changes in one step; add fields before removing old ones.
- Keep existing artifact capture toggles until replacement policy is proven in integration tests.

## Notes for AI/Data Workflows
- Prefer one-event-per-line JSONL as canonical ingest source for agents.
- Use parquet for long-term analysis and trend computation.
- Keep high-cardinality text fields (raw body dumps, full projections) in diagnostic side channels, not in primary run events.

