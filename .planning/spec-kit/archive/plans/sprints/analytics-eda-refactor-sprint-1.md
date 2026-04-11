# Sprint 1 — Competitor EDA: Data-to-Action Refactor

Spec: [`.planning/spec-kit/specs/analytics-eda-refactor-v1.json`](../../../specs/analytics-eda-refactor-v1.json)

## Goal

Refactor the Competitor EDA page from a raw-data prototype into a production-quality SaaS analytics surface. Fix the `postsPerDay` data bug, restructure the UI hierarchy for progressive disclosure, and add author drill-down interactivity.

## Phases

### Phase 1 — Data layer fixes (no UI changes)

**File:** `lib/competitorAnalytics.ts`

- [ ] Add `activeDays` to `AuthorSummaryRow`: count of distinct calendar days with at least one post in the query range
- [ ] Add `postsPerActiveDay: number` — `postsInRange / activeDays`, rounded to 1 decimal
- [ ] Add `avgViewsPerPost: number` — `Math.round(totalViews / postsInRange)`
- [ ] Accept optional `focusAuthor?: string` in `CompetitorAnalyticsQuery`; when set, filter heatmap cells to that author only (timeSeries unchanged)
- [ ] Update `parseAnalyticsQuery` to read `focusAuthor` from query params

**Acceptance:** `postsPerActiveDay` for an author who posted 34 times over 2 active days = `17.0`, not `1.1`.

---

### Phase 2 — UI restructure

**File:** `src/AnalyticsPage.tsx`

#### 2a — State additions
- [ ] Add `selectedAuthor: string | null` state (null = All)
- [ ] When author selected, re-fetch with `focusAuthor` param so heatmap updates server-side

#### 2b — Zone 1: Inline filters bar
- [ ] Remove the large bordered `<section>` wrapping filters
- [ ] Render date range, bucket, and exclude-notices toggle as an inline horizontal strip just below the header
- [ ] Style: small labels + compact inputs, right-aligned

#### 2c — Zone 2: KPI row
- [ ] Add 3-card KPI strip above the summary table
- [ ] Card 1: Most Active Competitor — top author name + postsPerActiveDay
- [ ] Card 2: Market Posts/Day — mean postsPerActiveDay across all authors
- [ ] Card 3: Data Freshness — medianGapHours formatted (`<1h → minutes`, `>=1h → "X.X h"`) + amber dot if `largeGapWarning`

#### 2d — Zone 3: Summary table
- [ ] Change columns: Rank / Author / Posts / Posts/Active Day / Avg Views/Post / Bot Risk
- [ ] Remove `postsPerDay` (calendar-based) and `Views (sum)` from primary columns
- [ ] Bot Risk: colored badge only (Low=green, Medium=amber, High=red) — no raw numbers
- [ ] Row click sets `selectedAuthor`; clicking selected row again deselects (back to All)
- [ ] Highlight selected row with subtle background tint

#### 2e — Zone 4: Charts
- [ ] Timeline LineChart: when author selected → single line for that author; when All → `_total` line only (remove per-author spaghetti lines)
- [ ] Stacked BarChart: only visible when no author selected (hide in single-author mode)
- [ ] Heatmap: when author selected → use heatmap data returned for that focusAuthor; when All → aggregate heatmap

#### 2f — Zone 5: Bot signals (collapsible)
- [ ] Wrap existing bot signals table in a `<details>` or controlled expand/collapse
- [ ] Default: collapsed
- [ ] Label: "Advanced: Bot-Likeness Signals"
- [ ] Keep amber border and disclaimer text

---

### Phase 3 — Human translation pass

- [ ] Format `postsPerActiveDay` with 1 decimal in the table
- [ ] In KPI card and tooltip: if `activeDays >= 7`, append `~N posts/week` (e.g. `1.1/day · ~8/week`)
- [ ] Format `medianGapHours`: `< 1` → `"18 min"`, `>= 1` → `"2.4 h"`
- [ ] Heatmap cell tooltip: already shows count, keep as-is

---

## Out of Scope

- Scheduler / trend integration
- Unit tests
- CSV/Parquet export
- Pagination

## Acceptance

- All items in `acceptance_criteria` of the spec pass manual review
- `npm run lint` passes with no new TypeScript errors
- No changes outside `src/AnalyticsPage.tsx` and `lib/competitorAnalytics.ts`
- Bot signals table is collapsed by default on fresh page load
- Clicking a summary row and then checking the heatmap shows only that author's posting pattern
