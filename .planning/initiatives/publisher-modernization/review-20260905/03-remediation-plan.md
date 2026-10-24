---
title: Remediation Plan R1–R5
status: proposed
initiative_id: publisher-modernization
created: 2026-09-05
---

# Remediation Plan

Five increments. Each is independently shippable, independently revertable, and
ordered so that operational bleeding stops before architecture is touched. **No
phase requires undoing Phase 1–4 work.**

Sequencing rule: do not start R2 until R1 has run in production for at least one
full day and the run log shows the expected shape (one publish, one long wait,
no post-success failure entry).

---

## R1 — Stop the bleeding (S1 fixes, no structural change)

Small, surgical, high confidence. Targets F-01, F-02, F-09.

1. **Move the cooldown gate ahead of the observer.** `publisherRun.ts` — relocate
   the `publishBlockedUntil` check and the STAB-001 history gate (`:230-300`) to
   sit beside the maintenance gate, *before* `log = await runObserver()` at
   `:185`. The maintenance gate already has the right shape; make the rate-limit
   gate match it.
   Cost: one block move. Effect: no browser launch during a known cooldown.

2. **Split `success` out of the `gap_skip` branch.** `run.ts:253` — on `success`,
   schedule `COOLDOWN_MINUTES + 1` (the value is known locally; no I/O). Keep
   `gap_skip → gapRecheckIntervalMinutes`.

3. **Make a pending block deadline non-shortenable.** In `scheduleNext`, after
   computing `nextMinutes`, clamp:
   `nextAt = max(now + nextMinutes, publishBlockedUntil, maintenanceBlockedUntil)`.
   This neutralises the F-02 override trap at one site instead of policing three
   setters.

4. **Add an `already_running` decision** to `PublisherRunDecision`; return it from
   the `publisherRun.ts:483` guard; in the scheduler treat it as "retry in 1
   minute, do not touch `consecutiveFailures`."

**Tests to add (these are the ones currently missing):**
- publisher run with `publishBlockedUntil` in the future calls `runObserver`
  **zero** times (inject a spy — this is the F-01 regression guard);
- `scheduler.setControls({})` during an active cooldown does not move
  `nextTickEta` earlier;
- `success` outcome schedules ≈61 min, not 3.

Delete or rewrite the two tautological tests in `publisherCooldown.test.ts` —
they cover nothing and inflate the count.

---

## R2 — One scheduling decision function (the core architectural fix)

Targets F-03, F-06, and the audit's target sentence.

Extract a **pure** module, `lib/scheduler/nextAttempt.ts`:

```ts
export type AttemptReason =
  | 'cooldown' | 'maintenance' | 'error_backoff'
  | 'gap_recheck' | 'adaptive' | 'already_running';

export function nextAttemptAt(input: {
  now: number;
  lastOutcome: SchedulerTickOutcome;
  blocks: { publishBlockedUntil: string | null; maintenanceBlockedUntil: string | null };
  controls: AutoPublisherControls;
  multipliers: { trend: number; sov: number; opportunity: number };
}): { at: number; reason: AttemptReason; inputsUsed: string[] };
```

Properties that make this worth doing:

- **Pure and total** — no clock reads, no I/O, no closure state. Fully testable
  as a table: outcome × block state × controls → expected `{at, reason}`.
- **`inputsUsed` is the answer to the audit's question.** Log it on every
  schedule. The run log then states *which* settings produced the decision,
  which is what "not easy to track" is asking for.
- `scheduleNext` becomes: call it, clamp, `setTimeout`, log. The adaptive
  multipliers become *inputs* rather than a branch that never executes — which
  is how F-06 gets resolved without deleting the analytics work.

**Collapse the defaults in the same change.** One exported
`DEFAULT_SCHEDULER_CONTROLS`, in `lib/scheduler/`, imported by
`lib/state/scheduler.ts`, `run.ts`, `presets.ts`, and `routes/api/control.ts`.
Delete the other three copies (F-03). Presets become sparse *deltas* over that
single default, and must declare every field they intend to control.

Add a `lint:structure` rule or a unit test asserting no second literal default
set exists — otherwise this regresses on the next feature.

---

## R3 — Settle the state authority question

Targets F-04. Pick **one**, do not keep both:

- **Option A (recommended): store owns, scheduler reads.** The scheduler stops
  holding `controls` in its closure and reads
  `getRuntimeStateStore().getSchedulerControls()` at the top of each tick.
  `routes/api/control.ts` writes only to the store and stops calling
  `scheduler.setControls`. `scheduler.getState()` becomes a thin projection.
  This is what Phase 4 said it did, and it removes the entire read-back-then-persist
  dance at `control.ts:304-345`.
- **Option B: scheduler owns, store drops the mirror.** Cheaper, but leaves
  scheduler settings unpersisted across restart. Only viable if that is
  acceptable, which it is not.

Independent of the choice, in `store.ts`:

- delete `setPublisherControlsInMemory`'s bypass (`:236`) — route it through
  `patch()` so version, listeners, and persistence stay coherent;
- stop swallowing persist failures with `.catch(() => null)` at the
  `persistPublishBlockedUntil` / `persistMaintenanceBlockedUntil` call sites —
  log at `error` with the event name, so a divergence is visible;
- guard `init()` with the `initialized` flag and fix the `server.ts:172-175`
  double-init.

---

## R4 — Make maintenance detection require corroboration

Targets F-05.

- `parseMaintenanceNotice` gains a required `signals` argument
  (`rowCount`, `writeButtonCount`).
- Decision becomes: `statusCode ∈ {502,503,504}` **OR**
  (`keyword` **AND** `rowCount === 0` **AND** `writeButtonCount === 0`).
- Time-range parsing is scoped to the **matched notice line**, not the whole
  `body.innerText`.
- Parsed window is capped (suggest 6h); anything longer falls back to the 30m
  default and logs a warning with the raw notice.
- Expired `maintenanceBlockedUntil` / `publishBlockedUntil` are cleared on read.

**Test:** a realistic HTTP-200 board fixture whose post titles contain `점검`
and a `10:00 ~ 18:00` string must yield `isMaintenance === false`. That fixture
is the regression guard, and it is worth capturing from a real board page.

---

## R5 — Close the doc-drift loop

Targets F-07, F-10, F-11.

- Rewrite the `CLAUDE.md` Code Map and API Surface against the current tree
  (`bot.ts`, `lib/publisherStepStore.ts`, `lib/publisherHistory.ts`,
  `src/AnalyticsPage.tsx` are all gone; `rate_limited` / `system_maintenance`
  decisions and `POST /api/nl-command` are undocumented).
- Extend `scripts/check-structure.ts` to fail when a path named in `CLAUDE.md`'s
  Code Map does not exist. This is the cheapest possible enforcement and it makes
  the class of drift structurally impossible to reintroduce.
- Record `gap_policy` outcomes to publisher history (F-07) so
  `schedulerSignals.gapRecheckCount` stops being structurally zero — or, if the
  volume is unacceptable, delete the `gap_policy` branch in
  `schedulerSignals.ts:143` and say so. Either is fine; the current state, where
  a reader consumes something no writer produces, is not.
- Move `process.env.OBSERVER_GAP_THRESHOLD` reads
  (`policyLoader.ts:163,194`) into `config/env.ts`.
- Collapse the duplicate `clamp` in `presets.ts:101`.
- Make `getState()` side-effect-free (F-08): move trend recalibration to an
  explicit tick-time call so dashboard polling stops driving it.

---

## What is explicitly *not* recommended

- **Do not revert Phases 1–4.** Phase 1 (dead-script pruning) and Phase 3
  (maintenance parsing, modulo F-05's corroboration gap) are net positives. Phase
  2's gates are correct in content and merely misplaced in order. Phase 4's store
  is a reasonable component that was wired up wrong. All four are salvageable in
  place.
- **Do not add more settings** until R2 lands. Every new knob added to the
  current surface makes the audit's question harder.
- **Do not chase the Obscura browser swap**
  (`research/04-browser-alternative-obscura-assessment.md`) before R1. Most of
  the current browser load is F-01's wasted launches, not Playwright overhead;
  measure again after R1 or the evaluation will be against inflated numbers.

## Suggested spec files

Each increment gets a spec in
`.planning/initiatives/publisher-modernization/specs/active/`, status `proposed`
until work starts:

| Spec | Covers |
| :--- | :--- |
| `r1-publisher-gate-ordering-v1.json` | F-01, F-02, F-09 |
| `r2-scheduling-decision-unification-v1.json` | F-03, F-06 |
| `r3-state-authority-resolution-v1.json` | F-04 |
| `r4-maintenance-corroboration-v1.json` | F-05 |
| `r5-doc-and-contract-drift-v1.json` | F-07, F-08, F-10, F-11 |
