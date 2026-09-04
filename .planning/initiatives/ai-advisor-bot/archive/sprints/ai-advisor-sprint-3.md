# Sprint 3 — NL Webhook

**Spec:** [`.planning/spec-kit/specs/nl-webhook-v1.json`](../../../specs/nl-webhook-v1.json)
**Epic (archived):** [`ai-advisor-epic.md`](../epics/ai-advisor-epic.md)
**Independent of Sprint 2** (requires only Sprint 1 env vars and XAI_API_KEY)

## Goal

Implement `POST /api/nl-command` so that natural language instructions sent via HTTP (curl, Telegram, Discord, any webhook client) are classified by Grok 4 and dispatched to existing API endpoints.

**Session boundary:** Done when all 7 supported intents pass a smoke test with `dry_run: true` and at least `pause_scheduler` / `status_query` pass with real dispatch.

---

## Phases

### Phase 1 — Env vars in `config/env.ts`

- [ ] Add `NL_WEBHOOK_ENABLED: boolean` — default `true`
- [ ] Add `NL_WEBHOOK_SECRET: string | null` — optional, null if absent
- [ ] Add rows to env table in `CLAUDE.md`

---

### Phase 2 — `lib/nlWebhook.ts` (new file)

#### 2a — Types

```ts
export type NlIntent =
  | "pause_scheduler"
  | "resume_scheduler"
  | "force_publish"
  | "set_interval"
  | "set_gap_threshold"
  | "apply_ai_recommendation"
  | "status_query"
  | "unknown"

export type NlClassification = {
  intent: NlIntent;
  extractedParams: Record<string, number | string | boolean>;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export type NlCommandResult = {
  intent: NlIntent;
  dispatchedTo: string;
  result: unknown;
  dryRun: boolean;
}
```

#### 2b — `classifyIntent(message: string): Promise<NlClassification>`

- POST to Grok 4 with classification prompt (from nl-webhook-v1.json spec)
- Timeout: `AI_ADVISOR_TIMEOUT_MS` (reuse same env var)
- On error or timeout: return `{ intent: "unknown", confidence: "low", reason: "classification failed", extractedParams: {} }`

#### 2c — Intent dispatch map

```ts
const DISPATCH_MAP: Record<NlIntent, (params, internalFetch) => Promise<unknown>> = {
  pause_scheduler:             (_, f) => f("POST /api/control-panel", { schedulerEnabled: false }),
  resume_scheduler:            (_, f) => f("POST /api/control-panel", { schedulerEnabled: true }),
  force_publish:               (_, f) => f("POST /api/run-publisher", { force: true }),
  set_interval:                (p, f) => f("POST /api/control-panel", { intervalMinutes: p.intervalMinutes }),
  set_gap_threshold:           (p, f) => writeRuntimeGapPersistedOverride(p.observerGapThresholdMin),
  apply_ai_recommendation:     (_, f) => f("POST /api/apply-ai-recommendation", {}),
  status_query:                (_, f) => buildStatusSummary(f),
  unknown:                     () => Promise.reject(new Error("unknown_intent"))
}
```

`internalFetch` is a thin wrapper that calls the express app's route handlers in-process (no HTTP round-trip). Use the existing pattern already present for control panel calls.

#### 2d — `dispatchNlCommand(classification, dryRun): Promise<NlCommandResult>`

- If `dryRun`: return `{ intent, dispatchedTo, result: null, dryRun: true }` without calling dispatch
- If `intent === "unknown"`: throw 422
- If `intent === "force_publish"` and `!ENV.MANUAL_OVERRIDE_ENABLED`: throw 422 with reason
- Validate extracted numeric params before dispatch (use same bounds as control panel)
- Call dispatch, return result

#### 2e — `buildStatusSummary()` for `status_query`

- Reads: control panel state, latest trend insights, last 5 history entries
- Returns: `{ schedulerEnabled, intervalMinutes, multiplierBand, sovPercent, lastRunAt, lastRunDecision, recommendation: AiAdvisorOutput | null }`
- No AI call for the summary — raw data only (fast, cheap)

---

### Phase 3 — `POST /api/nl-command` in `server.ts`

- [ ] Guard: `NL_WEBHOOK_ENABLED` → else 503
- [ ] Auth guard: if `NL_WEBHOOK_SECRET` set, require `Authorization: Bearer <secret>` → else 401
- [ ] Parse body: require `message: string`, optional `source: string`, optional `dry_run: boolean`
- [ ] Call `classifyIntent(message)` → `NlClassification`
- [ ] Log: `{ source, intent, confidence, dryRun }` at info level
- [ ] If `intent === "unknown"` → 422 `{ error: "unknown_intent", reason }`
- [ ] Call `dispatchNlCommand(classification, dryRun)` → return 200 with `NlCommandResult`
- [ ] On dispatch error → 422 or 503 depending on error type
- [ ] Add to `api-endpoint-catalog.json`

---

### Phase 4 — Integration smoke tests

**File:** `tests/integration/nlWebhook.test.ts` (new file)

Use `dry_run: true` throughout to avoid side effects.

- [ ] "pause publishing" → intent `pause_scheduler`, dispatches to `/api/control-panel`
- [ ] "resume publishing" → intent `resume_scheduler`
- [ ] "set interval to 45 minutes" → intent `set_interval`, `extractedParams.intervalMinutes === 45`
- [ ] "lower the gap to 3" → intent `set_gap_threshold`, `extractedParams.observerGapThresholdMin === 3`
- [ ] "apply the AI recommendation" → intent `apply_ai_recommendation`
- [ ] "what's happening" → intent `status_query`
- [ ] "do something weird xyz" → 422 with `unknown_intent`
- [ ] Missing `message` field → 400
- [ ] Wrong bearer token → 401

---

## Acceptance

- [ ] `tsc --noEmit` exits 0
- [ ] All pre-existing tests pass
- [ ] All 9 smoke test cases pass
- [ ] `NL_WEBHOOK_SECRET` absent → endpoint accessible without auth header
- [ ] `NL_WEBHOOK_SECRET` set → endpoint rejects requests without correct token
- [ ] `force_publish` with `MANUAL_OVERRIDE_ENABLED=false` → 422
- [ ] `dry_run: true` → no mutations regardless of intent
- [ ] `XAI_API_KEY` absent → 503 (not 500)
- [ ] No changes to any publisher or observer flow code
