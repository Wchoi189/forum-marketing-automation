---
mode: agent
description: "Use when you want to restore session context for this repo via MemPalace wake-up."
---
Run the project wake-up workflow and summarize current context.

Steps:
1. Run `npm run mempalace:wake-up`.
2. Report the key context returned by wake-up:
   - active workflow
   - active forum
   - last handover
   - next immediate action
3. If wake-up fails, propose the minimal recovery path (usually seed first).

Constraints:
- Treat `.agent/state/state.index.json` and latest handover JSON as local authority.
- If MemPalace context conflicts with local authority, note the conflict and prioritize local files.
