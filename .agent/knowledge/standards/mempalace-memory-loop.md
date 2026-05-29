# MemPalace Memory Loop Standards

## Purpose
Maintain persistent state for AI agents working on the marketing automation system, enabling continuity across sessions and handoffs between different AI workers.

## Core Principles
- Source of truth: local files always win over palace if they conflict
- Indexing scope: memory/context artifacts only
- Preserve existing API behavior during state transitions

## Session Flow
1. **Start**: `npm run mempalace:wake-up` (seeds palace, wakes up on `marketing_automation` wing)
2. **Mid-task**: `npm run mempalace:checkpoint` after each meaningful decision or completed slice
3. **End**: `npm run mempalace:handover -- --file .agent/session-handovers/handover-YYYYMMDD-HHMM.json`

## Memory Artifacts
Include in indexing:
- `.agent/state`
- `.agent/session-handovers`
- `.planning/spec-kit/specs`
- Relevant planning JSON

Exclude from indexing:
- `src/**`, `lib/**`, `tests/**`
- `.env*`, large debug artifacts

## Naming Conventions
- Handover files: `handover-YYYYMMDD-HHMM.json`
- State index: `state.index.json`

## Error Handling
- Always run `npm run mempalace:wake-up` before reading any source files
- Handle conflicts by prioritizing local files over palace state
- Maintain identity sync automatically (pass `--no-sync-identity` to opt out)

## Identity & Sync
- Identity sync is automatic by default
- Wing activation: `marketing_automation` wing on wake-up
- State persistence across agent sessions