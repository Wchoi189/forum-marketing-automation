# AI Agent Guide: Reusing `@tools/*` Toolkits in Another Project

This guide provides deterministic, step-by-step instructions for an AI Agent to port, configure, and operate the `@tools/*` toolkits (`arch-governance`, `refactor-engine`, and `ui-schema-engine`) in an external codebase.

---

## 1. Architectural Principles & Invariants

Before performing any file operations, understand the strict isolation model governing these tools:

1. **Self-Contained Sub-Packages**: Each toolkit lives under `tools/<toolkit-name>/` with its own dedicated `package.json` and `package-lock.json`.
2. **Zero Workspace Bleed**: **NEVER** add `tools/*` to the target project's root `package.json` `workspaces` array. Toolkit dependencies must never leak into root `node_modules` or production deployment containers.
3. **Self-Contained Installation**: Toolkits are installed **only** via `npm ci --prefix tools/<toolkit-name>`.
4. **Host-Agnostic Code**: Toolkits never import modules from `apps/`, `packages/`, or root `node_modules`. All repo-specific paths, schemas, and thresholds are provided at runtime via config files located relative to repository root (`process.cwd()`) or CLI flags.
5. **Standardized Exit Codes**:
   - `0`: Success / pass.
   - `1`: Syntax/schema failure (CALM/UI-schema) or host command failure (`refactor-engine verify`).
   - `2`: Policy violation / ratchet finding (size breach, AST pattern match, CALM guardrail breach).
   - `3`: Missing dependency / toolkit not installed (triggers a non-blocking skip in local pre-commit hooks while CI strictly fails).
   - `4`: Usage / configuration error (missing config file, invalid flags).
6. **Engine Requirement**: Node.js **>= 20.0.0**.

---

## 2. Toolkit Catalog & Capabilities

| Toolkit | Name | Primary Capabilities | Core Dependencies |
|---|---|---|---|
| `arch-governance` | `@tools/arch-governance` | FINOS CALM architecture model validation, topology rule checks, egress/connection guardrails, documentation generation (`docify`), architecture diffing. | `@finos/calm-cli`, `fast-glob` |
| `refactor-engine` | `@tools/refactor-engine` | AST-grep and Regex code pattern scanning, file/function size ratcheting, baseline tracking, automated byte-for-byte class/module splits behind facades, codemod catalog execution. | `@ast-grep/napi`, `@getgrit/gritql`, `picomatch`, `typescript` |
| `ui-schema-engine` | `@tools/ui-schema-engine` | UI field contract schema validation (`ui-schema.v1`), DB DDL drift auditing (NOT NULL & CHECK enum alignment), LLM prompt DSL distillation (~180 tokens/view), headless Playwright schema crawler. | `yaml` *(Playwright optional)* |

---

## 3. Step-by-Step AI Agent Execution Protocol

Follow these sequential steps when importing toolkits into a target repository.

### Step 3.1: Environment Pre-Flight Check

In the target project root, verify Node.js version and repository state:

```bash
# Verify Node version >= 20
node -v

# Verify clean git working directory or branch readiness
git status
```

---

### Step 3.2: Copying Toolkit Files (Excluding `node_modules`)

Copy the desired toolkit directory entirely from the source repository into the target repository under `tools/<toolkit-name>`. 

> [!IMPORTANT]
> **Never copy `node_modules` or `.cache`.** Only copy source, binaries, configs, schemas, and package definitions.

#### Shell Command Pattern:
```bash
# Example: Copying refactor-engine to target project /path/to/target-repo
mkdir -p /path/to/target-repo/tools/refactor-engine
rsync -av --exclude='node_modules' --exclude='.cache' \
  /path/to/source-repo/tools/refactor-engine/ \
  /path/to/target-repo/tools/refactor-engine/
```

#### Files to Verify in Target:
Ensure that the target host's `.gitignore` contains `node_modules/` or `/node_modules`. If it uses `**/node_modules`, ensure the toolkit's dependencies won't be staged by accident.

---

### Step 3.3: Isolated Installation & Test Verification

Install the toolkit strictly using its own lockfile and run its internal unit tests:

```bash
# 1. Install toolkit dependencies in isolation
npm ci --prefix tools/<toolkit-name>

# 2. Run internal tests to verify runtime integrity
node --test tools/<toolkit-name>/tests/
```

Every toolkit should pass 100% of its internal unit tests without requiring any root dependencies.

---

### Step 3.4: Target Repository Configuration

Each toolkit requires a host-level configuration file and some minimum seed files. Generate the appropriate config file based on the toolkit being integrated:

#### Option A: Configuring `@tools/refactor-engine`
Create `docs/architecture/refactor-engine.config.json` (or `refactor-engine.config.json` at repo root):

```json
{
  "scope": {
    "include": [
      "src/**/*.{js,ts,jsx,tsx}"
    ],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.test.*",
      "**/fixtures/**"
    ]
  },
  "limits": {
    "fileLines": 400,
    "functionLines": 100
  },
  "patterns": [
    {
      "id": "no-console-log",
      "kind": "regex",
      "regex": "console\\.log\\(",
      "why": "Production code must use structured logger, not console.log"
    }
  ],
  "baseline": "docs/architecture/refactor-engine.baseline.json",
  "receipts": "docs/architecture/recipes",
  "verify": {
    "commands": [
      {
        "name": "typecheck",
        "argv": ["npm", "run", "typecheck"]
      },
      {
        "name": "test",
        "argv": ["npm", "test"]
      }
    ]
  }
}
```

**Initialize Baseline**:
Capture the current state so existing debt is baselined and only new debt is blocked:
```bash
node tools/refactor-engine/bin/refactor-engine.js baseline --init
```

---

#### Option B: Configuring `@tools/ui-schema-engine`
Create `docs/contracts/ui-governance.config.json` (or at repo root):

```json
{
  "dbSchema": "db/schema.sql",
  "views": "docs/contracts/views/*.ui-schema.yaml",
  "rules": [
    { "rule": "required-not-null",  "enabled": true },
    { "rule": "enum-options-match", "enabled": true }
  ]
}
```

**Provide Seed Files**:
Ensure a DB schema file exists (e.g. `db/schema.sql`). 
Create a minimal starter contract at `docs/contracts/views/sample.ui-schema.yaml` to prevent Exit 4 ("No files to validate"):
```yaml
schemaVersion: "1.0"
view:
  id: "sample-view"
  name: "SampleView"
  type: "form"
fields:
  - id: "name"
    label: "Name"
    component: "input"
```

**Validate Sample Contract**:
```bash
# Validate contract syntax
node tools/ui-schema-engine/bin/ui-schema.js validate --config docs/contracts/ui-governance.config.json

# Audit contract against DB schema for field drift
node tools/ui-schema-engine/bin/ui-schema.js audit --config docs/contracts/ui-governance.config.json
```

---

#### Option C: Configuring `@tools/arch-governance`
Create `docs/architecture/arch-governance.config.json`:

```json
{
  "architecture": "docs/architecture/system.calm.json",
  "patternsDir": "docs/architecture/patterns",
  "outputDir": "dist/architecture",
  "docsBaseUrl": "/docs/architecture/",
  "rules": {
    "forbiddenConnections": [
      {
        "id": "client-to-store",
        "fromZone": "client",
        "toNodeType": "database",
        "message": "Browser clients must never connect directly to database stores."
      }
    ],
    "egressOrigins": {
      "toZone": "external",
      "allowedFromZones": ["server"]
    }
  }
}
```

**Provide Seed Files**:
Create `docs/architecture/patterns/` directory:
```bash
mkdir -p docs/architecture/patterns
```
Create `docs/architecture/system.calm.json`:
```json
{
  "$schema": "https://calm.finos.org/release/1.0/meta/calm.json",
  "unique-id": "system-architecture",
  "name": "System Architecture",
  "nodes": [],
  "relationships": []
}
```

**Validate Model**:
```bash
node tools/arch-governance/bin/arch-governance.js validate --strict -c docs/architecture/arch-governance.config.json
```

---

### Step 3.5: Adding Root Package.json Convenience Scripts

Add proxy scripts into the target project's root `package.json` under `"scripts"`. Notice all commands invoke `node tools/...` directly:

```json
{
  "scripts": {
    "refactor:audit": "node tools/refactor-engine/bin/refactor-engine.js audit",
    "refactor:baseline": "node tools/refactor-engine/bin/refactor-engine.js baseline --write",
    "ui-schema:validate": "node tools/ui-schema-engine/bin/ui-schema.js validate --config docs/contracts/ui-governance.config.json",
    "ui-schema:audit": "node tools/ui-schema-engine/bin/ui-schema.js audit --config docs/contracts/ui-governance.config.json",
    "ui-schema:prompt": "node tools/ui-schema-engine/bin/ui-schema.js prompt",
    "arch:validate": "node tools/arch-governance/bin/arch-governance.js validate --strict"
  }
}
```

---

### Step 3.6: Git Pre-Commit Hook Integration

Add gate execution into `.husky/pre-commit` or `.git/hooks/pre-commit`.

> [!IMPORTANT]
> Always implement the **Exit Code 3 Skip Pattern**. If a developer clones the repo and hasn't yet run `npm ci --prefix tools/<name>`, the pre-commit hook must warn and skip instead of hard-failing, while CI remains the strict enforcement backstop.

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Refactor Ratchet Gate ──────────────────────────────────────
staged_files=$(git diff --cached --name-only --diff-filter=ACMR || true)
if [ -n "$staged_files" ]; then
  rc=0
  node tools/refactor-engine/bin/refactor-engine.js audit --staged || rc=$?
  if [ "$rc" -eq 3 ]; then
    echo "  [pre-commit] ratchet gate skipped: run 'npm ci --prefix tools/refactor-engine' (CI still enforces)."
  elif [ "$rc" -ne 0 ]; then
    echo "  [pre-commit] BLOCKED: size or anti-pattern ratchet violation (exit $rc)."
    exit 1
  fi
fi

# ── UI Schema Governance Gate ─────────────────────────────────
schema_changes=$(git diff --cached --name-only --diff-filter=ACMD || true)
if echo "$schema_changes" | grep -qE '(ui-schema\.yaml|schema\.sql)'; then
  rc=0
  node tools/ui-schema-engine/bin/ui-schema.js audit --config docs/contracts/ui-governance.config.json || rc=$?
  if [ "$rc" -eq 3 ]; then
    echo "  [pre-commit] ui-schema gate skipped: run 'npm ci --prefix tools/ui-schema-engine' (CI still enforces)."
  elif [ "$rc" -ne 0 ]; then
    echo "  [pre-commit] BLOCKED: UI schema field drift detected (exit $rc)."
    exit 1
  fi
fi
```

---

### Step 3.7: GitHub Actions CI Integration

Create workflow files in `.github/workflows/`. Because the toolkits have dedicated lockfiles, key the GitHub Actions npm cache to `tools/<toolkit-name>/package-lock.json`.

#### Example CI Workflow: `.github/workflows/tool-governance.yml`

```yaml
name: Tool Governance

on:
  pull_request:
    branches: [ main ]
  push:
    branches: [ main ]

jobs:
  arch-governance:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: tools/arch-governance/package-lock.json

      - name: Install arch-governance
        run: npm ci --prefix tools/arch-governance

      - name: Validate CALM Architecture Model
        run: node tools/arch-governance/bin/arch-governance.js validate --strict

  refactor-ratchet:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: tools/refactor-engine/package-lock.json

      - name: Install refactor-engine
        run: npm ci --prefix tools/refactor-engine

      - name: Audit codebase limits & patterns
        run: node tools/refactor-engine/bin/refactor-engine.js audit

  ui-schema-governance:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: tools/ui-schema-engine/package-lock.json

      - name: Install ui-schema-engine
        run: npm ci --prefix tools/ui-schema-engine

      - name: Validate contract schema definitions
        run: node tools/ui-schema-engine/bin/ui-schema.js validate --config docs/contracts/ui-governance.config.json

      - name: Audit contracts against DB schema
        run: node tools/ui-schema-engine/bin/ui-schema.js audit --config docs/contracts/ui-governance.config.json
```

---

### Step 3.8: Exposing Toolkits to AI Agents

To ensure AI coding agents operating in the target repository discover and utilize the ported toolkits, expose them via the project's agent guidance documents:

#### 1. Add to `AGENTS.md` or `CLAUDE.md`
Declare the toolkits and their operational roles in the host project's agent guide:

```markdown
## Toolkits & Code Governance

| Toolkit | Command | Agent Role |
|---|---|---|
| `@tools/ui-schema-engine` | `node tools/ui-schema-engine/bin/ui-schema.js` | Validate form contracts (`validate`), audit DB drift (`audit`), and distill compact view DSL for prompts (`prompt`). |
| `@tools/refactor-engine` | `node tools/refactor-engine/bin/refactor-engine.js` | Audit file/function size limits, scan banned AST patterns (`audit`), and ratchet debt (`baseline --write`). |
| `@tools/arch-governance` | `node tools/arch-governance/bin/arch-governance.js` | Validate FINOS CALM architecture models and check network topology guardrails (`validate --strict`). |
```

#### 2. Register Agent Skills
If the target repository utilizes an agent skill registry (e.g., `.agent/skills/` or `.agents/skills/`), create dedicated skill sheets (e.g. `ui-schema-governance.md`, `refactor-engine.md`, `arch-governance.md`) detailing:
- Triggers and CLI invocation patterns.
- Expected exit codes (`0` = pass, `1` = syntax/verify fail, `2` = policy finding, `3` = missing deps, `4` = usage error).
- Safe recovery paths (running `npm ci --prefix tools/<name>` when encountering Exit 3).

#### 3. LLM Prompt Injection Pattern
When an AI agent is tasked with building or editing a UI view or form, instruct it to first run `ui-schema prompt`:
```bash
node tools/ui-schema-engine/bin/ui-schema.js prompt --view <ViewName>
```
The distilled DSL (<180 tokens) should be pasted directly into the agent's prompt context to guarantee that all generated components, fields, types, and validations align exactly with the field contract and database schema.

---

## 4. Verification Checklist for the AI Agent

To confirm complete and error-free adoption in the target project, run this checklist:

- [ ] **Lockfile Isolation**: Confirm target root `package-lock.json` was NOT modified when installing tools.
- [ ] **Workspace Cleanliness**: Confirm target root `package.json` does NOT list `tools/*` in `"workspaces"`.
- [ ] **Isolated Installation**: `npm ci --prefix tools/<toolkit-name>` succeeds with zero errors.
- [ ] **Toolkit Unit Tests**: `node --test tools/<toolkit-name>/tests/` reports all passing tests.
- [ ] **Config Resolution**: Invoking `node tools/<toolkit-name>/bin/<name>.js` from root correctly finds the host config file.
- [ ] **Dry Run Pass**: CLI commands exit `0` under standard conditions.
- [ ] **Exit Code Check**: Trigger a deliberate test violation (e.g. create a file with `console.log` or violate a `NOT NULL` constraint) and confirm the tool blocks with exit `2` (for `refactor-engine`/`arch-governance`) or exit `1` (for `ui-schema-engine` syntax/schema failure).
- [ ] **Pre-commit Pass**: Staging code triggers the gate and exits gracefully.

---

## 5. Troubleshooting & Edge Cases

| Issue | Root Cause | Solution |
|---|---|---|
| `Cannot find module 'yaml'` (or other dependency) | Attempted to run toolkit using root `node_modules`. | Run `npm ci --prefix tools/<toolkit-name>`. |
| `Cannot find module ...` from app code | The toolkit inadvertently imported host code. | Invariant violation: toolkits must never import from host. Verify `tools/<name>/src` contains no host paths. |
| Exit code `3` in pre-commit | Developer did not install toolkit locally. | Expected behavior: hook warns and skips without blocking. Run `npm ci --prefix tools/<toolkit-name>`. |
| `ConfigError: configuration file not found` | Invoked binary with wrong working directory or config path. | Run commands from repository root (CWD), or pass `--config <path>`. |
| `playwright` missing during `ui-schema extract` | Playwright is an optional peer dependency for headless extraction. | Install Playwright in the target environment: `npm install playwright`. Notice `validate`, `audit`, and `prompt` do NOT need Playwright. |
