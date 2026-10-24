---
status: active
---

# R2 Resolution Log — scheduler default reconciliation (SDU-004)

Spec: `r2-scheduling-decision-unification-v1`. This log is the deliverable that
makes the behaviour change visible to review. Written before any edit.

## The default sets

The spec named four. Implementation found **six** — the enforcement guard in
`tests/unit/schedulerDefaults.test.ts` surfaced two the audit missed.

| # | Location | Role today |
|---|----------|------------|
| 1 | `lib/scheduler/run.ts:30-46` (`baseDefaults`) | Fallback for every field the persisted state omits. What a running scheduler uses. |
| 2 | `lib/state/scheduler.ts:16` (`DEFAULT_SCHEDULER_CONTROLS`) | Seeds `runtime-controls.json` on a **first boot with no persisted file**. Consumed only by `lib/state/store.ts:103-118`. |
| 3 | `lib/scheduler/presets.ts:14-35` (`PRESET_CONFIG.balanced`) | Applied when the operator selects or re-selects the default preset. |
| 4 | `routes/api/control.ts:316` (inline literal) | Fallback body on the control-panel **POST** when `scheduler` is null (`DEV_SKIP_BOT=true`). |
| 5 | `routes/api/control.ts:96` (inline literal) | **Not in the spec.** The same fallback on the control-panel **GET**. Found by the SDU-006 guard. |
| 6 | `src/lib/controlPanel.ts:194` | **Not in the spec.** Frontend placeholder `ControlPanelState` shown before the first API response. Found by the SDU-006 guard. |

## Where they disagree

Set 2 is the sole outlier on every conflicting field. Sets 1, 3 and 4 agree.

| Field | 1 `run.ts` | 2 `state/scheduler.ts` | 3 `presets.balanced` | 4 `control.ts` | Live prod |
|---|---|---|---|---|---|
| `quietHoursStart` | 3 | **0** | 3 | 3 | 3 |
| `quietHoursEnd` | 5 | **6** | 5 | 5 | 5 |
| `quietHoursMultiplier` | 1.8 | **2.0** | 1.8 | 1.8 | 1.8 |
| `activeHoursStart` | 8 | **9** | 8 | 8 | 8 |
| `activeHoursEnd` | 23 | **22** | 23 | 23 | 23 |
| `activeHoursMultiplier` | 0.8 | **1.0** | 0.8 | 0.8 | 0.8 |
| `trendRecalibrationDays` | 7 | **3** | 7 | 7 | 7 |
| `targetPublishIntervalMinutes` | 0 | **120** | 0 | 0 | 0 |
| `baseIntervalMinutes` | `ENV.RUN_INTERVAL_MINUTES` | **60 (literal)** | `ENV.RUN_INTERVAL_MINUTES` | `ENV.RUN_INTERVAL_MINUTES` | 60 |
| `scheduleJitterPercent` | `ENV.SCHEDULER_JITTER_PERCENT` | **10 (literal)** | `ENV.…` | `ENV.…` | 15 |
| `scheduleJitterMode` | `ENV.SCHEDULER_JITTER_MODE` | `'uniform'` (literal) | `ENV.…` | `ENV.…` | `uniform` |
| `gapRecheckIntervalMinutes` | 3 | 3 | **absent** | 3 | 3 |
| `enabled` | true | true | **absent** | true | true |

"Live prod" read from `runtime-controls.json` inside `marketing-automation-app-1`
on 2026-09-06.

## Decisions

**Rule applied: adopt the set-1 / set-3 / set-4 value for every conflicting
field.** Rationale below is per-field, but the shared reason is that the
outlier set has never governed this deployment. Set 2 only fires on a first
boot with no `runtime-controls.json`; this install has had one since before the
divergence, so its literals have never reached the scheduler. Adopting them now
would be an unreviewed behaviour change dressed as a merge.

| Field | Chosen | Reason |
|---|---|---|
| `quietHoursStart` | `3` | Set-2's `0` widens quiet hours from 3h to 6h, halving overnight publish rate. Not a defensible silent change; 3 matches live and both other sets. |
| `quietHoursEnd` | `5` | Same window, same reason. |
| `quietHoursMultiplier` | `1.8` | Set-2's `2.0` slows quiet hours a further 11%. No evidence favours it; 1.8 is what the observed post cadence was calibrated against. |
| `activeHoursStart` | `8` | 8 matches live and presets. Set-2's `9` shortens the active window by an hour at the front. |
| `activeHoursEnd` | `23` | Same, at the back. |
| `activeHoursMultiplier` | `0.8` | **Most consequential.** Set-2's `1.0` disables the active-hours speed-up entirely, making the dial inert. Keeping `0.8` preserves the intended behaviour and matches live. |
| `trendAdaptiveEnabled` | `true` | No conflict. |
| `trendWindowDays` | `7` | No conflict. |
| `trendRecalibrationDays` | `7` | Set-2's `3` recalibrates the trend factor 2.3x more often, i.e. more browser-free analytics work but a twitchier multiplier. 7 matches live and both other sets. |
| `baseIntervalMinutes` | `ENV.RUN_INTERVAL_MINUTES` | Must stay env-derived. A `60` literal silently ignores the documented `RUN_INTERVAL_MINUTES` var on first boot — an env-discipline violation per `AGENTS.md`. Same default value (60) either way. |
| `scheduleJitterPercent` | `ENV.SCHEDULER_JITTER_PERCENT` | Same reason. Note the literal `10` also *disagrees with the env default of 15*, so set 2 was already drifting from `config/env.ts`. |
| `scheduleJitterMode` | `ENV.SCHEDULER_JITTER_MODE` | Same reason; values happen to coincide (`uniform`). |
| `targetPublishIntervalMinutes` | `0` | **Behaviourally largest.** `0` disables the blend in `computeEffectiveIntervalMinutes`; `120` pulls every adaptive interval halfway to 2 hours, roughly halving publish frequency. Live is `0`. Changing this is a rate decision for the operator, not a merge artefact. |
| `gapRecheckIntervalMinutes` | `3` | Sets 1/2/4 agree; set 3 omits it, which is the SDU-005 totality bug. Now declared. |
| `enabled` | `true` | Sets 1/2/4 agree; set 3 omits it. Now declared. |
| `preset` | `'balanced'` | Only set 2 carries it. Kept on the state-layer type, not on `AutoPublisherControls`. |

## Net behaviour change

**On this deployment: none.** Every chosen value equals the live persisted
value, and persisted state takes precedence over defaults regardless.

**On a fresh install with no `runtime-controls.json`: yes, and deliberately.**
The seeded controls change from set 2 to the reconciled set — most visibly
`targetPublishIntervalMinutes` 120 -> 0 and `activeHoursMultiplier` 1.0 -> 0.8,
so a new install now paces like this one instead of ~2x slower with the
active-hours dial inert. That is the intended correction: a fresh install
should boot into the configuration the running system was tuned to.

## The two sets the spec did not name

**Set 5 (`routes/api/control.ts:96`)** is server code and was collapsed into the
single source like the rest. It had not drifted — its values matched set 1.

**Set 6 (`src/lib/controlPanel.ts:194`)** is browser code. It cannot import the
single source: `lib/scheduler/defaults.ts` reads `config/env.ts`, and pulling
server env parsing into the Vite bundle to deduplicate a placeholder is a worse
trade than the duplication. Its values already agree with the reconciled set
(and its `scheduleJitterPercent: 15` matches the env default that set 2's `10`
had drifted from). It is therefore **allowlisted in the guard and pinned by
value**: `tests/unit/schedulerDefaults.test.ts` asserts each literal in that file
still equals the corresponding server default, so a future change to either side
fails the suite. Removing the duplication properly means giving the frontend a
defaults endpoint or a generated constants file — worth doing, out of scope here.

## Out of scope

Moving ownership of these controls into `RuntimeStateStore` is R3. This log
records the reconciled values so R3 cannot re-diverge them without saying so.
