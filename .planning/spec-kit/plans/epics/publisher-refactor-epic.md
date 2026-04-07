# Publisher Refactor Plan (Repo-Level)

## Purpose
- Improve publisher codebase maintainability as complexity grows.
- Preserve current runtime behavior and fail-closed safety guarantees.
- Provide a durable roadmap that can be executed across multiple sessions.

## Refactor Goals
- **Modularity**: isolate responsibilities into focused modules.
- **Simplicity**: reduce branching and duplicated selector/wait logic.
- **Robustness**: keep deterministic fail-closed behavior for ambiguous UI states.
- **Operability**: make debugging/test verification straightforward and repeatable.

## Current Pain Points
- `bot.ts` mixes orchestration, policy, and browser-flow concerns.
- `lib/playbookRunner.ts` carries step execution, selector fallback logic, modal handling, and submit semantics in one file.
- Selector resolution and actionability concerns are repeated in multiple paths.
- UI state transitions (modal open/close, freeze, preview-load, submit landing) are implicit and hard to reason about.

## Architectural Direction
- Keep `bot.ts` as a thin orchestrator.
- Move browser-flow details into dedicated publisher modules.
- Introduce explicit transition checkpoints between flow stages.
- Keep playbook schema and contracts intact while improving internals.

## Target Module Layout
- `lib/publisher/core/`
  - `types.ts`: publisher runtime/step/result types.
  - `timeouts.ts`: shared timeout policy (single source).
  - `errors.ts`: fail-closed error builders/messages.
- `lib/publisher/ui/`
  - `selectorResolver.ts`: unified selector candidate + visibility/actionability logic.
  - `draftModal.ts`: row select, preview confirm/load, freeze-clear handling.
  - `submit.ts`: submit action + post-submit landing verification helpers.
- `lib/publisher/flow/`
  - `stateTransitions.ts`: explicit transition checkpoints.
  - `runPublisherFlow.ts`: flow runner composed from UI/core modules.

## Delivery Phases

### Phase 1: Extract Foundations (low risk)
- Extract timeout constants into `lib/publisher/core/timeouts.ts`.
- Extract selector resolution utilities from `lib/playbookRunner.ts`.
- Keep behavior identical; no schema/env changes.

**Acceptance**
- `npm run lint` passes.
- `npm run test:integration` passes.
- No change in published output semantics.

### Phase 2: Isolate Draft Modal Flow
- Move `confirm-load-draft-modal` internals into `lib/publisher/ui/draftModal.ts`.
- Keep existing fallback semantics:
  - row-based draft selection
  - preview load/confirm
  - freeze-clear checks
  - fail-closed on unresolved modal state

**Acceptance**
- Existing integration tests pass.
- Real publisher run still loads draft and exits modal deterministically.

### Phase 3: Isolate Submit + Verification
- Move submit behavior and post-submit verification to `lib/publisher/ui/submit.ts`.
- Preserve current success criteria:
  - submit trigger
  - URL transition to list/view (not write/write_ok)
  - bounded wait semantics

**Acceptance**
- Existing integration tests pass.
- Real run verifies redirect with unchanged fail-closed behavior.

### Phase 4: Thin Orchestrator + Flow Composition
- Introduce `lib/publisher/flow/runPublisherFlow.ts`.
- Reduce `bot.ts` publisher path to orchestration + policy + artifacts.
- Keep return shape and API behavior unchanged.

**Acceptance**
- `npm run lint` and `npm run test:integration` pass.
- Publisher API outputs remain contract-compatible.

### Phase 5: Optional Hardening (after baseline refactor)
- Add focused integration tests for draft modal lifecycle transitions.
- Add test coverage for submit verification edge cases.
- Consider small diagnostics abstraction for future troubleshooting (without inline debug plumbing).

## Non-Goals
- No playbook contract redesign in this refactor track.
- No environment model redesign unless explicitly required.
- No behavioral expansion beyond current publisher semantics.

## Guardrails (Must Keep)
- Fail-closed publisher behavior must remain intact.
- Success requires post-submit verification to list/view URL.
- Waits must stay bounded; no unbounded retries.
- Preserve artifact capture flow used for triage.

## Verification Checklist (Every Phase)
- Run `npm run lint`.
- Run `npm run test:integration`.
- Perform at least one real publisher run when flow internals changed.
- Confirm no regression in:
  - draft load
  - modal/overlay freeze clear
  - submit trigger
  - success URL verification

## Risks and Mitigations
- **Risk**: hidden behavior drift during extraction.
  - **Mitigation**: move code first, then simplify in a second step.
- **Risk**: selector fragility after modular split.
  - **Mitigation**: centralize selector resolution and keep one decision path.
- **Risk**: flow race conditions.
  - **Mitigation**: preserve bounded waits and explicit postconditions per transition.

## Execution Notes
- Prefer small PRs or commits per phase.
- Keep each phase independently deployable.
- Do not remove safety checks until equivalent checks exist in extracted modules.
