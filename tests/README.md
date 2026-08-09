# Test Framework Guide

This project uses **Node.js native test runner** (`node:test`) with `tsx` for TypeScript execution.

## Test Structure

```
tests/
├── unit/                    # Fast, isolated unit tests
│   ├── competitor-intel/    # Competitor intel extraction tests
│   ├── aiAdvisor.test.ts
│   ├── competitorAnalytics.test.ts
│   └── ...
└── integration/             # API and end-to-end tests
    ├── api.integration.test.ts
    ├── bot-stability.test.ts
    └── ...
```

## Running Tests

```bash
# Run all tests: lint (tsc x2 + ast-grep) + unit + integration + mcp:parser + competitor-intel.
# This is exactly what CI runs.
npm run test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run competitor intel tests (unit + integration)
npm run test:competitor-intel

# Run MCP parser integration test
npm run test:mcp:parser
```

## Writing Tests

Use `node:test` and `node:assert/strict`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("my feature works", async () => {
  const result = await myFunction();
  assert.equal(result.status, "ok");
});
```

### Key Points

- **Async tests**: Mark the callback as `async` and use `await` for async functions
- **Assertions**: Use `assert` from `node:assert/strict` for strict equality checks
- **File naming**: Use `.test.ts` suffix for all test files

## The Test Environment

**All test scripts go through `scripts/run-tests.sh`. Never invoke `tsx --test`
from `package.json` directly.**

The runner does three things that matter:

1. **Overrides every path-shaped variable.** `ARTIFACTS_DIR`, `BOT_PROFILE_DIR`,
   and `ACTIVITY_LOG_PATH` point into a `mktemp -d` directory removed on exit.
   Tests never touch the real workspace, and state cannot leak between runs —
   which matters because `stateVersion` is monotonic and the concurrency test
   asserts on exact values.
2. **Supplies credentials and IDs** — `FORUM_PRIMARY_ID`, `PPOMPPU_USER_ID`,
   `PPOMPPU_USER_PW`, `XAI_API_KEY`, `NL_WEBHOOK_SECRET`.
3. **Expands globs itself.** Node's `--test` only accepts glob patterns from
   v21 on; this project runs v20, where an unexpanded pattern makes the whole
   suite exit without running. That silently skipped `test:competitor-intel`.

### Why this exists

`config/env.ts` loads `.env`, and a developer `.env` legitimately contains
absolute paths for that machine. Tests that inherit them write to directories
that may not exist. Before the runner was introduced, five integration tests
failed with `EACCES: permission denied, mkdir '/parent/marketing-automation'` —
diagnosed for weeks as an `artifacts/` permission problem when the real cause
was `.env` bleeding into the test process.

`config/env.ts` deliberately calls `dotenv.config()` **without**
`override: true`, so the runner's explicit exports win.

### Writing path-aware tests

Resolve through `ENV`, never by reassembling the layout:

```typescript
// Correct — follows the redirect
const p = path.join(ENV.ARTIFACTS_DIR, "runtime-controls.json");

// Wrong — reads a different file than the server writes
const p = path.join(ENV.PROJECT_ROOT, "artifacts", "runtime-controls.json");
```

## Debugging

Run a single file through the runner so it gets the same environment:

```bash
bash scripts/run-tests.sh tests/unit/schedulerSignals.test.ts
```

For verbose output, append the reporter flag:

```bash
bash scripts/run-tests.sh --test-reporter=spec tests/unit/schedulerSignals.test.ts
```

## Known Environmental Failures

`tests/unit/competitor-intel/ocr-vlm.test.ts` has two cases that call a local
Ollama server (`callOllamaGenerate`). They fail with `fetch failed` when Ollama
is not running. This is environmental, not a code defect.