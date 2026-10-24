# Archive

Frozen content. Nothing here is loaded by the running system, referenced by
`package.json` scripts, or read by the build. It is kept only so the move out of
the project root stays reversible.

Archived 2026-08-08 as part of the workspace cleanup described in
`.planning/audit/cleanup-requirements-2026-08-08.md`.

| Path | What it was | Why it moved |
|------|-------------|--------------|
| `_bmad/` | BMAD agent skill packs (1.8 MB, 40 files) | Every reference to it came from inside itself. Nothing in `lib/`, `scripts/`, or `config/` reads it. |
| `agent-os/` | Agent OS standards documents | Only referenced by the former root `AGENT-INTEGRATION.md`, whose content now lives in `.agent/ARCHITECTURE.md`. The commands that consumed it moved to `agent-os-commands/` (below). |
| `agent-os-commands/` | `/discover-standards`, `/index-standards`, `/inject-standards`, `/plan-product`, `/shape-spec` project slash commands | Retired 2026-10-24. Each is an ask, draft, confirm loop, which conflicts with the Decision Authority rules in `CLAUDE.md`. The user-level `agent-os:*` plugin skills remain for explicit use. Restore with `git mv archive/agent-os-commands .claude/commands/agent-os`. |
| `AgentQMS/` | MemPalace room descriptor | Contained a single `mempalace.yaml`. `scripts/agent-loop.sh` was updated to stop mining it; the script itself was deleted 2026-10-24 as an unreferenced duplicate of `mempalace-loop.sh`. |
| `.ai/` | SAP Fiori / CAP developer skills | Belongs to a different project. No connection to this codebase. |
| `kakaoauto-controller-preview/` | Nested preview app with its own `vite.config.ts` and `package.json` | Already excluded from the file watcher (`config/watch.ts`) and from VS Code search. A nested project inside the root confuses tooling. Its bundled `kakaoauto-controller.zip` was deleted — recreatable from this source, and recoverable from git history. |

## Deleted rather than archived

These were removed outright; recover from git history if ever needed.

- `.qwen/` — Qwen editor settings, including a stale `settings.json.orig`. Zero references.
- `.dev/` — empty.
- `docs/` — empty.
- `kakaoauto-controller.zip` — 166 KB build output of `kakaoauto-controller-preview/`.

## Deleting this directory

Safe to delete wholesale once no one has asked for anything in it. Suggested
review date: 2027-02-08 (six months after archiving).
