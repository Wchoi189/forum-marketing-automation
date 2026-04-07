# Sprint 5 - Optional Hardening

Epic: [`/parent/marketing-automation/.planning/spec-kit/plans/epics/publisher-refactor-epic.md`](/parent/marketing-automation/.planning/spec-kit/plans/epics/publisher-refactor-epic.md)  
Roadmap: [`/parent/marketing-automation/.planning/spec-kit/plans/roadmaps/publisher-refactor-roadmap.md`](/parent/marketing-automation/.planning/spec-kit/plans/roadmaps/publisher-refactor-roadmap.md)

## Goal
Add confidence-focused test and diagnostics hardening after baseline refactor parity is complete.

## Status
Optional and non-blocking for baseline completion.

## In Scope
- Add focused integration tests for draft modal lifecycle transitions.
- Add edge-case coverage for submit redirect verification.
- Consider lightweight diagnostics abstraction that does not alter runtime semantics.

## Out of Scope
- Any contract redesign.
- Any behavior-expanding runtime changes.

## Deliverables
- New/updated integration tests targeting known risky transitions.
- Optional diagnostics improvements gated behind existing debug behavior.

## Acceptance
- `npm run lint` passes.
- `npm run test:integration` passes.
- Added tests demonstrate improved detection of modal/submit regressions.

## Exit Criteria
- Hardening improves confidence without changing publisher behavior.
- Optional diagnostics remain supportive and non-intrusive.
