# Workspace Planning & Engineering Portfolio

> Central hub for all engineering initiatives, architecture specifications, runtime contracts, and operational planning.

---

## 1. Initiative Directory Architecture

All active engineering initiatives, refactorings, and feature epics are organized into **Vertical Initiative Packages** under `.planning/initiatives/`. Each package contains all research, problem statements, execution plans, guidelines, work item specs, and session handovers in a single dedicated workspace.

### Active & Shipped Initiatives Portfolio

| Initiative | Status | Purpose / Scope | Primary Entry Point |
| :--- | :--- | :--- | :--- |
| **[publisher-modernization](initiatives/publisher-modernization/README.md)** | `shipped` | 503 maintenance auto-pause, 1-post/hr rate limit retry trap, script bloat pruning, DOM hardening | [README.md](initiatives/publisher-modernization/README.md) |
| **[cloud-deployment-optimization](initiatives/cloud-deployment-optimization/README.md)** | `shipped` | 512MB RAM cloud deploy, Docker multi-stage builds, systemd supervision, SQLite tuning, NL webhook router | [README.md](initiatives/cloud-deployment-optimization/README.md) |
| **[competitor-intel](initiatives/competitor-intel/README.md)** | `shipped` | Crawlee-based competitor ad extraction, Cheerio noise reduction, Ollama structured extraction | [README.md](initiatives/competitor-intel/README.md) |
| **[state-authority](initiatives/state-authority/README.md)** | `active` | Runtime single source of truth, scheduler signal isolation, SOV dynamic intervals, atomic state | [README.md](initiatives/state-authority/README.md) |
| **[analytics-eda](initiatives/analytics-eda/README.md)** | `active` | Competitor analytics dashboard, EDA charts, App shell decomposition, CSV data export | [README.md](initiatives/analytics-eda/README.md) |
| **[ai-advisor-bot](initiatives/ai-advisor-bot/README.md)** | `active` | CopilotKit AI coach, AI advisor recommendations, Slack bot provider integration | [README.md](initiatives/ai-advisor-bot/README.md) |
| **[kakao-chatbot](initiatives/kakao-chatbot/README.md)** | `active` | Kakao OpenBuilder chatbot webhook and auto-reply integration | [README.md](initiatives/kakao-chatbot/README.md) |
| **[agent-infra](initiatives/agent-infra/README.md)** | `active` | Agent memory palace loops, Ollama local inference setup, autonomous workflow tips | [README.md](initiatives/agent-infra/README.md) |
| **[architecture-modernization-202608](initiatives/architecture-modernization-202608/README.md)** | `shipped` | August 2026 monolithic refactor phases 1–6 (foundations, docs, state, file decomposition, contracts, verification) | [README.md](initiatives/architecture-modernization-202608/README.md) |

---

## 2. System Constants & Shared Frameworks

System-wide truths, runtime definitions, and historical records live in dedicated directories outside initiatives:

```
.planning/
├── initiatives/                  # Vertical initiative packages (Work items, research, specs)
├── spec-kit/                     # Current Truth: runtime manifests, behavioral contracts, UI catalogs
│   ├── contracts/                # Runtime & behavioral contracts (imported by server/tests)
│   ├── manifest/                 # Playbooks, workflows, environment schemas (copied in Docker)
│   ├── reference/                # Global UI route map, screen inventory, ad design system
│   └── constitution.md           # Engineering principles and non-negotiables
├── known-issues/                 # Known Error Database (KEDB: KE-001..KE-003)
├── audit/                        # Architecture reviews and structure roadmaps
└── directives/                   # System auditing directives
```

### Key Principles
1. **Vertical Initiative Packages:** Never scatter an initiative's research into `docs/` and its specs into horizontal folders. Everything for an initiative lives in its package.
2. **Spec Lifecycle Agreement:** Specs in `specs/active/` must declare `proposed` or `active`. Specs in `specs/shipped/` must declare `shipped`. Specs in `specs/archive/` must declare `superseded`.
3. **Runtime Protection:** Files in `spec-kit/contracts/` and `spec-kit/manifest/` are consumed by running services; do not rename or relocate without updating Docker and runtime import paths.
