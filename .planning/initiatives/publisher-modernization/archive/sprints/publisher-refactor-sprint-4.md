# Sprint 4 - Flow Composition and Thin Orchestrator

Epic: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/epics/publisher-refactor-epic.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/epics/publisher-refactor-epic.md)
Roadmap: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/roadmaps/publisher-refactor-roadmap.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/roadmaps/publisher-refactor-roadmap.md)

## Tracking
Authoritative checklist: [`/parent/marketing-automation/.planning/spec-kit/archive/plans/tasks/publisher-refactor-phase-4-flow-orchestrator-tasks.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/tasks/publisher-refactor-phase-4-flow-orchestrator-tasks.md)

This sprint file captures scope only; update status in the task checklist.

## Goal
Compose extracted modules into a dedicated publisher flow runner and reduce `bot.ts` publisher path to orchestration and policy wiring.

## In Scope
- Add `lib/publisher/flow/runPublisherFlow.ts`.
- Add transition checkpoint helpers in `lib/publisher/flow/stateTransitions.ts` if needed.
- Move step orchestration out of `bot.ts` while keeping artifact and policy behavior intact.

## Out of Scope
- Contract-level API shape changes.
- New publisher features.

## Deliverables
- Flow runner composed from core/ui modules.
- Thin `bot.ts` publisher entry path.
- Stable return/error behavior parity.

## Acceptance
- `npm run lint` passes.
- `npm run test:integration` passes.
- Real run confirms artifact capture and publisher response behavior remain unchanged.

## Exit Criteria
- `bot.ts` no longer owns low-level flow details.
- Publisher output contract remains compatible with existing consumers.
