---
title: Kickoff — starting the R1–R5 remediation in a new session
status: active
initiative_id: publisher-modernization
created: 2026-09-05
---

# Kickoff

Specs live in
`.planning/initiatives/publisher-modernization/specs/active/`, status `proposed`.
Flip a spec to `active` when its session starts; move it to `specs/shipped/`
with status `shipped` when it lands (`lint:structure` enforces that the
directory and the status field agree).

## Order and gates

| Spec | Gate before starting |
| :--- | :--- |
| `r1-publisher-gate-ordering-v1` | none — start here |
| `r2-scheduling-decision-unification-v1` | R1 shipped **and** observed one full day in production |
| `r3-state-authority-resolution-v1` | R2 shipped |
| `r4-maintenance-corroboration-v1` | independent — pull forward if a false-positive pause is seen |
| `r5-doc-and-contract-drift-v1` | R1–R4 shipped |

R1 is deliberately small. Resist bundling R2 into it: the R1 regression guards
are what prove R2 did not undo the fix, and they need to exist first.

## Continuation prompt for the new session

Paste this verbatim.

```
Implement R1 of the publisher-modernization remediation.

Read first, in this order:
  1. .planning/initiatives/publisher-modernization/review-20260905/00-README.md
  2. .planning/initiatives/publisher-modernization/review-20260905/01-assessment.md (findings F-01, F-02, F-09)
  3. .planning/initiatives/publisher-modernization/specs/active/r1-publisher-gate-ordering-v1.json

Work the RTG-001 … RTG-005 items in order. Each work item lands with its
regression test before the next begins; do not batch RTG-001 and RTG-003 into
one commit.

Do not touch: computeEffectiveIntervalMinutes, the preset system, the default
value duplication, state ownership between the scheduler closure and
RuntimeStateStore, or maintenance detection. Those are R2/R3/R4 and are
explicitly out of scope for this session.

Gate before finishing: npm run lint:structure, npm run lint, npm run test:unit,
npm run build — all clean.

Then write a session handover to .agent/session-handovers/handover-YYYYMMDD-HHMM.json.
Name only files that exist and claims verified by a command whose output you
read. The handover for phases 1-4 named lib/publisher/cooldown.ts and
tests/unit/boardDiagnostics.test.ts, neither of which exists, and asserted a
Chromium-launch saving the code ordering did not deliver. Forward the
Constraints block below verbatim into that handover.

# Constraints
If context becomes saturated, stop immediately and provide a session handover and include a continuation prompt and instructions to stop if context becomes saturated.
```

## Note on handover discipline

Each spec's `session_boundary.handover_instructions` carries two fields the
existing template does not have:

- `constraints_to_forward_verbatim` — the Constraints block above, to be copied
  into every handover this initiative produces so the rule survives session
  boundaries rather than depending on the operator restating it.
- `honesty_requirement` — the review found the phase 1–4 handover named two
  files that do not exist and claimed a Chromium-launch saving the code ordering
  did not deliver. A handover is a map for the next session; a wrong map costs
  more than no map.
