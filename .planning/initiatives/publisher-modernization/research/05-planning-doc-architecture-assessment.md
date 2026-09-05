---
title: Planning Documentation Architecture & Navigability Assessment
date: 2026-09-04
evaluated_subsystem: Workspace Planning & Spec-Kit Organization
status: completed
recommendation: overhaul-to-initiative-centric-vertical-packaging
tags:
  - documentation-architecture
  - spec-kit
  - developer-experience
  - ai-agent-context
  - navigability-audit
---

# Planning Documentation Architecture & Navigability Assessment

## 1. Executive Summary

A critical audit of the current planning documentation confirms the user's observation: **the planning and implementation documentation is organized by horizontal artifact type rather than vertical initiative cohesion.**

For a single engineering initiative—such as the **Publisher Architecture Modernization**—the related documentation is scattered across **five distinct, disconnected directory trees**:

```
Current Fragmented Documentation Map for a Single Initiative:
├── docs/publisher-assessment/                      <-- Problem analysis, bug reports, tech evaluations
├── .planning/spec-kit/plans/                       <-- Master multi-phase plan
├── .planning/spec-kit/specs/active/                <-- Phase 1–4 active JSON specs & markdown guidelines
├── .planning/spec-kit/contracts/                   <-- Runtime gap policies & schemas
└── .agent/session-handovers/                       <-- Agent session handovers
```

### Key Verdict
- **For Human Engineers:** High cognitive friction. You cannot open a single folder in VS Code or GitHub to review an initiative from root cause to implementation spec to completion handover.
- **For AI Agents:** Severe context fragmentation. Agents waste significant token budget searching across disjoint folder trees, frequently miss prerequisite background analysis (e.g., bug reports in `docs/`), and face reconciliation drift across file types.
- **Root Cause:** Over-reliance on **horizontal type-based siloing** (grouping all "plans" together and all "specs" together) rather than **vertical initiative packaging** (grouping all documents for an initiative in one cohesive workspace).

---

## 2. Navigability & Locatability Audit

### 2.1 The 5-Tree Scavenger Hunt

When an agent or human operator attempts to understand or execute the Publisher Modernization, they must navigate through five disparate hierarchies:

| Document Role | Current Location | Accessibility / Discoverability Defect |
| :--- | :--- | :--- |
| **Bug Reports & Incident Root Cause** | `docs/publisher-assessment/bug-report-publisher-failures.md` | Hidden in `docs/`; spec files in `.planning/` do not automatically link to it. |
| **Architectural Assessment** | `docs/publisher-assessment/publisher-architecture-assessment.md` | Separated from the actionable implementation specs in `.planning/spec-kit/`. |
| **Alternative Technology Evaluations** | `docs/publisher-assessment/browser-alternative-obscura-assessment.md` | Isolated research document with no direct folder link to the active implementation backlog. |
| **Multi-Phase Master Plan** | `.planning/spec-kit/plans/publisher-architecture-modernization.plan.json` | Sits in a generic `plans/` bucket alongside unrelated plans (competitor intel, state authority). |
| **Active Work Item Specs** | `.planning/spec-kit/specs/active/phase1-bloat-pruning-v1.json`, `phase2-...` | Mixed into a flat directory containing unrelated specs (Kakao bot, CopilotKit coach, UI backlog). |
| **Execution Guidelines** | `.planning/spec-kit/specs/active/publisher-modernization-guidelines.md` | Loose markdown file sitting among active JSON work items. |
| **Session Handovers** | `.agent/session-handovers/handover-*.json` | Sits in `.agent/`, completely detached from the specs that generated the work. |

---

### 2.2 Why This is Problematic for AI Agents

1. **Semantic Blind Spots:**
   LLMs navigate codebases via file discovery tools (`list_dir`, `grep_search`). When an agent is prompted:
   > *"Implement Phase 2 of the publisher stabilization"*
   The agent looks at `.planning/spec-kit/specs/active/phase2-publisher-scheduler-stabilization-v1.json`. It will **rarely discover** `docs/publisher-assessment/bug-report-publisher-failures.md` or `publisher-architecture-assessment.md` unless explicitly spoon-fed the path. As a result, the agent misses the detailed log breakdowns, DOM selector race condition analysis, and Korean platform nuances documented in the assessment.
2. **Context Window Waste (Tool Thrashing):**
   To reconstruct the big picture, an agent must execute 5–8 distinct tool calls across `.planning/`, `.agent/`, and `docs/`. This burns context window space before a single line of code is written.
3. **Reconciliation & Drift:**
   When requirements evolve, keeping documentation synchronized across `docs/`, `plans/`, `specs/active/`, and `.agent/` becomes nearly impossible. In practice, specs get updated while assessments remain stale, creating contradictory guidance.
4. **Flat-Namespace Clutter in `specs/active/`:**
   `.planning/spec-kit/specs/active/` is currently a flat bucket with 12+ files from 5 completely unrelated projects:
   ```
   specs/active/
   ├── copilotkit-coach-v1.json
   ├── dashboard-ux-followup.md
   ├── kakao-chatbot-v1.json
   ├── mempalace-memory-loop-v1.json
   ├── phase1-bloat-pruning-v1.json
   ├── phase2-publisher-scheduler-stabilization-v1.json
   ├── phase3-maintenance-engine-v1.json
   ├── phase4-state-architecture-consolidation-v1.json
   ├── publisher-modernization-guidelines.md
   ├── scheduler-sov-multiplier-v1.json
   ├── state-authority-final-goal-v1.json
   └── ui-refactor-backlog.json
   ```
   As more initiatives are launched, this directory becomes unnavigable.

---

## 3. Root Cause Analysis: How Did We Get Here?

1. **Initial Intention (Policy Guardrails):**
   The repository introduced `.structure.json` to prevent loose markdown files from cluttering the repo root.
2. **Horizontal Type-Based Categorization:**
   The spec-kit established lifecycle states (`proposed`, `active`, `shipped`, `archive`) and forced all active work items into a single flat folder (`specs/active/`).
3. **Disjoint "Docs" Escape Hatch:**
   When exploratory investigations, incident reviews, and bug reports were written, they were placed in `docs/` because `.structure.json` prohibited markdown in the root and restricted `spec-kit/` to formal contracts and specs.
4. **The Result:** The system enforced **strict compliance at the cost of modular cohesion**. Documents are organized by what *type of file* they are, rather than *what feature they describe*.

---

## 4. Target Architecture: Initiative-Centric (Vertical) Packaging

To make documentation intuitive for both humans and AI agents, the planning architecture should shift from horizontal type-slicing to **Vertical Initiative Packages**.

### 4.1 Concept: The Dedicated Initiative Package

Every major initiative, refactoring effort, or feature epic should have its own **self-contained dedicated directory**:

```
.planning/initiatives/01-publisher-modernization/
├── README.md                      <-- Single entry point (Executive summary & index)
├── 01-bug-report.md               <-- Incident analysis & root cause
├── 02-architecture-assessment.md  <-- Technical deep dive & configurability review
├── 03-tech-eval-obscura.md        <-- Alternative evaluations (Obscura browser)
├── plan.json                      <-- Multi-phase master execution plan
├── guidelines.md                  <-- Model execution rules & batching protocols
├── phases/                        <-- Dedicated specs for each phase
│   ├── phase-1-bloat-pruning.json
│   ├── phase-2-publisher-stabilization.json
│   ├── phase-3-maintenance-engine.json
│   └── phase-4-state-consolidation.json
└── handovers/                     <-- Local session handovers for this initiative
    ├── handover-20260904-1200.json
    └── handover-20260904-1330.json
```

### 4.2 Why This Overhaul Solves the Problem

1. **Single Entry Point for Humans & AI:**
   An engineer or agent only needs one path:
   `.planning/initiatives/01-publisher-modernization/README.md`.
   Opening that folder provides the complete narrative: the problem, the architectural diagnosis, the technology decisions, the implementation specs, and the session progress.
2. **Zero Context Loss for AI Agents:**
   When prompted to work on a phase, the agent simply inspects `.planning/initiatives/01-publisher-modernization/`. All related analysis is immediately discoverable in the same directory tree.
3. **Isolated Initiative Lifecycles:**
   When an initiative is completed, the entire folder moves cleanly from `active/` to `shipped/` (e.g. `.planning/initiatives/shipped/01-publisher-modernization/`), preserving the full historical context in one place without leaving orphaned reports in `docs/`.
4. **Clean Root & Structure Compatibility:**
   Eliminates the arbitrary separation between `docs/` and `.planning/spec-kit/`.

---

## 5. Migration Roadmap & Compatibility Strategy

We can transition to this superior layout without breaking current linting or `.structure.json` checks through a simple two-step evolution:

### Step 1: Near-Term Navigation Bridge (Zero Structure Changes)
Keep existing files in place to satisfy current `.structure.json` and CI checks, but introduce a **Master Navigation Index**:
- Create `.planning/spec-kit/specs/active/publisher-modernization-index.json` or a master index markdown linking every related file with absolute repo paths:
  - Links to `docs/publisher-assessment/bug-report-publisher-failures.md`
  - Links to `docs/publisher-assessment/publisher-architecture-assessment.md`
  - Links to `docs/publisher-assessment/browser-alternative-obscura-assessment.md`
  - Links to `.planning/spec-kit/plans/publisher-architecture-modernization.plan.json`
  - Links to each Phase 1–4 spec and session handover target.

### Step 2: Full Overhaul of `.structure.json` & Spec Lifecycle
Update `.structure.json` to formally support initiative packages:
```json
{
  "spec_lifecycle": {
    "root": ".planning/initiatives",
    "statuses": ["active", "shipped", "archive"],
    "allow_initiative_directories": true
  }
}
```
Move the four assessment docs from `docs/publisher-assessment/` into `.planning/initiatives/active/publisher-modernization/`, creating a clean, unified, enterprise-grade planning architecture.

---

## 6. Sizing & Recommendation

| Approach | Effort | Risk | Verdict |
| :--- | :--- | :--- | :--- |
| **Option A: Status Quo (Scattered)** | 0 hrs | High (Ongoing agent confusion & context thrashing) | 🔴 Unsustainable |
| **Option B: Navigation Index Bridge** | 0.5 hrs | Zero (Preserves existing `.structure.json`) | 🟢 **Immediate Quick Win** |
| **Option C: Full Initiative Package Overhaul** | 2 hrs | Low (Requires minor `.structure.json` policy update) | 🟢 **Recommended Permanent Fix** |

**Actionable Recommendation:**
1. Immediately deploy the **Navigation Index Bridge** in `.planning/spec-kit/specs/active/` so agents in the upcoming implementation turns can navigate directly across all publisher assessment and spec documents.
2. In Phase 1 (Bloat Pruning & Hygiene), update `.structure.json` to allow dedicated initiative directories under `.planning/initiatives/`.
