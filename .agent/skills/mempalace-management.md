# Skill: MemPalace Management

**Purpose:** Keep cross-session agent memory current using MemPalace while preserving this repo's local state authority (`.agent/state` + `.agent/session-handovers`).

**Invocation:** Run as an agent skill when the user requests `/mempalace-management wake-up`, `/mempalace-management checkpoint`, or `/mempalace-management handover`.

---

## Scope

### IN (index and retrieve)
- `.agent/session-handovers/*.json`
- `.agent/state/state.index.json`
- `.planning/spec-kit/specs/*.json`
- `.planning/spec-kit/plans/**/*.json`

### OUT (exclude by default)
- `src/**`, `lib/**`, `tests/**` (source/test code)
- Runtime secrets (`.env*`, credential-like files)
- Large debug artifacts under `artifacts/**`

The default behavior is memory/context-first. Source code mining is opt-in only when explicitly requested.

---

## Wake-up Mode

### 1. Pull MemPalace context
- Run `mempalace wake-up --wing forum-marketing-automation`.
- If wing-specific wake-up is unavailable, run `mempalace wake-up`.

### 2. Confirm local state authority
- Read `.agent/state/state.index.json`.
- Read `last_handover_file` from state index and open that handover JSON.

### 3. Fallback if MemPalace is stale/unavailable
- Use local files as source of truth:
  - `.agent/state/state.index.json`
  - latest `.agent/session-handovers/handover-YYYYMMDD-HHMM.json`

---

## Checkpoint Mode

Use this after each meaningful micro-task (decision, blocker, accepted slice).

1. Update the active handover draft with:
- what changed
- decisions and rationale
- blockers and required clarifications
- next atomic action

2. Re-index memory artifacts only:
- `mempalace mine .agent/state`
- `mempalace mine .agent/session-handovers`
- `mempalace mine .planning/spec-kit/specs`

3. Validate retrieval:
- `mempalace search "current objective" --wing forum-marketing-automation`

---

## Handover Mode

At session end:

1. Create a new handover file from `.agent/session-handovers/template.json`.
2. Update `.agent/state/state.index.json`:
- set `last_handover_file` to the new handover path
- preserve existing workflow and forum IDs unless intentionally changed
3. Mine the new handover + state index:
- `mempalace mine .agent/session-handovers`
- `mempalace mine .agent/state`
4. Sanity-check continuity:
- `mempalace status`
- `mempalace search "next action" --wing forum-marketing-automation`

---

## Safety Rules

- Never put secret values into handovers or MemPalace prompts.
- If handover and MemPalace disagree, local files win:
  - `.agent/state/state.index.json`
  - latest handover JSON
- Do not delete existing handovers as part of this skill; use context-hygiene archival flow.
- Keep entries concise and decision-oriented to reduce context bloat.
