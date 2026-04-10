# Skill: Context Hygiene

**Purpose:** Audit and prune stale planning artifacts, session handovers, and debug traces to prevent context bloat from degrading agent session quality.

**Invocation:** Run as an agent skill when the user requests `/context-hygiene audit` or `/context-hygiene prune`.

---

## Rules

### NEVER DELETE (fails-closed)
- The most recent `session-handover-*.md` file in `.planning/spec-kit/plans/tasks/` (by filename date or mtime)
- Any file referenced by the current handover's "Spec" or "Sprint" links
- `artifacts/publisher-runs/` entries from **today**
- `.agent/state/state.index.json`
- `.agent/contracts/*.json`
- `.planning/spec-kit/specs/*.json` unless confirmed deferred AND >14 days old
- Any file under `.gitignore` exclusion that is not git-tracked

### ARCHIVE BEFORE DELETE
Move completed artifacts to `.planning/spec-kit/.completed/<category>/<filename>`:
- `category = "handovers"` for old session handover JSONs
- `category = "plans"` for fully-checked-off task/sprint files
- `category = "specs"` for deferred specs >14 days old

---

## Audit Phase (audit mode)

### 1. Session Handover Sweep
- Find all `session-handover*.md` in `.planning/spec-kit/plans/tasks/`
- Find all `handover-*.json` in `.agent/session-handovers/`
- Identify the most recent handover (current session anchor)
- Flag older handovers as compression candidates

### 2. Planning Artifact Sweep
- Find all `.md` files in `plans/tasks/` and `plans/sprints/` where ALL checklist items are `[x]`
- Flag as archival candidates

### 3. Stale Snapshot Purge
- Find any `reference/*.txt` or static tree snapshots
- Flag for deletion (always stale by nature)

### 4. Debug Artifact Review
- Count `trace.zip` files in `artifacts/publisher-runs/`
- Identify traces older than 2 days
- Flag `board-diagnostics/`, `screenshots/` entries older than 7 days

### 5. Deferred Spec Check
- Find specs with "(deferred)" or "frozen" in name or title
- If >14 days old, flag as "activate or archive?"

### 6. Report
Emit a table:
```
| Category | Candidates | Est. Bytes | Action |
|----------|-----------|------------|--------|
```
Then ask: "Prune now? (y/n)"

---

## Prune Phase (prune mode)

After user confirms, execute:

1. **Archive** completed planning files → `.planning/spec-kit/.completed/plans/`
2. **Compress** old handover JSONs → single `.planning/spec-kit/.completed/handovers/summary.jsonl`
3. **Delete** stale snapshots (`reference/*.txt`)
4. **Delete** traces older than 2 days
5. **Delete** debug artifacts older than 7 days
6. **Report** final summary: files moved, files deleted, bytes freed

---

## Safety Checklist

- [ ] Current handover file is untouched
- [ ] Active specs (referenced by current handover) are untouched
- [ ] Today's publisher run artifacts are untouched
- [ ] `.agent/state/state.index.json` is untouched
- [ ] All deletions go through `.completed/` archive first (git-tracked)
- [ ] Report emitted before and after
