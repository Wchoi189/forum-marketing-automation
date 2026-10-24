---
title: Config Authority Audit — who decides when we publish
status: active
initiative_id: publisher-modernization
created: 2026-09-05
---

# Config Authority Audit

The operator's report: *"the configurations for the auto publishing feature has
tons of conflicting settings and it's not easy to track."* This document is the
evidence for that, and the reason it is a design problem rather than a tidying
problem.

## The question the system cannot answer

> "It is 14:00. When does the publisher next attempt a post, and why?"

Answering it today requires reading seven files and knowing which one won.

## The seven authorities

| # | Authority | Location | What it decides | Wins when |
| :-- | :--- | :--- | :--- | :--- |
| 1 | Env defaults | `config/env.ts` (`RUN_INTERVAL_MINUTES`, `SCHEDULER_JITTER_*`, `OBSERVER_GAP_THRESHOLD`) | Seed values, captured at **module load** into `presets.ts` | Nothing else set |
| 2 | `DEFAULT_SCHEDULER_CONTROLS` | `lib/state/scheduler.ts:16` | Store's default state | Store hydrates before scheduler starts — **in practice, this one wins** |
| 3 | `baseDefaults` | `lib/scheduler/run.ts:28` | Scheduler closure defaults | Only for fields absent from persisted state |
| 4 | `PRESET_CONFIG` | `lib/scheduler/presets.ts:14` | Preset bundles (3 × 14 fields) | Operator picks a preset |
| 5 | `runtime-controls.json` | `ARTIFACTS_DIR` | Persisted operator choices | Present on disk |
| 6 | Route fallback literal | `routes/api/control.ts:316` | Values persisted when `scheduler === undefined` | `DEV_SKIP_BOT=true` |
| 7 | Hardcoded constants | see below | Overrides everything at runtime | Any non-`normal` outcome |

### Authority 7 in detail — the constants that actually govern production

| Constant | Location | Value | Overrides |
| :--- | :--- | ---: | :--- |
| `gapRecheckIntervalMinutes` branch | `run.ts:253` | 3 min | every adaptive setting, after success *and* gap-skip |
| `ERROR_BACKOFF_MINUTES` | `run.ts:142` | 15/30/60 | base interval, on any error |
| `COOLDOWN_WINDOW_MS` | `publisherRun.ts:268` | 60 min | everything; **not** env-configurable |
| maintenance `FALLBACK_MS` | `boardDiagnostics.ts:172` | 30 min | everything |
| maintenance `BUFFER_MS` | `boardDiagnostics.ts:170` | 5 min | — |
| cooldown buffer | `run.ts:245` | +1 min | — |
| `STARTUP_TICK_DELAY_MS` | `run.ts:311` | 10s / 30s dev | first tick |

Per F-06, **authority 7 is the only one that runs in steady state.** Authorities
1–6 govern a code path (`'normal'`) that a healthy system essentially never
reaches. The control panel is a facade over a fixed-interval machine.

## The conflict, concretely

Same field, three declared defaults, different values — see the table in
[01-assessment.md](01-assessment.md) F-03. The sharpest one:

```
lib/state/scheduler.ts:31        targetPublishIntervalMinutes: 120
lib/scheduler/run.ts:41          targetPublishIntervalMinutes: 0
lib/scheduler/presets.ts:31      targetPublishIntervalMinutes: 0
```

and its consumer:

```ts
// run.ts:135
if (controls.targetPublishIntervalMinutes > 0) {
  effective = clamp(Math.round(effective * 0.5 + t * 0.5), 1, 1440);
}
```

`0` disables the blend; `120` pulls every interval halfway to two hours. A fresh
box and a box with a `runtime-controls.json` therefore pace differently, with no
log line explaining the divergence.

## The gap-threshold sub-chain

Publish/skip is gated separately, by its own four-layer chain
(`lib/observer/policyLoader.ts`):

```
spec contract baseline  →  OBSERVER_GAP_THRESHOLD env (read via raw process.env, :163)
                        →  persisted gapPersistedOverride
                        →  gapSourcePin ('env' | 'spec')
```

`gapSourcePin` exists to resolve a conflict between the two layers above it —
a pin whose only purpose is to arbitrate an ambiguity that should not have been
created. Symptomatic of the whole surface.

## Why this compounds

Each phase of the modernization added a *correct local* decision point without
removing one:

- Phase 2 added the cooldown gate and the `rate_limited` scheduling branch.
- Phase 3 added the maintenance gate and the `system_maintenance` branch.
- Phase 4 added a store that mirrors, but does not own, the scheduler's values.

Three new authorities, zero retired. The next feature will add a fourth, and the
question at the top of this document gets one file harder to answer. **That is
the compounding the operator noticed.** It is not fixed by renaming or
documenting; it is fixed by making one component own the decision and forcing
the others to ask it (R2 in [03-remediation-plan.md](03-remediation-plan.md)).

## Target state, one sentence

> One function, `nextAttemptAt(now, state) -> { at, reason }`, is the only code
> in the system that decides when the publisher next runs; every other module
> either supplies input to it or reads its output.

Everything in the remediation plan is in service of that sentence.
