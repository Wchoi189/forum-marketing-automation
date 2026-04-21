---
mode: agent
description: "Use when you want to finalize session handover, update state index, and refresh MemPalace memory."
---
Finalize handover using the project helper workflow.

Required input:
- handover file path matching `.agent/session-handovers/handover-YYYYMMDD-HHMM.json`

Steps:
1. If no handover file path is provided, ask for it.
2. Run:
   `npm run mempalace:handover -- --file <handover-path>`
3. Confirm:
   - state index updated
   - memory refresh completed
   - retrieval query succeeds
4. Summarize completion and any blockers.

Constraints:
- Preserve local authority precedence (`state.index.json` + handover JSON).
- Never include secrets in handover text.
