# Known Issues Database (KEDB)

Structured bug records with symptoms, root cause, diagnosis path, and lessons learned.

**Check this before diagnosing any publisher/observer anomaly.**

## Active Issues

| ID | Title | Severity |
|----|-------|----------|
| [KE-001](../.planning/known-issues/KE-001-scheduler-gap-recheck.md) | Scheduler reverts to 60-min interval after successful publish | critical |
| [KE-002](../.planning/known-issues/KE-002-nvme-ssd-wear-and-docker-oom.md) | System unresponsiveness and rapid NVMe SSD wear from Docker/Playwright | critical |

## Adding New Entries

When you confirm a new bug that:
- Required >1 debugging iteration, OR
- Produced misleading symptoms

Add an entry:
1. Copy frontmatter from an existing entry
2. Increment the ID
3. Fill all sections: symptoms, root cause, diagnosis, lessons learned

## Location

All KEDB entries: `.planning/known-issues/`