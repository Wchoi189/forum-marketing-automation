# Phase 3 Task Checklist - Submit and Verification

Related sprint (archived): [`/parent/marketing-automation/.planning/spec-kit/archive/plans/sprints/publisher-refactor-sprint-3-submit-verification.md`](/parent/marketing-automation/.planning/spec-kit/archive/plans/sprints/publisher-refactor-sprint-3-submit-verification.md)

## Implementation Tasks
- [x] Create `lib/publisher/ui/submit.ts` with explicit submit trigger helper(s).
- [x] Move post-submit redirect verification helpers into the submit module.
- [x] Preserve bounded wait behavior under `BOT_MAX_WAIT_MS` policy.
- [x] Keep success criteria strict: only list/view URL transition counts as success.
- [x] Rewire caller path to use submit module while preserving return/error semantics.

## Regression Guards
- [x] Verify write/write_ok URL states are never treated as successful completion.
- [x] Verify unresolved redirect state still fails closed.

## Validation Gates
- [x] Run `npm run lint`.
- [x] Run `npm run test:integration`.
- [x] Run one real publisher execution and verify redirect behavior parity.
