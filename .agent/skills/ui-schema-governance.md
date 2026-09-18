# Skill: UI Schema Governance

**Purpose:** Provide contract-first UI field governance, database drift auditing, and ultra-compact LLM prompt distillation using `@tools/ui-schema-engine`.

**Invocation:** Run as an agent skill when:
- Defining or modifying frontend view contracts (`*.ui-schema.yaml`).
- Auditing UI fields against database schema (`db/schema.sql` or Postgres) to prevent field drift.
- Distilling UI contracts into ultra-compact prompt DSL blocks (`ui-schema prompt`) for LLM context injection.
- Crawling existing web interfaces into structured schema contracts (`ui-schema extract`).

---

## Capabilities & Commands

The toolkit binary lives at `tools/ui-schema-engine/bin/ui-schema.js`. All commands are run from repository root.

### 1. Validate View Contracts
Validates `*.ui-schema.yaml` contracts against `schemas/ui-schema.v1.schema.json`.
```bash
node tools/ui-schema-engine/bin/ui-schema.js validate --config docs/contracts/ui-governance.config.json
# Or validate specific files:
node tools/ui-schema-engine/bin/ui-schema.js validate docs/contracts/views/sample.ui-schema.yaml
```

### 2. Audit Contracts Against Database Schema (Drift Detection)
Compares contract fields against the database DDL:
- **`required-not-null`**: Ensures non-null DB columns without defaults are marked `required: true` in the UI.
- **`enum-options-match`**: Ensures `CHECK (col IN (...))` values match the UI contract's enum options.
```bash
node tools/ui-schema-engine/bin/ui-schema.js audit --config docs/contracts/ui-governance.config.json
```

### 3. LLM Prompt Distillation (<180 tokens/view)
Formats a UI schema contract into an ultra-compact prompt DSL block for injection into LLM prompts. Use this when asking an agent or model to generate or modify React components, forms, or API payloads:
```bash
node tools/ui-schema-engine/bin/ui-schema.js prompt --view <ViewName> --config docs/contracts/ui-governance.config.json
```
Output format example:
```
[FORM: "RefundModal"]
  desc: "Issue partial or full refund"
  fields:
    *orderId (input)
    *amount (currency-input)
    *reason (select: duplicate, fraud, customer_request)
    notes (textarea)
```

### 4. Headless Schema Extraction (Aria Crawler)
Extracts UI elements and field metadata from a running app via Playwright:
```bash
node tools/ui-schema-engine/bin/ui-schema.js extract --url http://localhost:3000 --routes /checkout,/refunds --out docs/contracts/views
```

---

## Exit Codes

| Code | Meaning | Agent Action |
|------|---------|--------------|
| `0`  | Success / compliant | Proceed with commit or generation. |
| `1`  | Contract schema or DB drift violation | Fix mismatched field definitions or DB constraints. |
| `3`  | Dependencies not installed | Run `npm ci --prefix tools/ui-schema-engine`. In local pre-commit hooks, this skips gracefully. |
| `4`  | Usage or configuration error | Check file paths, YAML syntax, or CLI flags. |

---

## Safety & Invariants

1. **Self-Contained Installation**: Never add `tools/ui-schema-engine` to root `package.json` workspaces. Install exclusively via `npm ci --prefix tools/ui-schema-engine`.
2. **Schema Canonical Truth**: `schemas/ui-schema.v1.schema.json` is the source of truth for contract syntax. All UI schemas must specify `schemaVersion: "1.0"`.
3. **Fail-Closed in CI**: CI pipelines must treat any exit code `!= 0` as a build blocker.
