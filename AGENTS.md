# Agent Operating Guide

Quick reference for AI agents working in this repository.

## Quick Start

```bash
npm run mempalace:wake-up   # REQUIRED at session start
npm run lint                # TypeScript check
npm run test:unit           # Fast unit tests
npm run test:integration    # API/publisher tests
```

## Documentation

| Topic | Location |
|-------|----------|
| Architecture & Goals | [.agent/ARCHITECTURE.md](.agent/ARCHITECTURE.md) |
| Operations & Debugging | [.agent/OPERATIONS.md](.agent/OPERATIONS.md) |
| Known Issues (KEDB) | [.agent/KNOWN_ISSUES.md](.agent/KNOWN_ISSUES.md) |
| Test Framework | [tests/README.md](tests/README.md) |
| Competitor Intel | [.planning/competitor-intel-playbook.md](.planning/competitor-intel-playbook.md) |

## Core Principles

1. **Fail-closed publishing**: Success requires draft loaded + submit triggered + URL redirect verified.
2. **Contract alignment**: Runtime code must stay aligned with spec-kit manifests.
3. **Gap-driven scheduling**: Scheduler reacts to board gap, not fixed time intervals.

## Key Files

```
config/env.ts              # Environment parsing (canonical)
.agent/contracts/          # Data and API contracts
.planning/spec-kit/specs/  # Semantic specs
.planning/known-issues/    # KEDB entries
```

## Session Workflow

1. Run `npm run mempalace:wake-up` before reading source files
2. Check KEDB for known issues before debugging anomalies
3. Run `npm run lint` after code edits
4. Run appropriate test suite for changes
5. End session with `npm run mempalace:handover`
