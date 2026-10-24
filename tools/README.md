# tools/

Portable, repository-agnostic toolkits. Declared as a `SOURCE` tree in
[agents_workspace-taxonomy.yaml](../docs/standards/schema/agents_workspace-taxonomy.yaml) 1.2.0
([LOG-DECISION-AGENTS-20260914-1925](../docs/records/decision/20260914-1925_decision_agents_tools-tree-declared.md)).

Each toolkit in this tree:

- has its own `package.json` and committed lockfile, and installs with
  `npm ci --prefix tools/<toolkit>`;
- is **never** a root workspace — root `workspaces` stays `apps/*`, `packages/*`, so a toolkit's
  dependencies stay out of the root lockfile and the production image;
- carries no knowledge of the repository that hosts it: paths, ports and names arrive through a
  config file the host repository owns, so the directory can be copied into another repository
  and run unmodified.

| Toolkit | Spec | Install | Gates it feeds |
|---|---|---|---|
| arch-governance | 076 — FINOS CALM architecture-as-code | `npm ci --prefix tools/arch-governance` | pre-commit, CI (`npm run arch:validate -- --strict`) |
| refactor-engine | 077 — codebase modularization and AST refactoring | `npm ci --prefix tools/refactor-engine` | pre-commit (`audit --staged`), CI (`.github/workflows/refactor-audit.yml`, full `audit`), `verify` after a split — see [refactor-engine.md](../docs/reference/platform/refactor-engine.md) |
| ui-schema-engine | 078 — portable UI schema and field contracts | `npm ci --prefix tools/ui-schema-engine` | pre-commit (`audit` when contracts or schema.sql change), CI (`npm run ui-schema:audit`) |

A toolkit directory appears here when its spec's first implementation task lands.
