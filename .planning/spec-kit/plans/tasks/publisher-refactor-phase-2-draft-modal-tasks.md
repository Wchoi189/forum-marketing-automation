# Phase 2 Task Checklist - Draft Modal Isolation

Related sprint: [`/parent/marketing-automation/.planning/spec-kit/plans/sprints/publisher-refactor-sprint-2-draft-modal.md`](/parent/marketing-automation/.planning/spec-kit/plans/sprints/publisher-refactor-sprint-2-draft-modal.md)

## Implementation Tasks
- [x] Create `lib/publisher/ui/draftModal.ts` with explicit functions for row selection, preview confirm/load, and modal close checks.
- [x] Move `confirm-load-draft-modal` internals into module functions with parity logic.
- [x] Preserve freeze-clear and unresolved-state fail-closed checks.
- [x] Rewire existing publisher path to call `draftModal` helpers.
- [x] Add concise inline comments for non-obvious modal-state checkpoints.

## Regression Guards
- [x] Verify ambiguous modal state still returns error, never optimistic success.
- [x] Verify duplicate/competing modal elements remain disambiguated by scoped selectors.

## Validation Gates
- [x] Run `npm run lint`.
- [x] Run `npm run test:integration`.
- [x] Run one real publisher execution and verify deterministic draft load + modal exit (`curl -X POST http://127.0.0.1:3000/api/run-publisher -H 'content-type: application/json' -d '{"force": true}'` with `npm run dev` running).
