# Sprint 2 — Advisor Apply Path + Dashboard Panel

**Spec:** [`.planning/spec-kit/specs/ai-advisor-v1.json`](../specs/ai-advisor-v1.json)  
**Epic:** [`ai-advisor-epic.md`](../epics/ai-advisor-epic.md)  
**Depends on:** [Sprint 1](./ai-advisor-sprint-1.md) complete

## Goal

Add the apply path so operators can act on a recommendation with one click, and surface the advisor output in the dashboard. No auto-apply — operator always confirms.

**Session boundary:** Done when the dashboard shows the current recommendation with an "Apply" button that writes to the control panel, and `tsc --noEmit` is clean.

---

## Phases

### Phase 1 — `POST /api/apply-ai-recommendation` in `server.ts`

- [ ] Guard: `recommendation` cache must exist and `cachedAt` must be < 30 minutes old → else 422 with `{ error: "no_recommendation" | "recommendation_stale" }`
- [ ] Extract `recommendedIntervalMinutes` and `recommendedGapThreshold` from cache
- [ ] Apply via the existing `POST /api/control-panel` internal handler path (reuse, don't duplicate)
  - `intervalMinutes` → control panel `intervalMinutes`
  - `recommendedGapThreshold` → `writeRuntimeGapPersistedOverride(value)` (same path as UI gap control)
- [ ] Record `appliedAt` ISO timestamp on the cache entry (for UI display)
- [ ] Return `{ applied: true, intervalMinutes, gapThreshold, appliedAt }`
- [ ] Add to `api-endpoint-catalog.json`

---

### Phase 2 — Dashboard panel in `src/App.tsx` (or new component)

Placement: Controls tab, below the existing trend insights card.

#### 2a — Fetch

- [ ] `GET /api/ai-recommendation` on Controls tab mount and after each observer refresh
- [ ] State: `aiRec: AiAdvisorOutput | null`, `aiRecBuiltAt: string | null`, `aiRecApplied: boolean`

#### 2b — Card content (when recommendation exists)

```
┌──────────────────────────────────────────┐
│ AI Advisor  [confidence badge: high/med/low]
│                                           
│ Interval: 45 min  Gap: 4 posts            
│                                           
│ Reasoning: "SoV at 3% (below threshold)  │
│ with moderate activity — shorter interval │
│ and lower gap recommended."               
│                                           
│ Signals: sovPercent, gapPolicyRate        
│ Built: 3 minutes ago                      
│                                           
│          [Apply Recommendation]           
└──────────────────────────────────────────┘
```

- [ ] "Apply Recommendation" → `POST /api/apply-ai-recommendation` → show success toast
- [ ] After apply: re-fetch control panel state to reflect new values
- [ ] If `recommendation === null`: show "AI advisor disabled — set XAI_API_KEY to enable"
- [ ] Confidence badge: `high` = green, `medium` = yellow, `low` = gray

#### 2c — Stale guard in UI

- [ ] If `contextBuiltAt` > 30 min old → disable Apply button, show "Stale — run observer to refresh"

---

### Phase 3 — Post-observer auto-refresh

- [ ] After `POST /api/run-observer` completes (in `App.tsx` observer refresh flow), refetch `GET /api/ai-recommendation`
- [ ] This ensures the panel updates within one observer cycle without any manual action

---

## Acceptance

- [ ] `tsc --noEmit` exits 0
- [ ] All pre-existing tests pass
- [ ] `POST /api/apply-ai-recommendation` with fresh cache → returns 200 and updates control panel state
- [ ] `POST /api/apply-ai-recommendation` with stale (>30m) cache → returns 422
- [ ] `POST /api/apply-ai-recommendation` with no cache → returns 422
- [ ] Dashboard panel renders recommendation or disabled message — no blank panel
- [ ] Apply button is disabled when recommendation is stale
- [ ] Applying updates the displayed interval/gap values on the Controls tab without page reload
- [ ] No auto-apply on component mount or observer completion — only on explicit button click
