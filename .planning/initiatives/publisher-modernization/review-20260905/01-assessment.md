---
title: Findings — publisher-architecture-modernization-v1
status: active
initiative_id: publisher-modernization
created: 2026-09-05
---

# Findings

Severity: **S1** production-affecting now · **S2** latent, will bite ·
**S3** architectural debt / maintenance burden · **S4** hygiene.

---

## F-01 · S1 · Every successful publish schedules a guaranteed-wasted browser run 3 minutes later

`lib/scheduler/run.ts:253`

```ts
} else if (outcome.type === 'gap_skip' || outcome.type === 'success') {
  baseMinutes = controls.gapRecheckIntervalMinutes;   // default 3
```

`success` and `gap_skip` share a branch. After a *verified publish*, the next
tick fires in 3 minutes. That tick runs
`publisherRun.ts:185 → runObserver()`, which launches Chromium
(`lib/observer/observerRun.ts:119`), scrapes the board, and only then reaches the
60-minute cooldown gate at `publisherRun.ts:262`, which returns `rate_limited`.

So the platform's 1-post/hour ceiling is rediscovered **by browsing the site**,
three minutes after we already knew we had posted. This is:

- a full Playwright launch on a 512MB VPS for zero information gain,
- a bot-detectable access pattern (post, then hit the board 3 minutes later, every time),
- and the reason a run log shows a failure immediately after every success.

Phase 2's headline was "eliminate the 5-minute retry storm." The storm was
reduced from *N* spins to exactly one spin per publish — the ordering defect
underneath it was never addressed.

**Fix direction:** the cheap, purely-local cooldown check must run *first*, before
`runObserver()`. The maintenance gate already does this correctly
(`publisherRun.ts` ~L155, before the observer call) — the rate-limit gate simply
was not moved to match. Additionally `success` must not reuse the `gap_skip`
interval; it should schedule `cooldownRemaining + 1`, which is known without any
network access.

---

## F-02 · S1 · Saving the control panel cancels an active cooldown or maintenance pause

`lib/scheduler/run.ts:358, 365, 374` — `setIntervalMinutes`, `setControls`, and
`applyPreset` all end with:

```ts
void scheduleNext(false);
```

`scheduleNext(false)` takes the `else` branch and reschedules at the **normal
adaptive interval**, after `clearTimeout(timer)` has discarded the pending one.

`routes/api/control.ts:304-312` calls `scheduler.setControls(...)` on **every**
`POST /api/control-panel`, whether or not a scheduling field changed.

Consequence: an operator (or the AI advisor at `routes/api/ai.ts:89`, or the NL
webhook at `routes/api/nl.ts:104,126`) touching *any* control-panel field during a
rate-limit cooldown or a maintenance pause silently converts a 46-minute wait into
a ~30-minute one. The `publishBlockedUntil` gate in `publisherRun.ts` then catches
it and returns `rate_limited` again — costing another full observer browser run
(see F-01).

This is precisely the "override trap" that
`research/03-publisher-architecture-assessment.md` flagged before the initiative
began. It survived all four phases.

**Fix direction:** the pending-tick deadline is state, not a side effect of a
setter. `scheduleNext` must never shorten an active `publishBlockedUntil` /
`maintenanceBlockedUntil` deadline — take `max(newSchedule, activeBlockUntil)`.

---

## F-03 · S1 · Three divergent default sets for the same fields

The same 15 scheduler settings are defaulted in three places with **different
values**:

| Field | `lib/state/scheduler.ts:16` | `lib/scheduler/run.ts:28` | `presets.ts` `balanced` |
| :--- | ---: | ---: | ---: |
| `quietHoursStart` | 0 | 3 | 3 |
| `quietHoursEnd` | 6 | 5 | 5 |
| `quietHoursMultiplier` | 2.0 | 1.8 | 1.8 |
| `activeHoursStart` | 9 | 8 | 8 |
| `activeHoursEnd` | 22 | 23 | 23 |
| `activeHoursMultiplier` | 1.0 | 0.8 | 0.8 |
| `trendRecalibrationDays` | 3 | 7 | 7 |
| `scheduleJitterPercent` | 10 | `ENV` | `ENV` |
| `targetPublishIntervalMinutes` | **120** | **0** | **0** |

A fourth, again different, set is hardcoded as a fallback literal at
`routes/api/control.ts:316-322`.

`targetPublishIntervalMinutes` is not cosmetic: `run.ts:135` blends it
50/50 into the effective interval, so `120` vs `0` is a ~2× difference in pacing.
Which one wins depends on whether `runtime-controls.json` exists on the box, and
on which module the reader happens to open. **This is the operator's "conflicting
settings" complaint, literally.**

Full authority map: [02-config-authority-audit.md](02-config-authority-audit.md).

---

## F-04 · S2 · Phase 4's "single authoritative store" is not the authority for scheduler state

Phase 4 shipped `RuntimeStateStore` as "the single in-memory source of truth."
For scheduler settings it is a **write-behind mirror**, not an authority:

`routes/api/control.ts:304-345` — mutate the scheduler closure first, read the
closure back with `await scheduler.getState()`, then persist *those* values into
the store. The store never informs the scheduler of anything; `store.subscribe()`
has no scheduler subscriber anywhere in the codebase.

Two further breaks in the same module:

- **`setPublisherControlsInMemory` (`store.ts:236`) bypasses the authority
  mechanism entirely** — no `stateVersion` bump, no listener notification, no
  persistence. Callers must remember to *also* call `persistPublishBlockedUntil`,
  which re-applies the same patch through `patch()`. Both call sites do
  (`publisherRun.ts`, `observerRun.ts:135-136`) — and both swallow the persist
  failure with `.catch(() => null)`, so a disk error leaves memory and disk
  permanently disagreeing with no signal.
- **Optimistic concurrency is decorative.** `patch(patch, expectedVersion)`
  implements version checking, but every internal caller passes `undefined`. Only
  the HTTP route supplies a version. The `StateVersionConflictError` machinery
  guards one path out of many.

**Fix direction:** either the scheduler reads its controls from the store on each
tick (store becomes real authority), or the scheduler is acknowledged as the
owner and the store stops mirroring it. Today's arrangement pays the cost of both
and gets the guarantees of neither.

---

## F-05 · S2 · Maintenance detection can pause the whole system on a healthy board

`lib/observer/boardDiagnostics.ts:82`

```ts
if (!isStatusCodeMaintenance && !hasKeyword) { ... not maintenance ... }
```

A bare keyword hit is sufficient — **HTTP 200 with a full board of rows still
trips it**. The keyword list includes `'점검중'` (`:45`), an unanchored substring
scanned against `page.innerText('body')` of a *deals board*, i.e. ~20 lines of
user-submitted post titles. On Ppomppu, "점검" (inspection) is ordinary
commercial vocabulary.

The blast radius is then widened by the time parser: once `isMaintenance` is
true, `timeRangeRegex` (`:144`) matches any `HH:MM ~ HH:MM` / `N시 ~ M시` anywhere
in that same body text — and board rows and deal titles are full of times. A
single unlucky title can set `maintenanceBlockedUntil` up to ~24 hours out, which
is then persisted to disk and survives restart.

The observer already has the disambiguating signal in hand — `rowCount` — and
does not use it.

**Fix direction:** require corroboration. Maintenance = status code in
{502,503,504} **OR** (keyword **AND** `rowCount === 0` **AND** `writeButtonCount === 0`).
Scope the time-range parse to the matched notice line, not the whole body. Cap
the parsed window at a sane maximum (e.g. 6h).

---

## F-06 · S2 · The scheduler's adaptive machinery is unreachable in normal operation

`computeEffectiveIntervalMinutes` — quiet/active hours, trend multiplier, SoV
multiplier, opportunity-signal multiplier, jitter — is only reached from the
`'normal'` branch of `scheduleNext` (`run.ts:258`). Every real tick outcome
routes elsewhere: `success` and `gap_skip` → fixed 3 min (F-01), `rate_limited` →
cooldown, `system_maintenance` → window, `unexpected_error` → `[15,30,60]`.

`'normal'` is reachable only for a decision the switch does not recognise, or
from a `setControls` call (F-02). So ~200 lines of analytics
(`lib/analytics/trends.ts`, `schedulerSignals.ts`) and every quiet-hours /
jitter / trend setting on the control panel are, in steady state, **inert**.

This is the deepest architectural finding: the system presents a rich adaptive
scheduler to the operator, and runs a fixed-interval state machine. Anyone tuning
those dials is tuning nothing, which is exactly how a config surface becomes
untrackable.

---

## F-07 · S2 · `gap_policy` outcomes are never written to history, so the signal analytics are blind

`lib/publisher/publisherRun.ts:116` — `recordPublisherRun` is skipped when
`decision === 'gap_policy'`.

`lib/analytics/schedulerSignals.ts:143` — classifies `gap_policy` entries and
derives `gapRecheckCount` from them.

The writer never produces what the reader is built to consume.
`gapRecheckCount` is structurally always `0`, and `opportunityScore` — which
feeds a multiplier back into the scheduler (`run.ts:93-99`) — is computed from a
systematically truncated sample. Two modules agree on a contract that nothing
fulfils.

---

## F-08 · S3 · `getState()` is not a getter — it mutates trend calibration, and the dashboard drives it

`run.ts:376` `getState()` → `computeEffectiveIntervalMinutes()` →
`recalcTrendFactor()`, which writes `trendFactor` and `lastTrendRecalculatedAt`,
and issues `deps.getLogs()` + `deps.getPublisherHistory()`.

`GET /api/control-panel` calls `getState()`. So **dashboard polling determines
when the trend factor recalibrates**, and the `trendRecalibrationDays` setting is
enforced against a clock that a browser tab resets. Read paths must not carry
write semantics.

---

## F-09 · S3 · A benign concurrency skip is reported as `publisher_error`

`publisherRun.ts:483` — the "another run is already active" guard returns
`decision: 'publisher_error'`. The scheduler counts that as a failure
(`run.ts:172`), increments `consecutiveFailures`, and enters the `[15,30,60]`
error backoff. Reachable whenever a manual `POST /api/run-publisher` overlaps a
scheduler tick. Needs its own decision (`already_running`) that resets nothing
and backs off by seconds, not 15 minutes.

---

## F-10 · S3 · `CLAUDE.md` — the file loaded into every agent session — now describes a codebase that does not exist

Post-modernization, the Code Map still documents `bot.ts`,
`lib/publisherStepStore.ts`, `lib/publisherHistory.ts`, and
`src/AnalyticsPage.tsx`. All four are gone (moved to `lib/publisher/*`,
`src/pages/*`). The API Surface table omits `rate_limited` / `system_maintenance`
decisions and `POST /api/nl-command` entirely.

For a project whose stated concern is *maintenance burden over time*, a lying
map is the highest-leverage defect in this list. `lint:structure` enforces file
placement but nothing enforces `CLAUDE.md` accuracy.

---

## F-11 · S4 · Hygiene

- `lib/scheduler/presets.ts:101` reimplements `clamp` inline
  (`const { clamp } = { clamp: ... }`) while `lib/utils.js` exports it and
  `run.ts:8` already imports it.
- `PRESET_CONFIG` omits `gapRecheckIntervalMinutes` and `enabled`, so a preset
  does not fully determine behaviour — it inherits whatever the previous preset
  left behind.
- `server.ts:172-175` runs `readPersistedSchedulerControls()` (which calls
  `store.ensureInitialized()`) concurrently with `initRuntimeStateStore()` (which
  calls `store.init()` unguarded). Two overlapping disk reads and two
  `applyPatchInMemory` passes on startup. Benign today; it is the exact race class
  Phase 4 claimed to remove.
- The same block guards `initRuntimeStateStore()` behind `!skipBot` while the
  sibling call initialises the store unconditionally — the guard is dead and
  misleading.
- `lib/observer/policyLoader.ts:163,194` read `process.env.OBSERVER_GAP_THRESHOLD`
  directly, against `CLAUDE.md`'s "`config/env.ts` is the only place to read env".
- Expired `publishBlockedUntil` / `maintenanceBlockedUntil` are never cleared, so
  `runtime-controls.json` and the dashboard carry stale block timestamps
  indefinitely.
- `tests/unit/publisherCooldown.test.ts:49-70` — two tests assert their own
  inline arithmetic and import nothing from the module under test. They inflate
  the pass count without covering the F-01 gate.
