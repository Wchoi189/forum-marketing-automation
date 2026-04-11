# Spec: Scheduler UX Overhaul + App.tsx Modularization

_Moved from .planning/specs/scheduler-ux-refactor.md on 2026-04-11 to consolidate planning root._

**Status:** All sprints complete
**Created:** 2026-04-11
**Last updated:** 2026-04-11
**Motivation:** Scheduler controls are opaque — effective interval is a product of 4 multipliers but the UI shows only raw inputs. Simultaneously, App.tsx has inline panels that should be extracted to complete the modularization started in prior sessions.

---

## Problem Statement

The current `SchedulerPanel` (App.tsx:416–447) is a flat list of 11 numeric/checkbox inputs with no:
- Live display of the derived effective interval or its formula breakdown
- Visual grouping of related settings (time-of-day vs. trend vs. jitter)
- 24-hour context for quiet/active window settings
- Inline help explaining what each multiplier does

User confusion evidence: "I only set 60 and 45 — why does it show 77m?" The formula is fully derivable client-side using known settings + `trendInsights.schedulerIntervalMultiplier`, but nothing surfaces it.

---

## Formula (server.ts:1036–1052)

```
hour = current local hour
multiplier = 1
if hour in [quietHoursStart, quietHoursEnd): multiplier *= quietHoursMultiplier
if hour in [activeHoursStart, activeHoursEnd): multiplier *= activeHoursMultiplier
multiplier *= trendFactor   (from /api/trend-insights → schedulerIntervalMultiplier)
effective = clamp(base * multiplier, 1, 1440)
if targetPublishIntervalMinutes > 0:
    effective = clamp(round(effective * 0.5 + target * 0.5), 1, 1440)
```

Client-side reconstruction is fully possible. `trendInsights.schedulerIntervalMultiplier` is already fetched by `useAppData.ts`.

---

## UX Design (SAP Fiori-inspired)

### Principles borrowed from SAP Fiori
- **Object Header**: Computed state shown prominently at top (like SAP ObjectHeader with key attributes)
- **Form Groups**: Titled sections replace flat field lists
- **Calculated Display Fields**: Read-only fields show derived/live values
- **Value State**: Inline descriptions per field, not just labels

### Layout for new SchedulerPanel

```
┌─────────────────────────────────────────────────────────┐
│  AUTO-PUBLISHER SCHEDULER              [enabled toggle] │
│                                                         │
│  ┌── EFFECTIVE INTERVAL (live) ─────────────────────┐  │
│  │  77m effective                                    │  │
│  │  60m base × 0.8 active hrs × 1.07 trend = 51m    │  │
│  │  → blended with 90m target: 71m                  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ── Base Cadence ──────────────────────────────────────│
│  Base interval (minutes)           [60     ]           │
│                                                         │
│  ── Time-of-Day Windows ──────────────────────────────│
│  [████░░░░░░░░░░░░░░░░░░░░██] 24h bar                  │
│     ↑quiet 3–5          ↑active 8–23                   │
│  Quiet hours     [3   ] to [5   ]  multiplier [1.8]   │
│  Active hours    [8   ] to [23  ]  multiplier [0.8]   │
│                                                         │
│  ── Trend Adaptation [enabled toggle] ────────────────│
│  Trend window (days)               [7      ]           │
│  Recalibration cycle (days)        [7      ]           │
│                                                         │
│  ── Jitter ────────────────────────────────────────────│
│  Jitter ±%                         [15     ]           │
│  Jitter mode                       [Uniform ▼]        │
│                                                         │
│  ── Target Cadence (optional) ────────────────────────│
│  Target interval (0 = off)         [0      ]           │
└─────────────────────────────────────────────────────────┘
```

### Key new elements
1. **EffectiveIntervalBadge** — large computed interval display with formula row
2. **TimeOfDayBar** — 24-hour strip (svg/div) with colored bands for quiet (blue) and active (green) windows, updating live as hour inputs change
3. **Section dividers** — `<SectionHeading>` component with title + optional toggle
4. **Formula row** — `base × Xm/h (reason) × Xt (trend) = Ym` with each factor labeled

---

## Modularization Scope

### App.tsx inline components to extract

| Component | Lines | Target path |
|---|---|---|
| `SchedulerPanel` | 416–447 | `src/components/scheduler/SchedulerPanel.tsx` |
| `PublisherSettingsPanel` | 449–457 | `src/components/publisher/PublisherSettingsPanel.tsx` |
| `ObserverPanel` | (find) | `src/components/observer/ObserverPanel.tsx` |
| `OperationsPage` | 459–535 | `src/pages/OperationsPage.tsx` |
| `NumField`, `Th` | 539–549 | `src/components/ui/FormFields.tsx` |

### App.tsx should become
- Route-driven shell importing page/panel components
- No rendering logic beyond layout and routing
- Target: < 200 lines

---

## Sprint Plan

### Sprint 1 — Scheduler UX Redesign + Extraction ✅ DONE (2026-04-11)
**Files created/changed:**
- `src/components/scheduler/SchedulerPanel.tsx` — new panel with EffectiveIntervalDisplay + TimeOfDayBar inlined
- `src/components/ui/FormFields.tsx` — NumField + SectionHeading extracted
- `src/App.tsx` — old SchedulerPanel body removed; both components imported

**Implementation notes:**
- `EffectiveIntervalDisplay` and `TimeOfDayBar` are co-located in `SchedulerPanel.tsx` (small enough, tightly coupled)
- Formula uses `trendInsights.trendMultiplier` (already in useAppData) — labeled "client estimate" since SoV factor and jitter are server-side only
- `isHourInRange` duplicated client-side with comment to keep in sync with `server.ts:109`
- Enabled toggle removed from SchedulerPanel (redundant with PublisherStatusBanner toggle)
- TypeScript: zero errors after extraction (`npx tsc --noEmit` clean)

**Acceptance criteria:**
- [x] Effective interval shown prominently with full formula breakdown
- [x] Formula updates live as any input changes (client-side computation)
- [x] 24-hour bar shows quiet/active windows
- [x] Settings grouped into sections (Base / Time-of-Day / Trend / Jitter / Target)
- [x] App.tsx no longer contains SchedulerPanel body
- [x] NumField extracted to ui/FormFields.tsx

### Sprint 2 — Remaining Panel Extraction
**Scope:** Extract ObserverPanel, PublisherSettingsPanel, OperationsPage. App.tsx reduced to shell.

**Files changed:**
- `src/components/observer/ObserverPanel.tsx` (new)
- `src/components/publisher/PublisherSettingsPanel.tsx` (new)
- `src/pages/OperationsPage.tsx` (new)
- `src/App.tsx` (strip extracted code)

**Acceptance criteria:**
- [x] App.tsx < 200 lines
- [x] All panels in named component files
- [x] No behavior change, pure structural refactor

### Sprint 3 — Polish ✅ DONE (2026-04-11)
**Files changed:**
- `src/components/ui/FormFields.tsx` — `SectionHeading` collapsible (aria-expanded + chevron); `NumField` tooltip prop (? badge + title attr)
- `src/components/scheduler/SchedulerPanel.tsx` — all 5 sections collapsible; state persisted in `localStorage` key `scheduler-sections`; tooltips on both multiplier fields
- `src/lib/controlPanel.ts` — `nlWebhookEnabled: boolean` added to `ControlPanelState` + `DEFAULT_CONTROL_PANEL`
- `server.ts` — `nlWebhookEnabledRuntime` variable; exposed in `GET /api/control-panel`; toggled via `POST /api/control-panel`; used in `/api/nl-command` kill-switch; pre-existing duplicate `enabled` key in `getState` fixed
- `src/pages/ControlsPage.tsx` — System Kill-switches section with NL Webhook toggle

**Acceptance criteria:**
- [x] Keyboard-navigable section collapsing (aria-expanded)
- [x] Persist section open/close state in localStorage
- [x] Tooltip on each multiplier field showing effect direction
- [x] `NL_WEBHOOK_ENABLED` kill-switch surfaced in Controls tab

---

## Non-Goals
- Do not change the server-side formula
- Do not change the API contracts
- Do not add a new "preview" API endpoint — compute client-side
- Do not redesign Observer or Publisher panels in Sprint 1
