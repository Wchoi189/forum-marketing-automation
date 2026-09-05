# Session Handover — EDA Redesign Session 2

**Project:** Competitor EDA page redesign  
**Completed:** Session 1  
**Remaining:** Session 2 (combined original S2 + S3)

---

## What Was Done in Session 1

File changed: `src/AnalyticsPage.tsx`

### Changes made
1. **Tab navigation** — Added `ActiveTab` type (`'market' | 'rankings' | 'bot-intel'`) and a tab bar UI with an orange underline indicator. Tab counts shown next to Rankings and Bot Intel labels.
2. **Content reordered** — Market tab now shows: charts first → heatmap below. Charts and heatmap are no longer buried under a long table.
3. **Heatmap extracted** — Pulled into a standalone `<Heatmap>` component (lines ~115–160) to be reusable from both Market tab and the detail drawer (Session 2).
4. **Rankings tab** — Competitor table moved here, now isolated from charts.
5. **Pagination** — `TABLE_PAGE_SIZE = 8`. Paginator renders numbered page buttons + Prev/Next. `tablePage` state resets to 0 on each new data load.
6. **Bot Intel tab** — Bot signals table promoted from collapsible accordion to its own dedicated tab. Disclaimer shown inline at the top.

### What was NOT changed
- Filter placement (still in header) — deferred to Session 2
- Author row-click still filters charts inline — will be replaced by drawer in Session 2
- No ranked bar chart yet — Session 2
- No sidebar — Session 2

---

## Session 2 Scope (combined S2 + S3)

### Part A — Sidebar Filters + Ranked Bar Chart

**Goal:** Move all query filters out of the header into a left sidebar. Add a horizontal bar chart ranking authors by `postsPerActiveDay` above the Rankings table.

**Layout change:** Switch main content from `max-w-7xl` full-width to a two-column shell:
```
┌─────────────────────────────────────────────────────────┐
│  Header (back nav + title + Refresh button only)        │
├──────────────────┬──────────────────────────────────────┤
│  Sidebar 240px   │  Tab bar + tab content               │
│  - Date range    │                                      │
│  - Bucket select │                                      │
│  - No notices    │                                      │
│  - [Apply] btn   │                                      │
└──────────────────┴──────────────────────────────────────┘
```

**Ranked bar chart** — add above the competitors table in the Rankings tab:
- Horizontal `<BarChart>` from recharts, one bar per author
- `dataKey="postsPerActiveDay"`, sorted descending (already sorted in `payload.summary`)
- Limit to top 15 authors max to avoid chart overflow
- Height: ~200px, label on Y-axis = author names (truncated to 18 chars)
- Use `SERIES_COLORS` cycling or a flat orange for uniformity

**Filter sidebar notes:**
- State stays lifted at `AnalyticsPage` level — sidebar just renders the inputs
- "Apply" triggers `load()` explicitly (or keep live onChange — user preference unclear, default to onChange as it is currently)
- Refresh button stays in header but shrinks to icon-only

### Part B — Author Detail Drawer

**Goal:** Replace the "row click re-filters the charts" pattern with a slide-in right drawer.

**Behavior:**
- Clicking an author row in Rankings tab opens a drawer (fixed, right side, ~360px wide, full viewport height)
- Clicking the same row again, or pressing Escape, or clicking an X button closes it
- Main charts in Market tab remain showing market-wide data (no `selectedAuthor` filter on them)
- `selectedAuthor` state is repurposed to drive the drawer only, not the Market charts

**Drawer contents (top to bottom):**
1. Author name + close button (`×`)
2. Bot risk badge (`<BotBadge>`) + post count
3. Mini timeline line chart (filtered to that author) — height 120px, no legend, minimal axes
4. Per-author heatmap — reuse `<Heatmap authorFilter={selectedAuthor} />` already extracted in S1
5. Bot signal metrics as a key-value grid (CV gaps, Clock 5m, H entropy, Uniformity, Burst 6h, Burst ratio)

**Implementation notes:**
- Drawer is a `fixed` div: `right-0 top-0 h-screen w-[360px] bg-[#111] border-l border-white/10 z-50`
- Add `translate-x-full` / `translate-x-0` toggle for slide animation via Tailwind transition
- Drawer component can live inline in `AnalyticsPage.tsx` (avoid new file unless it grows > ~150 lines)
- When drawer is open, main content area does NOT shrink — drawer overlays it (simpler, avoids layout reflow)

---

## Key State at End of Session 1

```ts
// New state added
const [activeTab, setActiveTab] = useState<ActiveTab>('market');
const [tablePage, setTablePage] = useState(0);

// Existing state unchanged
const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null); // still filters Market charts
```

In Session 2, `selectedAuthor` semantics change: it should drive the drawer only, not the Market tab charts. The Market tab charts should always show market-wide data.

---

## Files to Touch in Session 2

| File | Change |
|------|--------|
| `src/AnalyticsPage.tsx` | Sidebar layout, ranked bar chart, drawer component, selectedAuthor semantics change |

No other files need changes for this redesign.
