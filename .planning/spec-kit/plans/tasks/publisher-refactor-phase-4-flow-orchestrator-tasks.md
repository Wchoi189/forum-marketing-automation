# Phase 4 Task Checklist - Flow Composition and Orchestrator

Related sprint: [`/parent/marketing-automation/.planning/spec-kit/plans/sprints/publisher-refactor-sprint-4-flow-orchestrator.md`](/parent/marketing-automation/.planning/spec-kit/plans/sprints/publisher-refactor-sprint-4-flow-orchestrator.md)

## Implementation Tasks
- [x] Implement `lib/publisher/flow/runPublisherFlow.ts` as the composed flow entry.
- [x] Add `lib/publisher/flow/stateTransitions.ts` if transition checkpoints need shared helpers.
- [x] Migrate publisher-path orchestration out of `bot.ts` into the flow runner.
- [x] Keep `bot.ts` responsible only for orchestration policy + artifact wiring + result mapping.
- [x] Preserve existing API response shape and error contract.

## Regression Guards
- [x] Verify artifact capture toggles/paths remain unchanged.
- [x] Verify fail-closed behavior survives orchestration split.

## Validation Gates
- [x] Run `npm run lint`.
- [x] Run `npm run test:integration`.
- [x] Run one real publisher execution to confirm contract-compatible behavior.
