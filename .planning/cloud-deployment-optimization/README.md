# Cloud Deployment Optimization

> Ppomppu OTT Bot — Production deployment for free-tier/low-RAM cloud (512 MB - 1 GB RAM)

## Documents

| File | Purpose |
|------|---------|
| [specs/cloud-deployment-optimization-v1.json](specs/cloud-deployment-optimization-v1.json) | Feature spec — user stories, requirements, edge cases, success criteria |
| [plans/cloud-deployment-optimization-plan-v1.json](plans/cloud-deployment-optimization-plan-v1.json) | Implementation plan — 6 phases, 29 tasks, technical context, constitution check |
| [tasks/cloud-deployment-optimization-tasks-v1.json](tasks/cloud-deployment-optimization-tasks-v1.json) | Task breakdown — per-task files, preconditions, acceptance criteria, dependency graph |
| [sessions/execution-loop-v1.json](sessions/execution-loop-v1.json) | Execution loop — session workflow, parallel execution groups, quality gates, escalation rules |
| [sessions/handover-template-v1.json](sessions/handover-template-v1.json) | Session handover template — required fields, example, workflow |
| [sessions/model-recommendations-v1.json](sessions/model-recommendations-v1.json) | AI model recommendations — per-phase model selection, cost optimization, switching rules |

## Related Documents

- Source guide: `/home/vscode/.gemini/antigravity/brain/.../cloud_deployment_optimization_guide.md.resolved`
- Constitution: `.planning/spec-kit/constitution.md`
- Remote-ops contracts: `.planning/spec-kit/specs/remote-ops.*.contract.json`
- Existing ops scripts: `ops/deploy/`, `ops/systemd/`, `ops/aws/`
- AGENTS.md — publisher success criteria, env var discipline, regression checklist

## Quick Start

```bash
# 1. Read the spec for user stories and requirements
cat .planning/cloud-deployment-optimization/specs/cloud-deployment-optimization-v1.json

# 2. Read the plan for phase ordering and technical context
cat .planning/cloud-deployment-optimization/plans/cloud-deployment-optimization-plan-v1.json

# 3. Read tasks for per-task details and dependency graph
cat .planning/cloud-deployment-optimization/tasks/cloud-deployment-optimization-tasks-v1.json

# 4. Start execution — begin with Phase 1, tasks T-001 through T-006
#    Follow the execution loop in sessions/execution-loop-v1.json
#    Use model recommendations in sessions/model-recommendations-v1.json
```

## Phase Summary

| Phase | Tasks | Priority | Model | Effort |
|-------|-------|----------|-------|--------|
| 1. Foundation & Memory Safety | T-001 to T-006 | P1 | Sonnet | ~1 hr + 2 hr wall clock |
| 2. Docker Multi-Stage Build | T-007 to T-012 | P2 | Sonnet | ~1.5 hr |
| 3. Deploy Safety & Persistence | T-013 to T-017 | P1/P2 | Sonnet | ~1 hr |
| 4. SQLite & I/O Optimization | T-018 to T-020 | P1/P2 | Sonnet | ~45 min |
| 5. Observability & Health | T-021 to T-024 | P2/P3 | Sonnet | ~45 min |
| 6. NL Webhook LLM Router | T-025 to T-029 | P2/P3 | Opus + Sonnet | ~3.5 hr |

**Total estimated effort:** ~8-12 hours active work + 2 hours wall-clock stress test

## Branch

- Feature branch: `cloud-deploy-opt`
- Main branch: `main`

## Key Constraints

- Target: 512 MB - 1 GB RAM, 1 vCPU, network-attached storage
- Avoid sleep-on-inactivity platforms (Render free, Vercel)
- Chromium requires --disable-dev-shm-usage (mandatory)
- activity_log.json capped at 5000 entries
- Docker image must be < 800 MB
- Deploy + smoke check < 120 seconds
- Rollback < 60 seconds
