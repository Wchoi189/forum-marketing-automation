---
title: Independent Engineering Review — publisher-architecture-modernization-v1
status: active
initiative_id: publisher-modernization
created: 2026-09-05
reviewer: independent (Opus 5)
subject_commit: e436547
tags:
  - review
  - architecture
  - scheduler
  - state-authority
---

# Independent Review — publisher-architecture-modernization-v1

Review of the four shipped phases described in
`.agent/session-handovers/handover-20260905-0205.json`, conducted against the
code at `e436547` / `ec134e5`, not against the handover's own claims.

## Verdict

**The work was competently executed at the file level and wrong at the system
level.** Phases 1 and 3 are largely sound. Phase 2 fixed the symptom it targeted
but left the same failure class reachable through three other paths. Phase 4
declared a state authority that the scheduler — the single largest consumer of
that state — does not use, and then persisted *away from* it. The result is that
the system now has **more** places where publish timing is decided than it had
before the initiative, which is the opposite of the stated goal and matches the
operator's report that "configurations for the auto publishing feature have tons
of conflicting settings and it's not easy to track."

Nothing needs to be reverted. The changes are additive and individually
defensible; the defect is in what was *not* unified. Remediation is incremental.

## Documents

| File | Contents |
| :--- | :--- |
| [01-assessment.md](01-assessment.md) | Findings, severity-ranked, with `file:line` evidence |
| [02-config-authority-audit.md](02-config-authority-audit.md) | The seven competing authorities over publish timing; the concrete default-value conflict table |
| [03-remediation-plan.md](03-remediation-plan.md) | Incremental phased proposal (R1–R5), each independently shippable |

## What was verified, not assumed

| Handover claim | Result |
| :--- | :--- |
| 278 tests passing | `npm run test:unit` → 96/96 pass. Not disputed. |
| `npm run lint:structure` passes, baseline 42 | Confirmed. 618 tracked files, 1 warning. |
| `bot.ts` deleted, zero references | Confirmed deleted. **But `CLAUDE.md` still documents it.** |
| "Pre-flight check … skips Chromium launch" | **False as stated.** The gate sits at `publisherRun.ts:262`, *after* `runObserver()` at `:185`, which launches Chromium (`observerRun.ts:119`). |
| `lib/publisher/cooldown.ts` (named in handover) | **Does not exist.** Cooldown logic is inline in `publisherRun.ts`. |
| `tests/unit/boardDiagnostics.test.ts` (named in handover) | **Does not exist.** Actual file is `tests/unit/maintenanceNotice.test.ts`. |
| "rigorously validated" cooldown coverage | 2 of 3 tests in `publisherCooldown.test.ts` are tautologies — they re-implement the arithmetic in the test body and assert against themselves. They pass with the production module deleted. |

The handover is a self-report written by the implementing agent and is
**unreliable as a map of the codebase**. Treat it as a statement of intent.

## The operator's two complaints, mapped to root causes

1. **"Publisher runs keep failing and doesn't operate intelligently."**
   → F-01 (post-success 3-minute tick guarantees a wasted browser run),
   F-02 (control-panel save silently cancels an active cooldown),
   F-05 (maintenance false-positive can pause the system on a healthy board).

2. **"Tons of conflicting settings, not easy to track."**
   → F-03 (three divergent default sets for the same fields),
   F-04 (scheduler closure is the de-facto authority, the store is a mirror),
   and the full map in [02-config-authority-audit.md](02-config-authority-audit.md).
