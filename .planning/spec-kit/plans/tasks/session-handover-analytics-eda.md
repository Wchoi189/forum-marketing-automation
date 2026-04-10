# Session Handover — Shape A Spec Written

**Date:** 2026-04-10  
**Previous handover:** Scheduler integration survey (read-only)  
**This session:** Wrote spec and sprint plan for Shape A (shareOfVoice multiplier)

---

## What was completed this session

### Spec: `scheduler-sov-multiplier-v1.json`

Written at `.planning/spec-kit/specs/scheduler-sov-multiplier-v1.json`.  
Status: **draft** — awaiting review before any code is written.

**Shape A design decisions recorded in spec:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SoV measurement | Per-snapshot average over window | More stable than latest-only; consistent with turnover analysis |
| SoV ≤ 5% → factor | 0.75 (publish more) | We're underrepresented on the board |
| SoV ≥ 20% → factor | 1.20 (publish less) | We're overrepresented; avoid over-saturation |
| Blending formula | `clamp(trendFactor × sovFactor, 0.5, 2.0)` | Additive signal; combined clamp prevents compounding |
| "Our author" identification | `author.toLowerCase().includes(ENV.OUR_AUTHOR_SUBSTRING)` | Matches existing board-stats logic; parameterised via new env var |
| Our author env var | `OUR_AUTHOR_SUBSTRING`, default `'shareplan'` | No behaviour change if env var absent |
| Cache strategy | Reuse existing `lastTrendRecalculatedAt` / `trendRecalibrationDays` | Both factors recalculated together; no second timer |

### Sprint plan: `scheduler-sov-sprint-1.md`

Written at `.planning/spec-kit/plans/sprints/scheduler-sov-sprint-1.md`.  
Five phases:
1. Pure functions (`shareOfVoiceMultiplierFromSoV`, `computeShareOfVoice`, constants) in `lib/trendInsights.ts`
2. Extend `TrendInsightsPayload` + `buildTrendInsightsPayload` (add `sovPercent`, `sovFactor`)
3. Add `OUR_AUTHOR_SUBSTRING` to `config/env.ts`
4. Wire into `server.ts` `recalcTrendFactor` (with try/catch graceful fallback)
5. Unit tests in `tests/unit/trendInsights.test.ts` (12 cases)

---

## Files NOT changed this session

No code changes this session — spec and sprint plan only.

---

## Spec review checklist (before starting implementation)

Review `scheduler-sov-multiplier-v1.json` for:

- [ ] SoV thresholds (5% / 20%) — do these match observed board behaviour?
- [ ] Combined clamp bounds [0.5, 2.0] — acceptable risk range?
- [ ] `OUR_AUTHOR_SUBSTRING` default `'shareplan'` — is this the right substring?
- [ ] SoV averaging strategy (mean across window snapshots) — or prefer latest-only?
- [ ] No UI changes in Sprint 1 — acceptable to expose `sovFactor` in API only for now?

---

## Next session starting point

**Prerequisite:** Spec review above must be completed (or waived) before starting any code.

**Implementation order (from sprint plan):**

1. `lib/trendInsights.ts` — phases 1 and 2 (pure functions + type changes)
2. `config/env.ts` — phase 3 (one new env var)
3. `server.ts` — phase 4 (wire into `recalcTrendFactor`, one try/catch block; pass `ourAuthorSubstring` to `buildTrendInsightsPayload`)
4. `tests/unit/trendInsights.test.ts` — phase 5 (new file, 12 test cases)
5. Run `npx tsc --noEmit` and `node --test tests/unit/` — must be green before handover

**Recommended session boundary:** End after tests pass. UI exposure of `sovFactor` (chart/badge on the analytics or control panel page) is deferred to Sprint 2.

**Do NOT** begin Phase 4 (`server.ts`) until phases 1–3 pass `tsc --noEmit` cleanly — the scheduler path must not receive a partial implementation.
