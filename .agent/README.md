# Agent Quick Start

This project runs a Playwright-based observer/publisher workflow for the Ppomppu OTT board.

## Essential Links

| Resource | Location |
|----------|----------|
| Test Framework Guide | [tests/README.md](../tests/README.md) |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Operations Guide | [OPERATIONS.md](OPERATIONS.md) |
| Known Issues (KEDB) | [KNOWN_ISSUES.md](KNOWN_ISSUES.md) |
| Competitor Intel Playbook | [.planning/competitor-intel-playbook.md](../.planning/competitor-intel-playbook.md) |
| **Structure backlog** (open) | [.planning/audit/structure-roadmap-2026-08-08.md](../.planning/audit/structure-roadmap-2026-08-08.md) |

## Directory Map

| Path | What lives here |
|------|-----------------|
| `.agent/` | Everything in this table's left column plus `contracts/`, `knowledge/`, `skills/`, `state/`, `metadata.json` |
| `.agent/session-handovers/` | Newest 10 sessions. Older ones rotate into `archive/` automatically |
| `.planning/` | Specs (`spec-kit/`), roadmaps, audits, known-issue writeups |
| `archive/` | Frozen and unreferenced — `_bmad/`, `agent-os/`, `AgentQMS/`, `.ai/`, `kakaoauto-controller-preview/`. Nothing loads from here |
| `artifacts/`, `data/`, `dist/` | Generated, gitignored. Never commit into these |

Root markdown is `README.md`, `CLAUDE.md`, `AGENTS.md` only. Put new agent docs
here in `.agent/`.

## Core Commands

```bash
npm run lint                    # TypeScript check (both tsconfigs)
npm run test:unit               # Fast unit tests
npm run test:integration        # API/publisher tests
npm run test                    # Full suite (lint + unit + integration + mcp)
npm run clean:all -- --dry-run  # List prunable generated files
```

Tests go through `scripts/run-tests.sh`, which redirects `ARTIFACTS_DIR` and
friends to a temp directory. Do not add `tsx --test` invocations that bypass it —
they inherit the developer `.env` and write into the real workspace.

## Session Start

**MANDATORY** — run before reading source files:

```bash
npm run mempalace:wake-up
```

Then call `mempalace_status` (MCP) to confirm palace state.

See [MemPalace spec](../.planning/spec-kit/specs/mempalace-memory-loop-v1.json) for details.