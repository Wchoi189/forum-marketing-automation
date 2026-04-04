# Agent Operating Guide

This project runs a Playwright-based observer/publisher workflow for the Ppomppu OTT board.

## Primary Goals
- Keep publishing behavior deterministic and fail-closed.
- Preserve contract alignment between runtime code and spec-kit manifests.
- Avoid silent regressions in publisher steps (draft load, modal confirm, submit, redirect verification).

## Environment Variable Ground Rules
- Canonical runtime parsing/validation lives in `config/env.ts`.
- Canonical contract list lives in `.agent/contracts/env.contract.json`.
- Canonical schema constraints live in `.planning/spec-kit/manifest/schemas/env.schema.json`.
- When adding/changing any env var, update all three files in the same change.
- Never log or commit secret values (for example `PPOMPPU_USER_PW`).

## Publisher Success Criteria
- "Success" means more than a click:
  - Draft is loaded into editor (required body text present).
  - Submit action is triggered.
  - URL transitions to a board list/view URL (not write screen).
- If any criterion fails, return an error (do not emit optimistic success).

## Debug Artifact Workflow
- Optional env toggles:
  - `PUBLISHER_DEBUG_SCREENSHOTS=true` for step screenshots.
  - `PUBLISHER_DEBUG_TRACE=true` for Playwright trace zip.
- Artifacts are stored under `artifacts/publisher-runs/<timestamp>/`.
- On publisher failure, always capture `error.png` when a page exists.
- For trace replay: `npx playwright show-trace <path-to-trace.zip>`.

## Selector Strategy
- Prefer stable class/text combinations and scoped locators over absolute XPath.
- Use XPath only as a scoped fallback when sibling relationships are the only reliable signal.
- Keep locators resilient to duplicated labels in list rows/modals.

## Regression Prevention Checklist (Agents)
- Run `npm run lint` after code edits.
- Run `npm run test:integration` for API/publisher behavior changes.
- Run full `npm run test` for broader parser/runtime changes.
- Do not weaken fail-closed checks without explicit approval.

