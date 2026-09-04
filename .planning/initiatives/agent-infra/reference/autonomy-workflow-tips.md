## Autonomy Workflow Pro Tips

Use this as a lightweight operating checklist for autonomous workers.

1. Keep a three-layer loop: `contracts -> implementation -> verification`.
2. Require every task to declare `goal`, `constraints`, and `done_when`.
3. Use small bounded tasks (30-90 minutes) with observable outputs.
4. Force fail-closed defaults: uncertain state should block risky actions.
5. Add drift sentries in code (runtime validation for route/model presence).
6. Keep one canonical source per contract type and reference it everywhere.
7. Use a reviewer pack for external context; avoid sharing large code dumps.
8. Run lint/tests after substantive edits; treat red checks as stop signals.
9. Keep handovers structured: `what changed`, `why`, `risk`, `next step`.
10. Prefer concise semantics over long prose; high signal beats high volume.

### Operator Cadence (Suggested)

- Daily: check drift, broken contracts, and failing tests.
- Weekly: audit module boundaries and unresolved risk-review findings.
- Per feature: update spec + tests in the same change scope.
