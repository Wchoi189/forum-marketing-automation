---
id: KE-001
date: 2026-04-21
title: Scheduler reverts to 60-minute interval after successful publish
severity: critical
status: fixed
components:
  - lib/scheduler.ts
  - bot.ts
fix_commit: fiori-integration branch, 2026-04-21
---

## Symptoms

- Observer log shows `Decision: SAFE - Gap: 14/4` (or higher), meaning our post is buried
- Publisher history shows successful publishes ~60 minutes apart
- Gap grows to 10–20+ between publish runs
- Operator sees no publishing activity despite board being active
- Misleading: the word "SAFE" suggests the system is healthy, but a large gap means posts are
  accumulating ahead of ours unchecked

## Root Cause

`tick()` in `lib/scheduler.ts` returned `false` after a successful publish
(`published_verified` or `dry_run`). `scheduleNext(false)` then computed the full
60-minute base interval before the next check.

The gap-recheck loop (30s / 1.5min / 3min intervals) only activated when gap was
**below** threshold (not yet safe to publish). Once a publish succeeded and gap reset
to 0, the scheduler went back to the slow interval — during which competitors posted
10–20 times before the next check.

The system was time-driven (publish every 60 min). It needed to be gap-driven
(publish as soon as gap ≥ threshold, then immediately start monitoring for the next opportunity).

## Diagnosis Path

1. Open `artifacts/publisher-history/YYYY-MM-DD.jsonl`
2. Check time gaps between `"decision":"published_verified"` entries
3. If gaps are ~60 min and board is active, the scheduler is in time-driven mode (broken)
4. Confirm via `GET /api/control-panel` → `lastObserverResult.currentGap` vs `requiredGap`
5. If `currentGap >> requiredGap` and last publish was >30 min ago → scheduler stalled post-publish

**Do not be misled by `Decision: SAFE`.** SAFE means the gap is large enough to publish,
not that everything is working. A gap of 14 with threshold 4 is a failure state,
not a healthy state.

## Fix

**`bot.ts` (line ~1325):** Success return now includes `gapInfo`:
```typescript
const successResult = await finish(true, flowMessage, flow.decision, log);
return { ...successResult, gapInfo: { currentGap: 0, requiredGap: policy.gapThresholdMin } };
```

**`lib/scheduler.ts` `tick()`:** After `published_verified` or `dry_run`, set
`wasSuccessPublish = true` and return `gapInfo`. This feeds `scheduleNext(gapInfo)`
which picks the 3-minute far-recheck interval, starting the gap-monitoring loop
immediately after a publish instead of waiting 60 minutes.

Result: gap stays between threshold and threshold+2 under normal board activity.

## Gap Health Reference

| Gap value | Expected? | Meaning |
|-----------|-----------|---------|
| 0–threshold | Yes, briefly | Just published; monitoring for next opportunity |
| threshold (e.g. 4) | Yes | About to publish on next recheck |
| threshold+1 to +2 | Acceptable | Slight recheck timing overshoot |
| threshold+3 to +5 | Warning | Recheck loop may be slow or board activity is very high |
| threshold+6 or more | Critical | Scheduler likely stalled post-publish; check `running` flag and server health |

## Prevention

- `GapStatusBar` added to Controls page: color-coded red/amber/green based on excess gap
- `GET /api/control-panel` now returns `lastObserverResult` with `currentGap`, `requiredGap`, `checkedAt`
- AGENTS.md "Gap Health" section documents these thresholds for future agents

## Lessons Learned

- **"SAFE" is counterintuitive.** SAFE means *safe to publish right now* — it is NOT a
  system health indicator. A gap of 14 with threshold 4 is not "the board is safe",
  it means "we are 10 posts overdue."
- **Agents without this context will misdiagnose.** Qwen Coder concluded the gap logic was
  "working correctly and intended behavior" because 14 >= 4 = SAFE. This is the wrong frame.
  Always ask: "Is the gap stable near threshold, or growing without bound?"
- **Check publisher history intervals, not just the latest entry.** A single SAFE log entry
  at 21:07 tells you nothing. The 60-minute gaps between entries tell you everything.
- **The gap-recheck loop existed but only ran in one direction.** Pre-publish: gap 0→threshold
  (frequent checks). Post-publish: gap 0→threshold again (should be frequent checks, was not).
  Asymmetric behavior in a loop is a common class of bug.
