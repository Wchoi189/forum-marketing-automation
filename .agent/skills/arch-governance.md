# Skill: Architecture Governance

**Purpose:** Enforce FINOS CALM architecture-as-code models, validate network/topology guardrails, track egress boundaries, and generate architecture documentation using `@tools/arch-governance`.

**Invocation:** Run as an agent skill when:
- Verifying that architectural changes conform to FINOS CALM models (`arch-governance validate --strict`).
- Validating network topology and connection guardrails (e.g., forbidding direct client-to-database connections).
- Auditing undeclared external host egress in source code.
- Diffing proposed architecture models against baselines (`arch-governance diff`).
- Building visual architecture documentation (`arch-governance docify`).

---

## Capabilities & Commands

The toolkit binary lives at `tools/arch-governance/bin/arch-governance.js`. All commands are run from repository root.

### 1. Model & Guardrail Validation
Validates `system.calm.json` against FINOS CALM schema and runs topological checks:
- **`ARCH-001`**: Client-zone nodes must not connect directly to database nodes.
- **`ARCH-002`**: Egress origin restrictions (only allowed zones may connect to external nodes).
- **`ARCH-003`**: Source code egress audit (every outbound HTTP host in source must be declared in CALM metadata).
```bash
# Strict validation (fails on placeholders and rule breaches)
node tools/arch-governance/bin/arch-governance.js validate --strict

# Machine-readable JSON output for agent analysis
node tools/arch-governance/bin/arch-governance.js validate --strict --json
```

### 2. Architecture Diffing
Compares a proposed architecture model against a baseline model:
```bash
# Markdown diff format
node tools/arch-governance/bin/arch-governance.js diff -a docs/architecture/system.calm.json -b proposed.calm.json --format markdown

# Exit non-zero if differences exist
node tools/arch-governance/bin/arch-governance.js diff -a base.calm.json -b candidate.calm.json --exit-code
```

### 3. Documentation Generation (`docify`)
Renders visual diagrams and documentation from the CALM model:
```bash
node tools/arch-governance/bin/arch-governance.js docify -o dist/architecture --base-url /docs/architecture/ --build
```

---

## Exit Codes

| Code | Meaning | Agent Action |
|------|---------|--------------|
| `0`  | Success / compliant | Model conforms to CALM schema and guardrails. |
| `1`  | CALM syntax or pattern mismatch | Fix node/relationship schema or pattern definition. |
| `2`  | Guardrail or topology breach | Forbidden edge detected (e.g. client connecting directly to DB, or undeclared egress host). |
| `3`  | Dependencies not installed | Run `npm ci --prefix tools/arch-governance`. In local pre-commit hooks, this skips gracefully. |
| `4`  | Usage or configuration error | Missing config file, invalid flags, or missing model path. |

---

## Safety & Invariants

1. **Self-Contained Installation**: Never install `@finos/calm-cli` in root. Install exclusively via `npm ci --prefix tools/arch-governance`.
2. **Egress Transparency**: Every new third-party host called in application code must be registered under an external node in `system.calm.json`.
