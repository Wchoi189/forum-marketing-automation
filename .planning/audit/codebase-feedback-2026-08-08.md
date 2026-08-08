# Codebase Feedback Audit

**Date:** 2026-08-08
**Context:** Implementing rate limit detection and backoff for ppomppu.co.kr publisher

---

## Pain Points

### 1. Test Framework Confusion

**Issue:** No clear documentation on test framework. I initially wrote tests using `vitest` syntax, only to discover the project uses `node:test` with `tsx`.

**Impact:** Wasted time rewriting tests. Could have been avoided with a simple note in README or AGENTS.md.

**Recommendation:** Add a `tests/README.md` explaining:
- Unit tests use `node:test` with `tsx` runner
- Integration tests use Playwright
- How to run each test type

---

### 2. Pre-existing TypeScript Errors Ignored

**Issue:** `tests/integration/bot-stability.test.ts` has 14+ TypeScript errors that have been present for some time. These create noise when running `npm run lint`.

**Impact:** Developers learn to ignore lint output, reducing its value.

**Recommendation:** Either fix the errors or add the file to a TypeScript exclude pattern if it's intentionally broken.

---

### 3. Scattered State Management

**Issue:** Publisher state lives in multiple places:
- `lib/controls.ts` - In-memory runtime state
- `lib/runtimeControls.ts` - Persistence layer
- `contracts/models.ts` - Type definitions

Adding a new field required touching 4+ files with different patterns.

**Impact:** High cognitive load, easy to miss a file, inconsistent patterns.

**Recommendation:** Consider a unified state module pattern:
```
lib/state/
  publisher.ts      # In-memory + persistence together
  observer.ts
  scheduler.ts
```

---

### 4. Deep Relative Imports

**Issue:** Import paths like `../../lib/publisher/ui/rateLimit.js` are error-prone and hard to read.

**Impact:** Easy to get wrong, especially when moving files.

**Recommendation:** 
- Add path aliases in `tsconfig.json` (e.g., `@/lib/*`)
- Or reorganize into a shallower structure

---

### 5. Mixed Concerns in Large Files

**Issue:** `lib/scheduler.ts` (380+ lines) mixes scheduling logic, trend analysis, presets, and gap management.

**Impact:** Hard to find the relevant code section. High cognitive overhead.

**Recommendation:** Split into focused modules:
```
lib/scheduler/
  index.ts           # Main scheduler
  presets.ts         # PRESET_CONFIG, preset logic
  trendAdapter.ts    # Trend-based interval calculation
  gapRecheck.ts      # Gap-driven recheck logic
```

---

### 6. RuntimeControls File is a Dumping Ground

**Issue:** `lib/runtimeControls.ts` handles scheduler, observer, publisher, NL webhook, parser settings, browser logging, etc. It's 400+ lines with no clear boundaries.

**Impact:** Adding a new persisted field requires understanding the entire file's structure.

**Recommendation:** Split by domain, same pattern as #5 above.

---

### 7. Type Duplication Across Files

**Issue:** `PublisherControls` (lib/controls.ts) vs `PersistedPublisherControls` (lib/runtimeControls.ts) have similar but not identical fields. Same for observer and scheduler.

**Impact:** Risk of drift between in-memory and persisted types. Easy to forget to update one.

**Recommendation:** Define types once, derive persisted variant:
```typescript
// lib/controls.ts
export type PublisherControls = {
  draftItemIndex: number;
  publishBlockedUntil: string | null;
};

// lib/runtimeControls.ts
export type PersistedPublisherControls = PublisherControls;
// Or use Pick/Omit if some fields shouldn't persist
```

---

### 8. AGENTS.md is Overwhelming

**Issue:** AGENTS.md is comprehensive but dense. It mixes:
- Operational guidelines (how to run tests)
- Domain knowledge (gap health, competitor intel)
- Known issues (KEDB)
- Architecture decisions

**Impact:** Hard to find specific information quickly.

**Recommendation:** Split into focused documents:
```
.agent/
  README.md          # Quick start
  OPERATIONS.md      # How to run tests, lint, etc.
  ARCHITECTURE.md    # High-level structure
  KNOWN_ISSUES.md    # KEDB
```

---

### 9. No Module Index Files

**Issue:** Importing from `lib/publisher/ui/rateLimit.js` requires knowing the full path. No barrel exports.

**Impact:** Changes to file structure break imports everywhere.

**Recommendation:** Add `index.ts` files to re-export public APIs:
```typescript
// lib/publisher/ui/index.ts
export { detectRateLimit } from './rateLimit.js';
export { confirmLoadDraftFromModal } from './draftModal.js';
```

---

### 10. Playbook Hardcodes Step IDs

**Issue:** Code checks for `step_id === 'click-write'` which is defined in JSON playbook. Magic string coupling.

**Impact:** If playbook changes, runtime code breaks silently.

**Recommendation:** Define step IDs as constants shared between playbook and code:
```typescript
// lib/publisher/constants.ts
export const PLAYBOOK_STEP_IDS = {
  CLICK_WRITE: 'click-write',
  SUBMIT_POST: 'submit-post',
} as const;
```

---

## Quick Wins

1. Add `tests/README.md` with test framework docs
2. Fix or exclude `bot-stability.test.ts` errors
3. Add TypeScript path aliases
4. Split `AGENTS.md` into focused docs

---

## Larger Refactors

1. Consolidate state management pattern
2. Split large files by domain
3. Unify type definitions
4. Add barrel exports to key directories

---

## Positive Notes

- Strong separation between publisher flow and UI interactions
- Good logging discipline with structured events
- Playbook-driven approach is flexible
- Known Issues Database (KEDB) is excellent for debugging