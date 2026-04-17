# Fiori Integration — AI Agent Context Map

**Branch:** `fiori-integration`
**Purpose:** Experiment in adopting SAP Fiori design principles alongside the existing dashboard.

---

## Two UI Worlds — Do Not Mix

| Layer | Location | Technology | Status |
|-------|----------|------------|--------|
| **Existing** | `src/components/` | Tailwind CSS, lucide-react, ReactFlow | Stable — preserve as-is |
| **Fiori** | `src/fiori/` | `@ui5/webcomponents-react` | New — all Fiori work goes here |

**Rule for AI agents:**
- Working in `src/components/` or `src/pages/`? Follow the existing Tailwind + custom-component patterns in CLAUDE.md.
- Working in `src/fiori/`? Follow SAP Fiori design principles. Use `@ui5/webcomponents-react` components. Apply SAP skills below.

Never apply Fiori patterns inside `src/components/`, and never use Tailwind inside `src/fiori/`.

---

## Backend Scope (Important)

This project uses **Express + Node.js** — not SAP CAP.

The CAP-specific skills are **not applicable** here:
- `sap-cap-developer` — irrelevant (no CDS, no OData services)
- `sap-cap-deployment` — irrelevant (no BTP deployment)

The backend API surface is documented in CLAUDE.md under "API Surface".

---

## Active SAP Fiori Skills (Claude Code)

These skills are installed in `.github/skills/` and are available in this project:

| Skill | When to Use |
|-------|-------------|
| `sap-fiori-designer` | Planning which Fiori floorplan fits a new view or page |
| `sap-fiori-elements-developer` | Building Fiori UI patterns with `@ui5/webcomponents-react` |
| `sap-fiori-scaffolder` | Scaffolding a standalone Fiori micro-app structure |

Full agent definitions (with detailed guidelines) are in `.ai/sap-fiori/`.

---

## Component Library

`@ui5/webcomponents-react` is the component library for `src/fiori/`. Import components from it:

```tsx
import { Button, Title, Panel, FlexBox, Card, CardHeader } from '@ui5/webcomponents-react';
```

Do NOT import Tailwind classes or lucide-react icons inside `src/fiori/`.

---

## Fiori Floorplan Mapping for This Dashboard

Based on `sap-fiori-designer` analysis, the existing dashboard views map to these Fiori floorplans:

| Current View | Target Fiori Floorplan | Notes |
|--------------|------------------------|-------|
| Overview | **Overview Page (OVP)** | Cards for scheduler, observer, publisher stats |
| Publisher Runs | **List Report** | Browse run history with filter bar |
| Run Detail | **Object Page** | Single run with sections |
| Controls | **Object Page** | Settings/configuration object |
| Analytics | **Analytical List Page (ALP)** | Charts, KPIs, competitor data |

These are migration targets for Phase 2+. Phase 1 (current) is environment setup only.

---

## Directory Structure (Target)

```
src/fiori/
├── components/          # Reusable Fiori components (cards, panels, status badges)
├── pages/               # Fiori page-level views (one per floorplan)
├── layouts/             # Fiori layout wrappers (ShellBar, SideNav)
└── theme/               # UI5 theme configuration
```

---

## Migration Strategy

1. **Phase 0 (done 2026-04-15):** Branch + landing zone + skills installed.
2. **Phase 1 (done 2026-04-16):** `src/fiori/` skeleton live. ShellBar + SideNavigation shell. OVP overview page with 4 real data cards (Scheduler, Observer, Board Stats, Publisher History). Accessible at `/fiori`.
3. **Phase 3:** Incrementally replace existing views with Fiori equivalents, one page at a time.
4. **Phase 4:** Flip default route; retire `src/components/` gradually.

The parallel `/fiori` route means the existing dashboard is never broken during migration. At any point, both worlds work.

---

## Reference

- `.ai/sap-fiori/` — full SAP agent definitions (detailed guidelines)
- `.github/skills/` — Claude Code skills (sap-fiori-designer, sap-fiori-elements-developer, sap-fiori-scaffolder)
- [UI5 Web Components for React](https://sap.github.io/ui5-webcomponents-react/) — component docs
- [SAP Fiori Design Guidelines](https://experience.sap.com/fiori-design-web/) — UX patterns
