# Sprint 1 — Competitor EDA: Unit Test Coverage

Spec: [`.planning/spec-kit/specs/analytics-eda-quality-v1.json`](../../../specs/analytics-eda-quality-v1.json)  
Parent spec: [`analytics-eda-polish-v2.json`](../../../specs/analytics-eda-polish-v2.json)

## Goal

Six unit tests covering the non-trivial derivation paths in `buildCompetitorAnalyticsPayload` and `parseAnalyticsQuery`. Tests run via Node.js built-in test runner — no new test framework required.

## Phases

---

### Phase 1 — Test infrastructure

**Files:** `tests/unit/competitorAnalytics.test.ts` (new), `package.json`

#### 1a — Test helpers
- [ ] `makeLog(ts: string, posts: PostRecord[]): ActivityLog` — minimal valid log
- [ ] `makeQuery(overrides?: Partial<CompetitorAnalyticsQuery>): CompetitorAnalyticsQuery` — defaults: from=3 days ago, to=now, bucket="day", excludeNotices=false, authorFilter=null, focusAuthor=null
- [ ] `eventSequence(snapshots: Array<{ts: string; posts: PostRecord[]}>): ActivityLog[]` — builds the consecutive log pairs needed to generate new-post events

#### 1b — package.json
- [ ] Add `"test:unit": "tsx --test tests/unit/competitorAnalytics.test.ts"`
- [ ] Add `test:unit` to the `"test"` composite script

---

### Phase 2 — Tests: buildCompetitorAnalyticsPayload

**Target file:** `lib/competitorAnalytics.ts`

#### T-001 — postsPerActiveDay
- [ ] Alice has 3 posts: 2 on 2026-04-01 (ISO date field), 1 on 2026-04-02
- [ ] Assert `summary[0].activeDays === 2`
- [ ] Assert `summary[0].postsPerActiveDay === 1.5`
- [ ] Assert `summary[0].postsInRange === 3`

#### T-002 — avgViewsPerPost notice exclusion (mixed author)
- [ ] Bob has 5 notice posts (views=0, isNotice=true) + 10 regular posts (views=50, isNotice=false), excludeNotices=false
- [ ] Assert `row.postsInRange === 15`
- [ ] Assert `row.avgViewsPostCount === 10`
- [ ] Assert `row.avgViewsPerPost === 50`

#### T-003 — avgViewsPerPost baseline (no notices)
- [ ] Carol has 4 regular posts (views=100 each)
- [ ] Assert `row.avgViewsPostCount === row.postsInRange === 4`
- [ ] Assert `row.avgViewsPerPost === 100`

#### T-004 — focusAuthor heatmap cell tagging
- [ ] Two authors (alice, bob) each post once; focusAuthor="alice"
- [ ] Assert every `heatmap.cells` entry has `cell.author === "alice"` (case-insensitive)
- [ ] Repeat with focusAuthor=null: assert cells from both authors present

---

### Phase 3 — Tests: parseAnalyticsQuery

#### T-005 — validation error cases
- [ ] `from` set to "not-a-date" → result has `error` field
- [ ] `from` later than `to` (both valid ISO) → result has `error` field
- [ ] Valid `from`/`to` → result is a `CompetitorAnalyticsQuery` with numeric `fromMs`/`toMs`

#### T-006 — default 3-day window
- [ ] No `from`/`to` params → `fromMs` within 1 second of `Date.now() - 3*24*60*60*1000`
- [ ] `bucket` absent → defaults to `"day"`
- [ ] `excludeNotices` absent → defaults to `false`

---

## Acceptance

- [ ] `tsx --test tests/unit/competitorAnalytics.test.ts` exits 0 (all 6 test cases pass)
- [ ] `npm run test:unit` exits 0
- [ ] `tsc --noEmit` passes
- [ ] No changes to `lib/competitorAnalytics.ts` or `src/AnalyticsPage.tsx`
