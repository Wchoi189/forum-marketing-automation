# Sprint 1 — AI Advisor Core

**Spec:** [`.planning/spec-kit/specs/ai-advisor-v1.json`](../../../specs/ai-advisor-v1.json)
**Epic (archived):** [`ai-advisor-epic.md`](../epics/ai-advisor-epic.md)

## Goal

Implement the Grok 4 advisor layer as a pure server-side module. Expose a single read-only endpoint (`GET /api/ai-recommendation`) that returns the latest recommendation or null. No UI changes. No mutations.

**Session boundary:** Done when `GET /api/ai-recommendation` returns a valid `AiAdvisorOutput` (or `{ recommendation: null }` if key absent) and `tsc --noEmit` is clean.

---

## Phases

### Phase 1 — Env vars in `config/env.ts`

- [ ] Add `XAI_API_KEY: string | null` — optional, null if absent (do not throw)
- [ ] Add `AI_ADVISOR_ENABLED: boolean` — default `true`
- [ ] Add `AI_ADVISOR_TIMEOUT_MS: number` — default `8000`, range 1000–30000
- [ ] Add rows for all three to the env table in `CLAUDE.md`

---

### Phase 2 — `lib/aiAdvisor.ts` (new file)

#### 2a — Types

```ts
export type AiAdvisorInput = { /* context packet — see spec */ }
export type AiAdvisorOutput = {
  recommendedIntervalMinutes: number;
  recommendedGapThreshold: number;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  signalsUsed: string[];
  generatedAt: string; // ISO
}
export type AiAdvisorResult =
  | { ok: true; recommendation: AiAdvisorOutput; contextBuiltAt: string }
  | { ok: false; reason: string }
```

#### 2b — `buildAdvisorContext()`

Assembles the context packet from existing in-process data (no new HTTP calls):
- `trend`: from `buildTrendInsightsPayload()` result (caller passes it in)
- `recentRuns`: last 10 publisher history entries with derived rates (successRate, gapPolicyRate, errorRate)
- `currentBoard`: latest activity log entry (gap count, threshold, status)
- `controls`: current scheduler controls (intervalMinutes, jitter, enabled flags)
- `meta`: `{ currentHour, contextBuiltAt }`

Function signature: `buildAdvisorContext(trend, history, latestLog, controls): AiAdvisorInput`

#### 2c — `callGrokAdvisor(context: AiAdvisorInput): Promise<AiAdvisorResult>`

- Build system prompt from spec (`ai-advisor-v1.json` `system_prompt` section)
- POST to `https://api.x.ai/v1/chat/completions` with `response_format: { type: "json_object" }`
- `AbortSignal` with `AI_ADVISOR_TIMEOUT_MS`
- Parse and validate response against `output_schema`
- Clamp `recommendedIntervalMinutes` to [5, 480] and `recommendedGapThreshold` to [1, 50] server-side regardless of model output
- On any error (network, parse, timeout, invalid schema): return `{ ok: false, reason: "..." }` — never throw

#### 2d — In-memory cache

```ts
let advisorCache: { result: AiAdvisorResult; cachedAt: string } | null = null;
export function getAdvisorCache() { return advisorCache; }
export function setAdvisorCache(r: AiAdvisorResult) { advisorCache = { result: r, cachedAt: new Date().toISOString() }; }
```

---

### Phase 3 — `GET /api/ai-recommendation` in `server.ts`

- [ ] Guard: if `!ENV.AI_ADVISOR_ENABLED || !ENV.XAI_API_KEY` → return `{ recommendation: null, contextBuiltAt: null, source: "disabled" }`
- [ ] Read from `getAdvisorCache()`
- [ ] If cache exists: return `{ recommendation: cache.result, contextBuiltAt: cache.cachedAt, source: "cached" }`
- [ ] If no cache: call `buildAdvisorContext()` + `callGrokAdvisor()` inline (fresh), store in cache, return with `source: "fresh"`
- [ ] Add to `api-endpoint-catalog.json`

---

### Phase 4 — Hook into observer cycle in `server.ts`

- [ ] In the `runObserver` success path (after activity log is written), call `callGrokAdvisor()` async — fire-and-forget, store result in cache
- [ ] Wrap in try/catch — failure must not affect observer response
- [ ] Log advisor result at `debug` level (model reasoning) and `info` level (recommended values)

---

### Phase 5 — Unit tests

**File:** `tests/unit/aiAdvisor.test.ts` (new file)

- [ ] `buildAdvisorContext` — produces valid context shape from fixture inputs
- [ ] `callGrokAdvisor` with mocked fetch — happy path returns clamped recommendation
- [ ] `callGrokAdvisor` with mocked timeout → returns `{ ok: false }`
- [ ] `callGrokAdvisor` with malformed JSON response → returns `{ ok: false }`
- [ ] Output clamping: model returns `intervalMinutes: 9999` → clamped to 480

---

## Acceptance

- [ ] `tsc --noEmit` exits 0
- [ ] All pre-existing tests pass
- [ ] New `aiAdvisor.test.ts` cases pass
- [ ] `GET /api/ai-recommendation` with valid `XAI_API_KEY` returns `AiAdvisorOutput` shape
- [ ] `GET /api/ai-recommendation` with no `XAI_API_KEY` returns `{ recommendation: null }` — no 500
- [ ] Observer cycle completes at normal speed even if advisor call hangs (timeout fires, run continues)
- [ ] Advisor output is never auto-applied to control panel state
- [ ] No changes to `lib/trendInsights.ts`, `lib/playbookRunner.ts`, or any existing test file
