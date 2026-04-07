# Publisher Refactor Constraints Checklist

Source epic: [`/parent/marketing-automation/.planning/spec-kit/plans/epics/publisher-refactor-epic.md`](/parent/marketing-automation/.planning/spec-kit/plans/epics/publisher-refactor-epic.md)

## Hard Guardrails (Do Not Violate)
- Keep publisher behavior fail-closed for ambiguous UI states.
- Require post-submit URL verification to board list/view (not write/write_ok).
- Keep waits bounded by policy; avoid unbounded retries.
- Preserve debug artifact capture used for triage.

## Phase-by-Phase Invariants
- **Phase 1 (Foundations):** extraction-only changes; no behavioral changes.
- **Phase 2 (Draft modal):** preserve row select, preview load/confirm, freeze-clear checks, and unresolved-state failure.
- **Phase 3 (Submit):** preserve submit trigger, redirect verification, and bounded waits.
- **Phase 4 (Flow/orchestrator):** keep API return shape and publisher policy/artifact behavior unchanged.
- **Phase 5 (Optional hardening):** expand tests/diagnostics only after baseline refactor is stable.

## Non-Goals (Across All Phases)
- No playbook contract redesign.
- No environment model redesign unless explicitly required.
- No semantic behavior expansion beyond current publisher behavior.

## Verification Baseline (Every Phase)
- Run `npm run lint`.
- Run `npm run test:integration`.
- For flow-internal changes, execute at least one real publisher run.
- Confirm no regression in draft load, modal freeze clear, submit trigger, and success URL verification.

## Delivery Strategy
- Use "move first, simplify second" to prevent hidden behavior drift.
- Keep each phase independently deployable.
- Prefer small, phase-scoped commits/PRs.
