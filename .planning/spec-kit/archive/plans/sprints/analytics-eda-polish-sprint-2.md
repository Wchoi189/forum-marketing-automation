# Sprint 2 — Competitor EDA: UX Polish & Data Accuracy

Spec: [`.planning/spec-kit/specs/analytics-eda-polish-v2.json`](../../../specs/analytics-eda-polish-v2.json)  
Parent spec: [`analytics-eda-refactor-v1.json`](../../../specs/analytics-eda-refactor-v1.json)

## Goal

Close three post-v1 gaps: eliminate per-click network latency on author drill-down, fix avgViewsPerPost notice-post inflation, add empty-state for zero-post author selection.

## Phases

---

### Phase 1 — Data layer: HeatmapCell author field + avgViewsPerPost fix

**File:** `lib/competitorAnalytics.ts`

#### 1a — Extend HeatmapCell with author
- [ ] Add optional `author?: string` to `HeatmapCell` type
- [ ] In `buildCompetitorAnalyticsPayload`, when building heatmap cells from `heatEvents`, tag each cell with `e.author`
- [ ] When `focusAuthor` is set (server-side path, for backward compat), cells are still filtered — just now they also carry the author tag

#### 1b — avgViewsPerPost notice-exclusion fix
- [ ] Add `avgViewsPostCount: number` to `AuthorSummaryRow` type
- [ ] In the summary build loop, track `nonNoticeViews` and `nonNoticePosts` separately from `totalViews`/`postsInRange`
  - `nonNoticeViews` = sum of `e.views` where `!e.isNotice`
  - `nonNoticePosts` = count of events where `!e.isNotice`
- [ ] `avgViewsPerPost = nonNoticePosts > 0 ? Math.round(nonNoticeViews / nonNoticePosts) : 0`
- [ ] `avgViewsPostCount = nonNoticePosts`

**Acceptance gate:** For an author with 5 notice posts (0 views) and 10 regular posts (500 total views), `avgViewsPerPost = 50`, `avgViewsPostCount = 10`, `postsInRange = 15`.

---

### Phase 2 — Frontend: client-side heatmap filter

**File:** `src/AnalyticsPage.tsx`

#### 2a — Remove focusAuthor from queryUrl
- [ ] Remove `if (selectedAuthor) params.set('focusAuthor', selectedAuthor)` from the `queryUrl` useMemo
- [ ] `queryUrl` now only depends on `from`, `to`, `bucket`, `excludeNotices`

#### 2b — Client-side heatmap derivation
- [ ] Add `buildHeatmapGrid` overload (or modify existing) to accept an optional `authorFilter: string | null`
- [ ] When `authorFilter` is set, only include cells where `cell.author === authorFilter` (case-insensitive trim match)
- [ ] Pass `selectedAuthor` to `buildHeatmapGrid` so `heat` reacts to selection without a fetch

#### 2c — Empty-state guard on timeline
- [ ] Before rendering the timeline `LineChart`, compute `authorHasData`:
  - When `selectedAuthor` is set: `payload.timeSeries.some(row => (row[selectedAuthor] as number) > 0)`
  - When no author selected: `timeSeries.length > 0` (existing check)
- [ ] If `selectedAuthor && !authorHasData`, render inline notice instead of `LineChart`:
  ```
  No posts from {selectedAuthor} in this range.
  Change the date range or clear the selection.
  ```
  Style: amber-tinted `p` matching the disclaimer style

#### 2d — avgViewsPerPost footnote
- [ ] In the summary table, when `row.avgViewsPostCount < row.postsInRange`, add superscript `*` after the views value
- [ ] Below the `</table>`, add footnote: `* Avg views computed on non-notice posts only.`; only render if any row has `avgViewsPostCount < postsInRange`

---

## Acceptance

- [ ] Row click causes no new XHR — verify in devtools Network tab
- [ ] Heatmap updates instantly on row click
- [ ] `avgViewsPerPost` is correct when `excludeNotices=false` and author has notice posts
- [ ] `avgViewsPostCount` present in API response
- [ ] Zero-post author shows explanatory message, not empty chart axes
- [ ] Footnote appears only when there is a mismatch; not when all posts are non-notices
- [ ] `tsc --noEmit` passes
- [ ] No changes outside `src/AnalyticsPage.tsx` and `lib/competitorAnalytics.ts`
