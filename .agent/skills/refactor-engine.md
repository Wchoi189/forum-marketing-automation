# Skill: Refactor Engine

**Purpose:** Enforce code size limits, scan for forbidden anti-patterns via AST-grep and Regex, maintain ratcheted technical debt baselines, and execute automated class/module splits using `@tools/refactor-engine`.

**Invocation:** Run as an agent skill when:
- Auditing staged code or full repository for size and anti-pattern breaches (`refactor-engine audit`).
- Lowering technical debt baselines after completing refactoring work (`refactor-engine baseline --write`).
- Modularizing monolithic classes or files into clean facades with automated splits (`inventory` -> `plan` -> `apply` -> `verify`).
- Running codemod catalogs across the codebase (`refactor-engine codemod`).

---

## Capabilities & Commands

The toolkit binary lives at `tools/refactor-engine/bin/refactor-engine.js`. All commands are run from repository root.

### 1. Codebase Audit (Limits & Patterns)
Scans files against file line limits (e.g. 400 lines), function line limits (e.g. 100 lines), and configured AST-grep / regex patterns (e.g. `no-console-log`):
```bash
# Full codebase audit
node tools/refactor-engine/bin/refactor-engine.js audit

# Staged files only (used in git pre-commit hooks)
node tools/refactor-engine/bin/refactor-engine.js audit --staged

# Machine-readable JSON output for agent analysis
node tools/refactor-engine/bin/refactor-engine.js audit --json
```

### 2. Baseline Tracking & Ratcheting
Baselines grandfather existing debt so new code is held to strict standards without blocking on historic violations:
```bash
# Lower baseline (removes grandfathered debt that has been resolved; never raises)
node tools/refactor-engine/bin/refactor-engine.js baseline --write

# Deliberately raise a baseline entry for one specific file (requires audited justification)
node tools/refactor-engine/bin/refactor-engine.js baseline --raise <filepath> --reason "<justification>"

# Initialize baseline on a fresh project
node tools/refactor-engine/bin/refactor-engine.js baseline --init
```

### 3. Automated Byte-for-Byte Refactoring Behind Facades
Safely breaks large classes or modules into cohesive internal parts without breaking external consumers:
```bash
# 1. Inspect class/module members and affinity clusters
node tools/refactor-engine/bin/refactor-engine.js inventory <source-file>

# 2. Generate refactoring plan from a recipe
node tools/refactor-engine/bin/refactor-engine.js plan <recipe.json> --markdown

# 3. Apply the split (creates part files, rewires facade)
node tools/refactor-engine/bin/refactor-engine.js apply <recipe.json>

# 4. Verify no drift and run host test suite
node tools/refactor-engine/bin/refactor-engine.js verify <recipe.json>
```

---

## Exit Codes

| Code | Meaning | Agent Action |
|------|---------|--------------|
| `0`  | Success / pass | Code conforms to limits and baselines. |
| `1`  | Host verification failed | A verification command (`npm test`, `typecheck`) failed during `refactor-engine verify`. |
| `2`  | Policy violation / finding | File size grew, function size grew, or anti-pattern matched beyond baseline. Reduce code size or fix anti-pattern. |
| `3`  | Dependencies not installed | Run `npm ci --prefix tools/refactor-engine`. In local pre-commit hooks, this skips gracefully. |
| `4`  | Usage or recipe error | Invalid flag, malformed recipe, or missing file. |

---

## Safety & Invariants

1. **Self-Contained Installation**: Never install into root `node_modules`. Always use `npm ci --prefix tools/refactor-engine`.
2. **Never Silently Raise Baselines**: `baseline --write` only lowers counts. Raising a baseline requires `--raise <path> --reason <text>` and must be committed alongside the change.
