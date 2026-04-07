# Sprint 3 - Submit and Redirect Verification Isolation

Epic: [`/parent/marketing-automation/.planning/spec-kit/plans/epics/publisher-refactor-epic.md`](/parent/marketing-automation/.planning/spec-kit/plans/epics/publisher-refactor-epic.md)  
Roadmap: [`/parent/marketing-automation/.planning/spec-kit/plans/roadmaps/publisher-refactor-roadmap.md`](/parent/marketing-automation/.planning/spec-kit/plans/roadmaps/publisher-refactor-roadmap.md)

## Goal
Isolate submit behavior and success verification checks into a dedicated module while preserving current safety semantics.

## In Scope
- Move submit trigger logic into `lib/publisher/ui/submit.ts`.
- Move post-submit URL verification helpers into the same module.
- Preserve bounded wait policy and list/view URL success criteria.

## Out of Scope
- Draft modal logic changes.
- Orchestration/API contract changes.

## Deliverables
- Submit module with explicit trigger and verify helpers.
- Existing runtime path migrated with parity behavior.
- Documentation comments for success/failure decision points.

## Acceptance
- `npm run lint` passes.
- `npm run test:integration` passes.
- Real publisher run confirms redirect verification behavior is unchanged and fail-closed.

## Exit Criteria
- Success is impossible without verified transition away from write screens.
- No unbounded retry/wait loops are introduced.
