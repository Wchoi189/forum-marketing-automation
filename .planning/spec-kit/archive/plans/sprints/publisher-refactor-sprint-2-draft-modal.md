# Sprint 2 - Draft Modal Isolation

Epic: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/epics/publisher-refactor-epic.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/epics/publisher-refactor-epic.md)
Roadmap: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/roadmaps/publisher-refactor-roadmap.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/roadmaps/publisher-refactor-roadmap.md)

## Tracking
Authoritative checklist: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/tasks/publisher-refactor-phase-2-draft-modal-tasks.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/tasks/publisher-refactor-phase-2-draft-modal-tasks.md)

This sprint file captures scope only; update status in the task checklist.

## Goal
Isolate `confirm-load-draft-modal` behavior into a dedicated UI module while preserving deterministic modal behavior.

## In Scope
- Move draft row selection behavior to `lib/publisher/ui/draftModal.ts`.
- Preserve preview load/confirm behavior and freeze-clear checks.
- Preserve fail-closed behavior on unresolved modal states.

## Out of Scope
- Submit/redirect verification logic changes.
- Broader flow orchestration refactors.

## Deliverables
- `draftModal` module with clearly named helper functions.
- Existing integration path wired through extracted module.
- Explicit postconditions for modal lifecycle checkpoints.

## Acceptance
- `npm run lint` passes.
- `npm run test:integration` passes.
- Real publisher run confirms deterministic draft load and modal exit behavior.

## Exit Criteria
- Modal lifecycle is readable as explicit checkpoints, not implicit side effects.
- Ambiguous modal states still fail closed.
