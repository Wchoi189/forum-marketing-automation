---
id: KE-003
date: 2026-08-10
title: Three readers of activity_log.json disagree about which end is newest
severity: low
status: latent
components:
  - lib/observer/observerRun.ts
  - lib/logCache.ts
  - lib/resourceMonitor.ts
  - routes/api/logs.ts
fix_commit: none - recorded during the item 5 review of routes/api/logs.ts
---

## Symptoms

None today. Every consequence below is currently masked by a size coincidence,
which is exactly why this is written down rather than left to be rediscovered.

## Root Cause

`lib/observer/observerRun.ts` writes activity_log.json **newest-first**:

```ts
logs.unshift(log);
await fs.writeFile(LOG_FILE, JSON.stringify(logs.slice(0, KEEP_ACTIVITY_LOG_ENTRIES), null, 2));
```

`slice(0, N)` on a newest-first array keeps the newest N. That is correct, and
`lib/analytics/boardStats.ts` agrees with it — `logs[0]` is the latest snapshot.

Three other readers take the array from the other end:

| Site | Code | What it means on newest-first data |
|---|---|---|
| `lib/logCache.ts` | `parsed.slice(-this.maxEntries)` | keeps the **oldest** 500 |
| `lib/resourceMonitor.ts` `rotateActivityLog` | `entries.slice(-keepEntries)` | keeps the **oldest** 500, deleting the newest |
| `routes/api/logs.ts` `/api/logs` | `allLogs.slice(-limit)` | returns the **oldest** N |

The same route then reports `oldestTimestamp: logs[0].timestamp`, which on
newest-first data is the newest timestamp in the slice. `hasMore` is computed
against the same reversed assumption.

## Why nothing is broken right now

Three different caps, and the smallest one wins:

- `observerRun.ts` has its own local `KEEP_ACTIVITY_LOG_ENTRIES = 200` and
  rewrites the whole file every run, so the file never exceeds 200 entries.
- `lib/resourceMonitor.ts` exports `KEEP_ACTIVITY_LOG_ENTRIES = 500` and
  `MAX_ACTIVITY_LOG_ENTRIES = 1000`. `rotateActivityLog` only acts above 1000,
  so it never runs.
- `LogCache` defaults `maxEntries` to the exported 500. `slice(-500)` of a
  200-element array is the whole array.
- `src/hooks/useAppData.ts` requests `?limit=200`. `slice(-200)` of a
  200-element array is the whole array.

So each wrong-direction slice is a no-op, and `oldestTimestamp` / `hasMore`
happen to be unread by the frontend.

## What would surface it

Any one of: raising the observer's local cap, lowering the dashboard's
`limit` below the file size, another writer appending to the file, or a
consumer starting to read `oldestTimestamp`. The first would make
`rotateActivityLog` delete the most recent snapshots — the only variant with
data loss.

## Lessons

Two constants named `KEEP_ACTIVITY_LOG_ENTRIES` in two modules, with different
values, is the actual defect; the slice directions are downstream of nobody
being able to see the order in one place. A fix should give the file one
declared order and one retention constant, then make the readers agree with it.
