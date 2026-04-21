# Known Error Database (KEDB)

Structured records of confirmed bugs, architectural traps, and hard-won debugging lessons.
Each entry covers: symptoms → root cause → diagnosis path → fix → prevention.

**When to add an entry:** Any bug that required more than one debugging iteration,
involved a non-obvious root cause, or produced misleading symptoms that led an agent astray.

**Format:** `KE-NNN-short-slug.md` with YAML frontmatter + prose sections.

---

| ID | Title | Severity | Status | Components |
|----|-------|----------|--------|------------|
| [KE-001](KE-001-scheduler-gap-recheck.md) | Scheduler reverts to 60-min interval after successful publish | critical | fixed | `lib/scheduler.ts`, `bot.ts` |
