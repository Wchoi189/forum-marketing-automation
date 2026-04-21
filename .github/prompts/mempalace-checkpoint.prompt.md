---
mode: agent
description: "Use when you want to checkpoint session memory and verify retrievability in MemPalace."
---
Run the checkpoint workflow and confirm retrieval quality.

Steps:
1. Run `npm run mempalace:checkpoint`.
2. Report whether indexing and retrieval succeeded.
3. If retrieval output is noisy or irrelevant, suggest one targeted query refinement.

Constraints:
- Keep scope memory/context-only unless user explicitly asks to include source code.
- Do not include secrets in any stored memory suggestions.
