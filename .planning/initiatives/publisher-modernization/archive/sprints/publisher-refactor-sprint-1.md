# Sprint 1 - Publisher Foundations Extraction

Epic: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/epics/publisher-refactor-epic.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/epics/publisher-refactor-epic.md)
Roadmap: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/roadmaps/publisher-refactor-roadmap.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/roadmaps/publisher-refactor-roadmap.md)

## Tracking
Authoritative checklist: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/tasks/publisher-refactor-phase-1-foundations-tasks.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/tasks/publisher-refactor-phase-1-foundations-tasks.md)

This sprint file captures scope only; update status in the task checklist.

## Goal
Extract reusable foundations from publisher runtime code without changing behavior.

## In Scope
- Extract shared timeout policy into `lib/publisher/core/timeouts.ts`.
- Extract selector candidate resolution/actionability utilities into `lib/publisher/ui/selectorResolver.ts`.
- Keep existing call paths intact while rerouting through extracted utilities.

## Out of Scope
- Flow logic rewrites.
- Submit semantics changes.
- Playbook/schema/env contract updates.

## Deliverables
- New foundation modules with parity behavior.
- Minimal wiring changes in existing runtime files to consume extracted modules.
- Notes on any preserved edge-case selector logic.

## Acceptance
- `npm run lint` passes.
- `npm run test:integration` passes.
- No visible change in publish success/failure semantics.

## Exit Criteria
- Reviewer can diff extracted logic and confirm move-first behavior parity.
- No fail-closed guardrail regressions are observed.
