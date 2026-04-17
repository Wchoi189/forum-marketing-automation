# State Synchronization Architecture

**Status:** Implemented through P5 closeout (2026-04-17)
**Trigger:** Gap threshold shown in AI Advisor (8) diverges from Controls panel (5) after Apply Recommendation.
**Scope:** All mutable runtime settings that cross the storage → server → frontend boundary.

## Implementation Update (2026-04-17)

- Completed stale-response suppression test coverage for control synchronization request ordering and state-version handling.
- Extracted state reconciliation/ordering decisions into pure helper utilities used by `useAppData` so edge cases are regression-testable.
- Tightened dirty-edit reconciliation so only editable fields are protected; authoritative metadata and computed runtime status fields continue to refresh from server responses.
- Audited remaining frontend async flows that can affect control state and verified they route through guarded authoritative apply paths.

---

## 1. Problem Statement

The application manages several pieces of mutable runtime state — gap threshold, scheduler interval, NL webhook flag, observer pacing controls, publisher draft index — and each has been addressed ad-hoc as features landed. The result is **no consistent contract** for how a setting is stored, resolved, surfaced via API, or reflected in the UI after a change.

The gap threshold synchronization symptom is the most visible example but is not the only risk.

### What the user sees

- AI Advisor recommends gap = 8.
- Controls panel shows "gap 6/5" (current gap = 6, threshold = 5).
- "Apply Recommendation" succeeds but it is not obvious whether the threshold changed, and the gap badge may not update before the next observer poll.
- There is no indication of *which source* is currently in effect (spec baseline, env var, or file override).

### Root cause

State is scattered across four layers with no unified mutation path:

| Layer | What lives here | Persistence |
|-------|----------------|------------|
| JSON spec contracts | Baseline defaults | Code commit |
| Env vars | Deployment-time overrides | Server restart |
| `artifacts/runtime-controls.json` | User-driven runtime overrides | File on disk |
| In-memory scheduler / flag variables | Fast-path current value | Server process lifetime |

Each layer can diverge from the others. No single object represents "the current authoritative value" for any given setting. The frontend has its own fourth copy in React state.

---

## 2. Audit Findings

### 2.1 Gap Threshold (Medium risk)

**Precedence chain** (bot.ts `resolveEffectiveGapThresholdMin`): file override → env var → spec baseline.

**Write paths:**
- `POST /api/control-panel` with `observer.gapPersistedOverride` → writes to `artifacts/runtime-controls.json`
- `POST /api/apply-ai-recommendation` → also writes to `artifacts/runtime-controls.json`

**Synchronization gap:** Both write paths work and re-fetch state after. The visual mismatch the user sees is likely because:
1. The AI Advisor's recommendation is built from an activity log snapshot captured at the last observer run — not from the current effective threshold.
2. The Controls panel shows the current effective threshold from `GET /api/control-panel`, which may differ from what the advisor used.
3. There is no labeling of *source* (file vs env vs spec) in the gap badge.

### 2.2 Scheduler Interval (Medium risk)

**Write paths:**
- `POST /api/control-panel` → `scheduler.setControls()` + `persistAllControlPanelSettings()` — persists correctly.
- `POST /api/apply-ai-recommendation` → `scheduler.setControls()` only — **interval is NOT persisted to disk**.

**Risk:** If the server restarts before the user explicitly saves the control panel, the recommended interval is lost. Only the gap threshold survives restart after an AI apply.

### 2.3 NL Webhook Enabled Flag (Critical)

**Write path:** `POST /api/control-panel` sets `nlWebhookEnabledRuntime` in memory. **No disk write ever happens.**

**Risk:** The flag resets to its env var default (`NL_WEBHOOK_ENABLED=true`) on every server restart. A user who disabled it via the UI will find it re-enabled after any deploy or crash.

### 2.4 Frontend State Merge During Edit (Low risk)

When `controlDirty=true`, the frontend intentionally skips merging `gapPersistedOverride` from API polls to preserve local edits. This is correct behavior but creates a window (up to 30 s) where the form shows stale data if the value changed server-side from another source (another tab, API apply, etc.).

### 2.5 Activity Log Snapshot vs. Real-Time State (Cosmetic)

The activity log's `gap_threshold_min` is the value **used at observer run time**, not the current configured threshold. This is correct for audit purposes but causes visual confusion when comparing "what gap did we use?" to "what gap is configured now?".

---

## 3. Architectural Target

The goal is not to redesign everything at once. The goal is to establish a **consistent pattern** that:

1. Every mutable runtime setting has exactly **one place it is written to disk**.
2. Every API mutation returns the **full, re-read authoritative state** — not a confirmation echo.
3. Every frontend mutation triggers a **full re-fetch** of the affected domain (not an optimistic merge).
4. The API surface exposes **provenance** for each computed field (spec / env / file) so the UI can label it.
5. In-memory values are derived from the canonical disk state on startup and after every write.

This is a **write-through, server-authoritative** model. The frontend is a view of server state; it does not maintain independent truth.

---

## 4. Structural Changes Required

### 4.1 Unified Runtime Controls Record

All mutable settings currently spread across multiple persistence paths should flow through a single record in `artifacts/runtime-controls.json`. Add missing fields:

```typescript
interface RuntimeControlsRecord {
  // Gap
  observerGapThresholdMin?: number | null;
  // Scheduler
  schedulerBaseIntervalMinutes?: number;
  schedulerEnabled?: boolean;
  // NL Webhook
  nlWebhookEnabled?: boolean;
  // Observer pacing (already present)
  // Publisher (already present)
}
```

**Current state:**
- `observerGapThresholdMin`: persisted ✓
- `schedulerBaseIntervalMinutes`: persisted via `persistAllControlPanelSettings` ✓
- `schedulerEnabled`: persisted via `persistAllControlPanelSettings` ✓
- `nlWebhookEnabled`: **not persisted** ✗

### 4.2 Apply AI Recommendation Must Persist Interval

`POST /api/apply-ai-recommendation` must atomically write both gap and interval to disk. Currently it only writes gap.

```typescript
// After: atomic write of both changes
await Promise.all([
  persistGapThresholdPersistedOverride(recommendedGapThreshold),
  persistSchedulerControls({ baseIntervalMinutes: recommendedIntervalMinutes })
]);
```

The scheduler in-memory state is then derived from disk on next read (or updated in parallel — either works as long as disk is the canonical source).

### 4.3 Provenance Fields in API Responses

`GET /api/control-panel` already returns `gapPersistedOverride`, `gapThresholdSpecBaseline`, and `gapUsesEnvOverride`. This pattern should be applied uniformly:

```typescript
interface ObserverControlsWithGap {
  gapThresholdMin: number;          // effective (computed)
  gapThresholdSpecBaseline: number; // from spec
  gapPersistedOverride: number | null; // from file
  gapUsesEnvOverride: boolean;      // env var active
  gapSource: 'file' | 'env' | 'spec'; // NEW — explicit label
}
```

Expose `gapSource` so the UI can render "Gap: 8 (applied)" or "Gap: 5 (default)".

### 4.4 Frontend: Invalidate, Don't Merge

After any mutation (control panel save, AI apply, observer run), the frontend should call `fetchControlPanel()` unconditionally and replace state — not merge. The current "dirty edit" merge guard should only protect the text fields the user is actively editing, not the read-back of the authoritative computed values.

The pattern to standardize:

```
User action → POST mutation API → server writes to disk → server re-reads and returns state → frontend replaces state from response
```

Not:

```
User action → POST mutation API → frontend locally applies delta → polling eventually catches up
```

### 4.5 Distinguish Snapshot vs. Live Gap in Activity Log

Add a separate display field or tooltip in the UI to distinguish:
- **Current gap threshold** (from control panel, reflects latest setting)
- **Gap threshold used in this run** (from activity log, fixed at run time)

No code change needed in the log itself. This is a UI/labeling change.

---

## 5. Risk Inventory (All Stateful Fields)

| Field | Persisted to Disk | Survives Restart | Missing Fix |
|-------|------------------|-----------------|------------|
| `gapPersistedOverride` | ✓ | ✓ | Provenance label in UI |
| `schedulerBaseIntervalMinutes` | ✓ (via control panel save) | ✓ | Must also persist via AI apply |
| `schedulerEnabled` | ✓ | ✓ | — |
| `nlWebhookEnabled` | ✗ | ✗ | Add disk write + startup restore |
| `observerPacingControls` | ✓ | ✓ | — |
| `publisherDraftItemIndex` | ✓ | ✓ | — |
| `aiAdvisorEnabled` (runtime toggle) | Not implemented | ✗ | Out of scope (kill-switch only) |

---

## 6. Implementation Plan

### Sprint 1 — Fix Persistence Bugs (correctness, no visible UX change)

1. **NL Webhook flag**: Add `nlWebhookEnabled` to `RuntimeControlsRecord`. In `POST /api/control-panel` handler, call `writeRuntimeControls({ nlWebhookEnabled })`. On server startup, restore from disk before the first request is served.

2. **AI Apply interval persistence**: In `POST /api/apply-ai-recommendation`, persist `schedulerBaseIntervalMinutes` to disk alongside the gap threshold. Return the full updated control panel state (same as `POST /api/control-panel` already does) so the frontend has a clean post-apply state.

### Sprint 2 — Provenance Labeling (UI clarity)

3. **Add `gapSource` to API response**: Return `'file' | 'env' | 'spec'` from `GET /api/control-panel` and `POST /api/control-panel`.

4. **Gap badge in Controls**: Show source label next to the threshold number ("8 (applied)" / "5 (env)" / "5 (default)"). Use the existing `gapPersistedOverride` + `gapUsesEnvOverride` fields or the new `gapSource` field.

5. **Post-AI-Apply confirmation**: After "Apply Recommendation" succeeds, show the new effective gap and interval (not just "applied"). The data is already returned in the apply response.

### Sprint 3 — Frontend State Discipline (robustness)

6. **Standardize post-mutation fetch pattern**: After every write operation (control panel save, AI apply, observer run trigger), call `fetchControlPanel()` and set state from the response rather than relying on polling to catch up. This ensures the UI is consistent within the same user action.

7. **Document the `controlDirty` merge guard**: Add a comment and test explaining which fields are protected during editing vs. which are always refreshed. The current behavior is largely correct; the goal is to make it explicit and predictable.

---

## 7. Out of Scope

- Websocket/SSE push for real-time multi-tab sync (complexity not justified by current usage)
- Full Redux/Zustand state manager migration (the `useAppData` hook is sufficient once mutations are disciplined)
- Changing the gap precedence chain (file > env > spec is correct and well-tested)
- Observer activity log format changes (snapshot semantics are correct for audit)

---

## 8. Acceptance Criteria

- [ ] Disabling NL Webhook via Controls persists across server restart.
- [ ] Applying AI Recommendation persists both gap and interval to disk; both survive restart.
- [ ] Controls panel shows which source is active for the gap threshold (file / env / spec).
- [ ] After "Apply Recommendation", the Controls panel immediately reflects the new gap and interval without waiting for the next poll cycle.
- [ ] No new in-memory-only mutable settings introduced in future features.
