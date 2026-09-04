---
title: Publisher Architecture Modernization
status: active
initiative_id: publisher-modernization
created: 2026-09-04
tags:
  - publisher
  - rate-limit
  - maintenance-window
  - playwright
  - state-authority
---

# Publisher Architecture Modernization

> Production stabilization, maintenance engine automation, 1-post-per-hour rate limit backoff, Playwright DOM hardening, and script bloat pruning.

## 1. Initiative Overview

The automated publisher component currently experiences repeated failure cascades caused by two operational conditions:
1. **Unrecognized Maintenance Windows:** Target platform maintenance pages ("점검 중 입니다" / HTTP 503) trigger aggressive 5-minute retry loops instead of parsing maintenance window bounds and auto-pausing until the maintenance period ends.
2. **1-Post-Per-Hour Rate Limit Trap:** Target platform enforces a strict 1 post per hour ceiling. The current scheduler detects the rate limit, calculates remaining wait time, but is immediately overridden by `gap_override` or fixed 5-minute intervals, spamming failed publishing attempts and risking account ban.
3. **Severe Code Bloat & Stateful Fallback Chaining:** Playwright navigation logic has accumulated layers of defensive fallbacks and shadowed state, resulting in 500+ line scripts and nondeterministic DOM interactions.

---

## 2. Documentation Map & Navigation

| Document | Description |
| :--- | :--- |
| **[plans/publisher-architecture-modernization.plan.json](plans/publisher-architecture-modernization.plan.json)** | Master multi-phase execution plan |
| **[guidelines.md](guidelines.md)** | Model performance recommendations, HITL batching protocol, session boundaries & continuation prompts |
| **[research/01-bug-report-publisher-failures.md](research/01-bug-report-publisher-failures.md)** | Detailed incident bug report with failure logs and root causes |
| **[research/02-assessment-report.md](research/02-assessment-report.md)** | Technical assessment report and component interaction matrix |
| **[research/03-publisher-architecture-assessment.md](research/03-publisher-architecture-assessment.md)** | Architectural review: configurability, state drift, override traps, and script bloat |
| **[research/04-browser-alternative-obscura-assessment.md](research/04-browser-alternative-obscura-assessment.md)** | Tech evaluation of Rust-based Obscura browser (recommended for observer, rejected for publisher) |
| **[research/05-planning-doc-architecture-assessment.md](research/05-planning-doc-architecture-assessment.md)** | Planning documentation navigability assessment and vertical initiative packaging rationale |

---

## 3. Phased Implementation Specs

| Phase | Spec File | Status | Focus |
| :--- | :--- | :--- | :--- |
| **Phase 1** | [specs/shipped/phase1-bloat-pruning-v1.json](specs/shipped/phase1-bloat-pruning-v1.json) | `shipped` | Prune 10 orphaned scripts (~55KB dead code), clean dead package.json scripts, ratchet structure boundary |
| **Phase 2** | [specs/shipped/phase2-publisher-scheduler-stabilization-v1.json](specs/shipped/phase2-publisher-scheduler-stabilization-v1.json) | `shipped` | Fix 1-post/hr rate limit retry trap; enforce mandatory cooldown in scheduler & pre-flight gatekeeper |
| **Phase 3** | [specs/shipped/phase3-maintenance-engine-v1.json](specs/shipped/phase3-maintenance-engine-v1.json) | `shipped` | Platform maintenance window detection ("점검 중 입니다"); auto-pause & auto-resume engine |
| **Phase 4** | [specs/active/phase4-state-architecture-consolidation-v1.json](specs/active/phase4-state-architecture-consolidation-v1.json) | `active` | State authority consolidation, persistent pause state, atomic lock release, regression verification |

---

## 4. Historical Reference

Historical sprint logs and task checklists from the earlier publisher refactor are preserved in [archive/](archive/).
