# Implementation Feedback — Architecture Refactor

**Date:** 2026-08-08
**Context:** Executing 6-phase architecture refactor based on codebase-feedback-2026-08-08.md

---

## Pain Points Encountered During Implementation

### 1. Circular Import Risk in State Module

**Issue:** When creating `lib/state/` module, I initially tried to import from `lib/controls.ts` which would have created a circular dependency.

**Resolution:** Used `clampInt` directly from `lib/utils.js` and `ENV` from `config/env.js` instead of going through the old `lib/controls.ts`.

**Lesson:** When consolidating state, create fresh imports from leaf modules rather than reusing existing aggregation points.

---

### 2. Partial File Edit Tool Behavior

**Issue:** When editing `lib/runtimeControls.ts`, the edit tool only replaced part of the file, leaving orphaned code that referenced undefined imports (`fs`, `path`, `ENV`).

**Resolution:** Had to completely rewrite the file as a backward-compatibility shim instead of partial edits.

**Lesson:** For large structural refactors, prefer `write_file` over `edit` when replacing most of the file content.

---

### 3. Import Path Updates Required Multiple Iterations

**Issue:** When splitting `lib/scheduler.ts` into subdirectory modules, I forgot to add `applyScheduleJitter` import initially, causing compilation errors.

**Resolution:** Ran `npm run lint` after each change to catch missing imports early.

**Lesson:** Run lint frequently during structural changes — the feedback loop is fast and catches issues immediately.

---

### 4. Integration Test Environment Issues (Pre-existing)

**Issue:** 5 integration tests fail with `EACCES` permission errors when trying to persist to `artifacts/` directory.

**Impact:** These failures mask whether my changes broke anything in persistence logic.

**Recommendation:** Integration tests should use a temp directory instead of `artifacts/` for write operations, or ensure `artifacts/` has proper permissions in CI/test environments.

---

## Remaining Work

### High Priority

1. **Fix Integration Test Permissions**
   - 5 tests fail with EACCES in `artifacts/` directory
   - Either use temp directories for tests or fix permissions
   - Files: `tests/integration/api.integration.test.ts`

2. **Update Module Boundaries Spec**
   - `.planning/spec-kit/specs/module-boundaries.json` should reference new `lib/state/` module
   - Add `lib/scheduler/` as a module boundary

3. **Verify Backward Compatibility at Runtime**
   - The refactoring was structural; need to start the server and verify API still works
   - Test control panel UI loads and persists settings

### Medium Priority

4. **Deprecation Timeline for Old Files**
   - `lib/controls.ts` and `lib/runtimeControls.ts` are now re-export shims
   - Consider adding `@deprecated` JSDoc with removal timeline
   - Update imports in server.ts, routes, and tests to use `lib/state`

5. **Barrel Export Coverage**
   - `lib/competitor-intel/` has no index.ts barrel export
   - `lib/parser/` has no barrel export
   - Consider adding for consistency

### Low Priority

6. **TypeScript Config Consolidation**
   - `tsconfig.json` only includes `src/`
   - `tsconfig.server.json` includes `lib/`, `tests/`, etc.
   - Consider merging or documenting the split clearly

---

## Workspace Root Cleanup Recommendations

### Files to Prune or Move

| File | Recommendation |
|------|----------------|
| `kakaoauto-controller.zip` | Move to `archive/` or delete — appears to be a bundled artifact |
| `CLAUDE.md` | Consider merging into `.agent/` docs or deleting if stale |
| `AGENT-INTEGRATION.md` | Merge relevant content into `.agent/ARCHITECTURE.md` |
| `metadata.json` | If project metadata, consider moving to `.agent/` |

### Directories to Review

| Directory | Recommendation |
|-----------|----------------|
| `ppomppu_profile/` | Add to `.gitignore` if browser profile data (already ignored?) |
| `scratch/` | Add to `.gitignore` or delete if temporary |
| `data/` | Document purpose in README or add to `.gitignore` |

### Root File Count Reduction

Current root has many top-level files. Consider organizing:

```
/                           # Keep: README.md, package.json, tsconfig*.json, Dockerfile, docker-compose.yml
/.agent/                    # All agent-facing docs
/.planning/                 # All planning/spec files
/scripts/                   # Utility scripts (already organized)
/archive/                   # Moved deprecated files
```

---

## Positive Observations

1. **Test Framework Clear** — After creating `tests/README.md`, the `node:test` + `tsx` pattern is straightforward.

2. **Spec-Kit Grounding Works Well** — Having specs in `.planning/spec-kit/specs/` with structured acceptance criteria made it easy to track completion.

3. **Lint is Fast** — TypeScript checks complete in <2 seconds, enabling rapid iteration.

4. **Barrel Exports Enable Clean Imports** — After adding `lib/publisher/index.ts`, imports like `import { PLAYBOOK_STEP_IDS } from './publisher/constants.js'` become `import { PLAYBOOK_STEP_IDS } from './publisher/index.js'`.

---

## Suggested Next Actions

1. Run server manually and test control panel UI
2. Fix integration test permissions
3. Update `module-boundaries.json` spec
4. Clean up root directory (move `kakaoauto-controller.zip` to archive)
5. Consider merging `CLAUDE.md` into `.agent/` docs