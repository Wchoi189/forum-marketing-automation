# Sprint 1 — Scheduler: Share-of-Voice Multiplier

Spec: [`.planning/spec-kit/specs/scheduler-sov-multiplier-v1.json`](../specs/scheduler-sov-multiplier-v1.json)  
Parent policy: [`scheduler-adaptation.policy.json`](../specs/scheduler-adaptation.policy.json)

## Goal

Blend a second multiplier signal (Share-of-Voice) into the scheduler's trend factor. Low SoV → shorter interval; high SoV → longer interval. Additive — does not replace the existing turnover multiplier.

---

## Phases

### Phase 1 — Pure functions in `lib/trendInsights.ts`

#### 1a — `shareOfVoiceMultiplierFromSoV(sovPercent: number): number`
- [x] `sovPercent <= 5` → return `0.75`
- [x] `sovPercent >= 20` → return `1.20`
- [x] otherwise → return `1.00`
- [x] Export the function

#### 1b — `computeShareOfVoice(logs: ActivityLog[], windowDays: number, ourAuthorSubstring: string): number`
- [x] Cutoff = `Date.now() - windowDays × 24h × 3600s × 1000ms`
- [x] Filter to snapshots within window that have `all_posts.length > 0`
- [x] For each snapshot: `snapshotSoV = (posts where author.toLowerCase().includes(ourAuthorSubstring.toLowerCase())).length / all_posts.length × 100`
- [x] Return arithmetic mean of per-snapshot SoV values; if no valid snapshots return `0`
- [x] Round result to 1 decimal place

#### 1c — Constants
- [x] Export `COMBINED_MULTIPLIER_MIN = 0.5` and `COMBINED_MULTIPLIER_MAX = 2.0`

---

### Phase 2 — Extend `TrendInsightsPayload` and `buildTrendInsightsPayload`

**File:** `lib/trendInsights.ts`

#### 2a — Type change
- [x] Add `sovPercent: number` and `sovFactor: number` to `TrendInsightsPayload`

#### 2b — `buildTrendInsightsPayload` options
- [x] Add `ourAuthorSubstring: string` (default `'shareplan'`) to the options parameter
- [x] Compute `sovPercent = computeShareOfVoice(logs, windowDays, ourAuthorSubstring)`
- [x] Compute `sovFactor = shareOfVoiceMultiplierFromSoV(sovPercent)`
- [x] Include both in the returned payload

---

### Phase 3 — Env var in `config/env.ts`

- [x] Add `OUR_AUTHOR_SUBSTRING: string` — default `'shareplan'`
- [ ] Document in the env table in `CLAUDE.md` (add a row)

---

### Phase 4 — Scheduler integration in `server.ts`

**Function:** `recalcTrendFactor` (line ~624)

- [x] After computing `trendFactor = trendMultiplierFromAvgRate(analysis.avgNewPostsPerHour)`:
  - [x] Compute `sovPercent = computeShareOfVoice(logs, controls.trendWindowDays, ENV.OUR_AUTHOR_SUBSTRING)`
  - [x] Compute `sovFactor = shareOfVoiceMultiplierFromSoV(sovPercent)`
  - [x] `trendFactor = Math.max(COMBINED_MULTIPLIER_MIN, Math.min(COMBINED_MULTIPLIER_MAX, trendFactor * sovFactor))`
- [x] Wrap SoV computation in try/catch — on error log warning and use `sovFactor = 1.0`
- [x] Pass `ourAuthorSubstring: ENV.OUR_AUTHOR_SUBSTRING` when calling `buildTrendInsightsPayload` in the `GET /api/trend-insights` handler

---

### Phase 5 — Unit tests

**File:** `tests/unit/trendInsights.test.ts` (new file)

- [x] `shareOfVoiceMultiplierFromSoV` — all 7 boundary cases from spec
- [x] `computeShareOfVoice` — 5 scenario cases from spec (no logs, 50%, zero, all, outside window)

---

## Acceptance

- [x] `tsc --noEmit` exits 0
- [x] All pre-existing unit tests still pass
- [x] New `trendInsights.test.ts` cases pass
- [x] `GET /api/trend-insights` response includes `sovPercent` and `sovFactor`
- [x] `recalcTrendFactor` returns `clamp(trendFactor × sovFactor, 0.5, 2.0)`
- [x] Absent `OUR_AUTHOR_SUBSTRING` env var → defaults to `'shareplan'`
- [x] No changes to `lib/competitorAnalytics.ts`
- [x] No new files beyond `tests/unit/trendInsights.test.ts` and the env var addition
