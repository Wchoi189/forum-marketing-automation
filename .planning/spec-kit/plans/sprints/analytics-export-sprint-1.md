# Sprint 1 — Competitor EDA: CSV Export

Spec: [`.planning/spec-kit/specs/analytics-export-v1.json`](../specs/analytics-export-v1.json)  
Parent spec: [`analytics-eda-polish-v2.json`](../specs/analytics-eda-polish-v2.json)

## Goal

Add a CSV export button to the Competitors table header in `src/AnalyticsPage.tsx`. Clicking it downloads `competitors-{from}-{to}.csv` built client-side from `payload.summary`. No new files, no new API endpoints.

## Phases

---

### Phase 1 — CSV helper function

**File:** `src/AnalyticsPage.tsx`

#### 1a — `buildCsv(rows, from, to)`
- [ ] Accept `AuthorSummaryRow[]`, `from: string`, `to: string`
- [ ] Header: `Rank,Author,Posts,Active Days,Posts/Active Day,Avg Views/Post,Avg Views Count`
- [ ] One data row per summary entry in order
- [ ] Quote fields that contain commas or double-quotes; double-escape embedded quotes
- [ ] Return `{ csv: string, filename: string }` — filename = `competitors-{from}-{to}.csv`

#### 1b — `downloadCsv(csv, filename)`
- [ ] Create `Blob` with `type: 'text/csv;charset=utf-8;'`
- [ ] Create temporary `<a>` element, set `href = URL.createObjectURL(blob)`, set `download = filename`
- [ ] Programmatically click, then `URL.revokeObjectURL`

---

### Phase 2 — Export button

**File:** `src/AnalyticsPage.tsx`

#### 2a — Import icon
- [ ] Add `Download` to the lucide-react import line

#### 2b — Button placement
- [ ] In Zone 3 header (`div.flex.items-center.justify-between`), add the export button to the right side
- [ ] Button is disabled when `!payload || payload.summary.length === 0`
- [ ] On click: call `downloadCsv(...buildCsv(payload.summary, from, to))`
- [ ] Style matches existing ghost buttons: `text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 disabled:opacity-30 transition-colors`

---

## Acceptance

- [ ] Export button visible in Zone 3 header when data is loaded
- [ ] Button disabled when no payload
- [ ] Click downloads `competitors-{from}-{to}.csv`
- [ ] CSV has correct headers and row data matching payload.summary
- [ ] `tsc --noEmit` exits 0
- [ ] No changes to `lib/competitorAnalytics.ts`
- [ ] No new files created
