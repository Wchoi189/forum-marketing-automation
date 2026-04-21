---
mode: agent
description: "Use when you want to initialize or refresh project-scoped MemPalace indexing for this repository."
---
Run the project memory seed workflow.

Steps:
1. Run `npm run mempalace:seed`.
2. If indexing fails, capture the exact error and suggest the smallest corrective command.
3. Summarize what was indexed and whether follow-up actions are needed.

Constraints:
- Keep indexing scope memory/context-first.
- Do not suggest mining source code unless explicitly requested.
