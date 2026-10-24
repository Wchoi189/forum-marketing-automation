---
title: State Authority & Scheduler Hardening
status: active
initiative_id: state-authority
tags:
  - state-authority
  - scheduler
  - signal-isolation
  - sov-multiplier
---

# State Authority & Scheduler Hardening

> Architectural hardening to establish a single authoritative source of truth for runtime bot state, dynamic SOV intervals, and scheduler signal isolation.

## 1. Initiative Overview

Coordinates runtime state between the dashboard UI, API routes, background scheduler, and Playwright bots. Solves concurrency conflicts via optimistic locking (`stateVersion`), provides signal isolation to prevent noisy scheduler rechecks, and dynamically adapts posting intervals based on forum Share-of-Voice (SOV).

---

## 2. Documentation Map

| Document | Purpose |
| :--- | :--- |
| **[plans/state-authority-hardening.plan.json](plans/state-authority-hardening.plan.json)** | Master hardening plan |
| **[specs/active/state-authority-final-goal-v1.json](specs/active/state-authority-final-goal-v1.json)** | Target state authority specification |
| **[specs/active/scheduler-sov-multiplier-v1.json](specs/active/scheduler-sov-multiplier-v1.json)** | Dynamic interval SOV multiplier spec |
| **[specs/shipped/scheduler-signal-isolation-slice1.json](specs/shipped/scheduler-signal-isolation-slice1.json)** | Scheduler signal isolation slice 1 |
| **[specs/shipped/scheduler-signal-isolation-slice2.json](specs/shipped/scheduler-signal-isolation-slice2.json)** | Scheduler signal isolation slice 2 |
| **[specs/shipped/state-authority-ops-closeout-slice1.json](specs/shipped/state-authority-ops-closeout-slice1.json)** | Operations closeout spec |
| **[specs/shipped/state-sync-architecture.md](specs/shipped/state-sync-architecture.md)** | State synchronization architecture document |
| **[specs/archive/scheduler-ux-refactor.md](specs/archive/scheduler-ux-refactor.md)** | Superseded UX refactor spec |
| **[archive/](archive/)** | Historical sprint logs and session handovers |
