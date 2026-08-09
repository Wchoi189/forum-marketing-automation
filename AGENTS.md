# Agent Operating Guide

Quick reference for AI agents working in this repository.

## Quick Start

```bash
npm run mempalace:wake-up   # REQUIRED at session start
npm run lint                # tsc (both configs) + ast-grep scan + structure check
npm run lint:structure      # .structure.json policy only (~1s)
npm run hooks:install       # pre-commit hook running the structure check
npm run test:unit           # Fast unit tests
npm run test:integration    # API/publisher tests
```

`npm run lint` and `npm test` both run in CI (`.github/workflows/ci.yml`) on every
pull request and every push to `main`. A red check blocks the merge — treat a
local failure the same way.

**Where a new file goes** is enforced, not advisory. `.structure.json` allowlists the
repo root, denies `*.zip`/`*.bak`/`*.log` anywhere, declares module entry points, and
caps source files at 500 lines with named exemptions. Writing a findings document to
the repo root fails the build; put it in `.agent/` (how the system works now) or
`.planning/` (specs, audits, roadmaps).

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
config/env.ts                    # Environment parsing (canonical)
.agent/contracts/                # Data and API contracts
.planning/spec-kit/contracts/    # Behavior contracts and policies (current truth)
.planning/spec-kit/reference/    # Reviewer pack: catalogs, inventories, guidelines
.planning/spec-kit/specs/active/ # In-flight work — read this when orienting
.planning/known-issues/          # KEDB entries
```

Specs carry a `status` of `proposed | active | shipped | superseded`, and the
directory must match it (`specs/active`, `specs/shipped`, `specs/archive`).
`npm run lint:structure` fails on a mismatch. Contracts and reference docs are
current truth and carry no status.

## Session Workflow

1. Run `npm run mempalace:wake-up` before reading source files
2. Check KEDB for known issues before debugging anomalies
3. Run `npm run lint` after code edits
4. Run appropriate test suite for changes
5. End session with `npm run mempalace:handover`
