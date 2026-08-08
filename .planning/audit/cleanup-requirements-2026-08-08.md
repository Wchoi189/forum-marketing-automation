# Requirements — Feedback Resolution + Workspace Cleanup

**Date:** 2026-08-08
**Source:** `.planning/audit/implementation-feedback-2026-08-08.md`
**Status:** Implemented 2026-08-08. See "Outcomes" at the end for what shipped,
what changed from the plan, and what was left out.
**Approved decisions:** untrack generated data (no history rewrite) · consolidate docs into `.agent/`, archive dead tooling · migrate all shim importers and delete shims

---

## Summary of Findings

Investigation changed two of the feedback document's conclusions and surfaced one unreported defect.

| # | Feedback claim | Actual finding |
|---|---|---|
| 1 | "5 integration tests fail with EACCES — `artifacts/` needs permissions" | Misdiagnosed. `artifacts/` is `drwxrwxr-x qubit:qubit` and writable. Real cause: `.env` line 3 sets `ARTIFACTS_DIR="/parent/marketing-automation/artifacts"`, a path that does not exist on this host. `tsx` auto-injects `.env`; `test:integration` overrides `PROJECT_ROOT=.` but **not** `ARTIFACTS_DIR`, so the stale absolute path wins. All 5 failures are one root cause. |
| — | _(not reported)_ | `rotateArtifacts()` deletes **every** top-level directory under `ARTIFACTS_DIR` older than 7 days, despite its docstring claiming "publisher-run artifact directories". It will delete `artifacts/competitor-ads/` (13 MB, contains `competitor-ads.db`), `kakao-history/`, `board-diagnostics/`, `scheduler-replay/`, `screenshots/`. |

---

## R1 — Fix Integration Test Environment (High)

**Root cause evidence:**

```
ERR Error: EACCES: permission denied, mkdir '/parent/marketing-automation'
    at async writeFileAtomic (lib/state/persistence.ts:86:3)
    at async persistState (lib/state/persistence.ts:169:5)
```

Failure map — all 5 trace to the same write:

| Test | Symptom | Path |
|---|---|---|
| `POST /api/control-panel updates publisher.draftItemIndex` | 500 ≠ 200 | `persistState` throws |
| `POST /api/control-panel enforces expectedVersion concurrency` | 500 ≠ 200 | `persistState` throws |
| `POST /api/control-panel persists gapPersistedOverride` | 500 ≠ 200 | `persistState` throws |
| `nl-command live set_gap_threshold` | 503 ≠ 200 | `dispatch_failed` at [routes/api/nl.ts:152](routes/api/nl.ts#L152) |
| `nl-command live pause_scheduler` | 503 ≠ 200 | `dispatch_failed` at [routes/api/nl.ts:152](routes/api/nl.ts#L152) |

**Requirements**

- **R1.1** — `test:integration` and `test:unit` in [package.json](package.json) MUST set `ARTIFACTS_DIR` to a per-run temp directory (e.g. `ARTIFACTS_DIR=/tmp/ma-test-artifacts`), alongside the existing `PROJECT_ROOT=.` override.
- **R1.2** — Tests MUST NOT inherit developer `.env` values. Preferred: pass `--env-file=/dev/null` or set `DOTENV_CONFIG_PATH`; at minimum every path-shaped env var the tests depend on must be explicitly overridden in the script.
- **R1.3** — The temp artifacts dir MUST be created before and removed after the run so state does not leak between runs (`stateVersion` is monotonic and cross-run leakage breaks the `expectedVersion` concurrency test).
- **R1.4** — [scripts/demo-extraction.ts:14](scripts/demo-extraction.ts#L14) hardcodes `/parent/marketing-automation/artifacts/competitor-ads/...`. MUST be replaced with `ENV.ARTIFACTS_DIR`-derived path.
- **R1.5** — Add a repo-wide guard against reintroduction: an ast-grep rule under [.ast-grep/rules/](.ast-grep/rules/) (config already wired via [sgconfig.yml](sgconfig.yml)) forbidding string literals beginning `/parent/`.

**Acceptance:** `npm run test:integration` reports `pass 43 / fail 0` on a clean checkout with the current `.env` present and unmodified.

**Non-goal:** changing filesystem permissions on `artifacts/`. Nothing is wrong with them.

---

## R2 — Fix Over-Broad Garbage Collection (High — data loss risk)

**Evidence:** [lib/resourceMonitor.ts:104-126](lib/resourceMonitor.ts#L104-L126) iterates all of `readdir(ARTIFACTS_DIR)` and `rm -rf`s any directory whose `mtime` is older than `MAX_ARTIFACT_AGE_DAYS = 7`. There is no filter restricting it to `publisher-runs/`. [capArtifactsBySize()](lib/resourceMonitor.ts#L139) has the same blast radius, deleting oldest-first until under 500 MB.

Current on-disk mtimes make this live, not theoretical:

| `artifacts/` entry | mtime | Fate under next production GC |
|---|---|---|
| `competitor-ads/` (13 MB, `competitor-ads.db`) | Jun 20 | **deleted** |
| `kakao-history/` | Jun 20 | **deleted** |
| `board-diagnostics/` | Jun 20 | **deleted** |
| `scheduler-replay/` | Jun 20 | **deleted** |
| `screenshots/` | Jun 20 | **deleted** |

GC runs at startup and every 6 h when `NODE_ENV=production && !DEV_SKIP_BOT` ([server.ts:186](server.ts#L186), [server.ts:199-211](server.ts#L199-L211)).

**Requirements**

- **R2.1** — GC MUST operate on an explicit allowlist of ephemeral subtrees, not on "everything under `ARTIFACTS_DIR`". Proposed ephemeral set: `publisher-runs/`, `screenshots/`, `board-diagnostics/`, `scheduler-replay/` (all but `latest*`).
- **R2.2** — Durable subtrees MUST be exempt from both `rotateArtifacts` and `capArtifactsBySize`: `competitor-ads/`, `kakao-history/`, and the loose files `publisher-history.json`, `runtime-controls.json`, `browser-storage-state.json`.
- **R2.3** — The allowlist MUST live in one exported constant so tests can assert it.
- **R2.4** — `rotateArtifacts`'s docstring and the `/api/resource/gc` response MUST name what was deleted, not just a count.
- **R2.5** — Add a unit test that seeds a fake artifacts tree containing a durable dir with an ancient mtime and asserts it survives GC.
- **R2.6** — Minor, same file: [dirSize()](lib/resourceMonitor.ts#L365) splits on `'\\t'` (literal backslash-t) rather than a tab. It works only because `parseInt` stops at the first non-digit. Fix to `'\t'` or use `stdout.trim().split(/\s/)[0]`.

**Acceptance:** GC unit test passes; a production-mode startup with all current `artifacts/` contents deletes nothing.

---

## R3 — Retire Deprecation Shims (Medium)

`lib/controls.ts` (16 lines) and `lib/runtimeControls.ts` (190 lines) are `@deprecated` re-export shims over `lib/state/`. Twelve live importers:

```
bot.ts                        lib/state/persistence.ts
server.ts                     lib/observer/policyLoader.ts
routes/api/nl.ts              lib/observer/observerRun.ts
routes/api/ai.ts              lib/publisher/publisherRun.ts
routes/api/control.ts         lib/publisher/flow/runPublisherFlow.ts
tests/integration/nlWebhook.test.ts
tests/integration/api.integration.test.ts
```

**Requirements**

- **R3.1** — All 12 MUST be rewritten to import from `lib/state/index.js` directly.
- **R3.2** — `lib/state/persistence.ts` importing a shim that re-exports `lib/state` is a latent cycle and MUST be resolved first, before the other 11.
- **R3.3** — Both shim files MUST be deleted once importers are migrated. Do not leave `@deprecated` stubs — the approved decision is full removal.
- **R3.4** — `npm run lint` MUST be run after each file batch (both `tsc` passes complete in under 2 s).

**Acceptance:** `grep -rn "controls.js\|runtimeControls.js" --include=*.ts .` returns nothing outside `node_modules`; `npm test` green.

---

## R4 — Update Specs and Module Boundaries (Medium)

- **R4.1** — `.planning/spec-kit/specs/module-boundaries.json` MUST declare `lib/state/` and `lib/scheduler/` as module boundaries.
- **R4.2** — The same spec MUST record that `lib/controls.ts` / `lib/runtimeControls.ts` no longer exist (see R3).
- **R4.3** — Barrel exports MUST be added for `lib/competitor-intel/` and `lib/parser/`, matching the existing `lib/publisher/index.ts` and `lib/observer/index.ts` pattern.
- **R4.4** — The `tsconfig.json` (src-only) vs `tsconfig.server.json` (lib/tests/routes) split MUST be documented in a header comment in each file. Do not merge them — the split is load-bearing for the Vite/Node boundary.

---

## R5 — Runtime Backward-Compatibility Verification (High)

Phases 1–6 were structural; nothing has been exercised at runtime since.

- **R5.1** — Start the server (`npm run dev`, `DEV_SKIP_BOT=true`) and confirm `GET /api/control-panel` returns full state.
- **R5.2** — Confirm `POST /api/control-panel` persists and `GET` reflects the change (this is the path R1 proved is currently broken under `.env`).
- **R5.3** — Load the Controls view in the dashboard and confirm settings round-trip.
- **R5.4** — Confirm `GET /api/health/resources` reports non-zero artifact size.

---

## R6 — Git Hygiene: Untrack Generated Data (High)

Approved: untrack and gitignore; **no history rewrite** (existing clones and SHAs stay valid; repo stops growing but does not shrink).

| Path | Tracked | Size | Action |
|---|---|---|---|
| `artifacts/` | 347 files | 13 MB | `git rm -r --cached`, gitignore whole dir |
| `data/kakao_chat_records_2026-04-18/` | 156 files | ~4.7 MB | `git rm -r --cached`, gitignore |
| `data/kakao-processed/`, `kakao-annotated/`, `kakao-kb/` | 3 files | small | gitignore — all are script outputs |
| `dist/` | 0 | 2.6 MB | already ignored, verify |

**Requirements**

- **R6.1** — Files MUST remain on disk after untracking (`--cached` only). `lib/competitor-ad-sqlite.ts` and the kakao scripts read these paths at runtime.
- **R6.2** — `.gitignore` currently has duplicate `activity_log.json` and `ppomppu_profile/` entries and two stale negations (`!.planning/spec-kit/`, `!.agent/` negate nothing above them). It MUST be rewritten cleanly as part of this change.
- **R6.3** — `data/` provenance MUST be documented — which script produces each subdir, and whether the raw chat records are reproducible or are the only copy. **If `kakao_chat_records_2026-04-18` is irreplaceable source data, R6 does not apply to it and it stays tracked.** This is the one open question below.
- **R6.4** — After untracking, `git ls-files | wc -l` MUST drop by roughly 500.

---

## R7 — Root Directory Consolidation (Medium)

Current root: 21 loose files + 36 directories, of which 10 are agent-tooling config.

### 7a. Documentation

| File | Action |
|---|---|
| `README.md` | Keep at root — human entry point |
| `CLAUDE.md` | Keep at root — Claude Code loads it by path convention. Do **not** move to `.agent/` (the feedback doc's suggestion would break automatic loading) |
| `AGENTS.md` | Keep at root — same reason, cross-tool convention |
| `AGENT-INTEGRATION.md` | Merge into `.agent/ARCHITECTURE.md`, delete. Its content is agent-os command wiring, already partly duplicated |
| `metadata.json` | 194 bytes. Inline into `package.json` or move to `.agent/`, delete from root |

### 7b. Tooling directories

Verified by grepping for `<dir>/` in code and config, excluding self-references:

| Dir | Size | Live references | Action |
|---|---|---|---|
| `.claude/` | — | active | **Keep** |
| `.github/` | — | CI | **Keep** |
| `.vscode/` | — | active | **Keep** |
| `.ast-grep/` | 32 K | [sgconfig.yml](sgconfig.yml) | **Keep** — and it gains a job under R1.5 |
| `.planning/` | — | active | **Keep** |
| `.agent/` | 368 K | active | **Keep** — see 7c |
| `.cursor/` | — | none in code | Keep if Cursor is still used; else archive |
| `agent-os/` | 36 K | only from `AGENT-INTEGRATION.md` (itself being deleted) | **Archive** |
| `_bmad/` | 1.8 M | only self-referential (`_bmad/**/SKILL.md`) | **Archive** — largest single dead-weight dir |
| `AgentQMS/` | 8 K | 1 file: `mempalace.yaml`; referenced by `scripts/agent-loop.sh:30` | **Archive** — update the script |
| `.ai/` | 68 K | SAP Fiori skills, self-referential only; unrelated to this project | **Archive** |
| `.qwen/` | 12 K | zero references; contains `settings.json.orig` | **Delete** |
| `.dev/` | 20 K | **empty** (0 files) | **Delete** |
| `docs/` | 4 K | **empty** (0 files) | **Delete** |
| `.mempalaceignore` | 804 B | mempalace tooling | Keep or drop with `AgentQMS` |

### 7c. `.agent/session-handovers/`

49 JSON handovers, oldest `20260331`. This is an append-only log with no rotation — the clutter pattern that motivated this whole document.

- **R7.1** — Retain the most recent 10 plus `template.json`; move the rest to `.agent/session-handovers/archive/`.
- **R7.2** — A retention rule MUST be documented in `.agent/README.md`, and `scripts/mempalace-loop.sh handover` SHOULD enforce it on write.

### 7d. Build/preview leftovers

| Path | Size | Action |
|---|---|---|
| `kakaoauto-controller.zip` | 166 K | Delete — a bundle of `kakaoauto-controller-preview/`, recreatable |
| `kakaoauto-controller-preview/` | 288 K, 22 tracked | Nested project with its own `vite.config.ts`; already excluded in [config/watch.ts:18](config/watch.ts#L18) and `.vscode/settings.json`. Move to `archive/` or split to its own repo |
| `scratch/` | 3 files | Two Korean project-intro drafts + one crash analysis. Move the intro docs to `.planning/`, delete the rest, gitignore `scratch/` |
| `examples/` | 1 file | Fold `mcp-parser-calls.json` into `mcp/`, delete dir |

### 7e. Env files

Root carries `.env`, `.env.docker`, `.env.example`, `.env.docker.example`. `.env` and `.env.docker` are gitignored but both contain the `/parent/marketing-automation` path that caused R1.

- **R7.3** — `.env.example` MUST NOT ship an absolute host path. Change `PROJECT_ROOT="/parent/marketing-automation"` to a relative default or leave it unset.
- **R7.4** — The developer's own `.env` SHOULD be corrected to this repo's real path, but R1 must not depend on that — the test fix has to work with the bad `.env` in place.

### Target root

```
/  README.md  CLAUDE.md  AGENTS.md  package.json  package-lock.json
   tsconfig.json  tsconfig.server.json  vite.config.ts  sgconfig.yml
   Dockerfile  docker-compose.yml  docker-entrypoint.sh  Makefile
   index.html  .env.example  .env.docker.example  .gitignore  .dockerignore
   bot.ts  server.ts
/.agent/ .planning/ .claude/ .github/ .vscode/ .ast-grep/
/archive/          # _bmad, agent-os, AgentQMS, .ai, kakaoauto-controller-preview
/config/ contracts/ lib/ routes/ src/ scripts/ tests/ mcp/ ops/ storage/ templates/
/artifacts/ data/ dist/ node_modules/ ppomppu_profile/    # all gitignored
```

Loose root files: 21 → 20, but root *directories* 36 → ~20, and 10 agent-tooling dirs → 6.

---

## R8 — Ongoing Garbage Collection (Medium)

R2 fixes GC correctness; this makes it cover the directories that actually accumulate.

- **R8.1** — `runGarbageCollection()` SHOULD additionally rotate `.agent/session-handovers/` per R7.1.
- **R8.2** — A `npm run clean:all` script SHOULD prune `dist/`, `artifacts/publisher-runs/`, `scratch/`, and `*.tmp` leftovers from `writeFileAtomic` crashes (`runtime-controls.json.<pid>.<ts>.tmp` files are never cleaned on failure — see [lib/state/persistence.ts:86-97](lib/state/persistence.ts#L86-L97)).
- **R8.3** — `writeFileAtomic` SHOULD remove its temp file in a `catch`/`finally` so failed writes do not leave orphans. Directly relevant: every R1 failure left one behind.
- **R8.4** — Retention policy for each generated directory MUST be written into `.agent/OPERATIONS.md` as a single table.

---

## Sequencing

Ordered by dependency, not priority. R1 first because nothing else is verifiable while the test suite is red.

1. **R1** — test env fix → suite green, gives a working regression net
2. **R2** — GC blast radius → do before any GC runs in production
3. **R6** — untrack generated data → do before moving files, so moves produce small diffs
4. **R7** — root consolidation
5. **R3** — shim migration → mechanical, guarded by R1's green suite
6. **R4** — spec updates → reflects R3's end state
7. **R5** — runtime verification → final gate
8. **R8** — ongoing GC → last, encodes the new layout

R2 is independent of R1 and can proceed in parallel.

---

## Risks

| Risk | Mitigation |
|---|---|
| Untracking `artifacts/` breaks a build step that expects committed fixtures | Grep for `artifacts/` in `.github/workflows/` and `Dockerfile` before R6 |
| `archive/` becomes the new junk drawer | Give it a `README.md` stating contents are frozen and deletable after a stated date |
| Deleting `_bmad/` breaks an agent workflow not visible in code | Archive rather than delete; recoverable via git |
| Shim migration touches 12 files including 2 test files | `npm run lint` after each batch; R1 must land first |
| GC allowlist omits a directory that then grows unbounded | R8.4's retention table forces an explicit decision per directory |

---

## Open Question — resolved

**Is `data/kakao_chat_records_2026-04-18/` (156 files) reproducible?** Answered
2026-08-08: backed up outside the repo, along with
`kakaoauto-controller-preview/`. R6 applied in full.

---

# Outcomes

## Two corrections to this document

**1. R2 was wrong.** This document claimed `rotateArtifacts()` would delete
`artifacts/competitor-ads/` and other durable directories. It would not.
`lib/resourceMonitor.ts:9` defines a module-local
`ARTIFACTS_DIR = path.join(ENV.ARTIFACTS_DIR, 'publisher-runs')` that shadows
the config value, so GC was already correctly scoped. The claim came from
reading `readdir(ARTIFACTS_DIR)` without checking the local binding. **There was
no data-loss bug.**

What shipped instead: the shadowing constant was renamed to
`PUBLISHER_RUNS_DIR` so the next reader cannot make the same mistake, and
`tests/unit/resourceMonitor.test.ts` now pins the scope — it seeds durable
directories with ancient mtimes and asserts they survive both `rotateArtifacts()`
and `capArtifactsBySize(0)`.

**2. R4.3 was stale.** `lib/parser/index.ts` and `lib/competitor-intel/index.ts`
already existed. No barrels needed adding; the boundaries spec gained an
`entry_points` map documenting all six instead.

## R1 — root cause was one level deeper than diagnosed

The trigger was `.env` supplying a nonexistent `ARTIFACTS_DIR`, but the
*mechanism* was `config/env.ts:5` calling `dotenv.config({ override: true })`.
That flag makes the `.env` file clobber explicit process environment, so the
`PROJECT_ROOT=.` override in `test:integration` was overwritten before it could
take effect — and no amount of adding variables to the npm script would have
helped.

Changed to plain `dotenv.config()`. Explicit environment now wins, which is also
what Docker and CI need: `docker-compose.yml` sets `ARTIFACTS_DIR=/app/data/artifacts`
and that value was previously being discarded whenever a `.env` was present in
the image.

Removing the flag unmasked a second defect that had been hidden behind the 500s:
`routes/api/control.ts` checked `error instanceof RuntimeControlsVersionConflictError`,
a class defined in the `lib/runtimeControls.ts` shim, while the write path threw
`StateVersionConflictError` from `lib/state/types.ts`. The check never matched,
so version conflicts returned **500 instead of 409**. Fixed by R3's shim deletion.

| Test suite | Before | After |
|---|---|---|
| `test:unit` | 21 pass | 55 pass |
| `test:integration` | 38 pass / 5 fail | 62 pass |
| `test:mcp:parser` | 1 pass | 1 pass |
| `test:competitor-intel` | **never ran** | 119 pass / 2 environmental |

## Additional defects found and fixed

Not in the original requirements; found while implementing.

| Defect | Fix |
|---|---|
| `test:competitor-intel` silently never ran — Node v20's `--test` rejects glob patterns (added in v21), exiting before any test | `scripts/run-tests.sh` expands globs in bash before invoking node |
| Four unit files (`aiAdvisor`, `parser-session`, `rateLimit`, `trendInsights`) and `bot-stability.test.ts` were never referenced by any npm script | `test:unit` now globs `tests/unit/*.test.ts`; `bot-stability` added to `test:integration` |
| `README.md` referenced `examples/competitor-ads-intel.sample.csv`, which does not exist | Replaced with an instruction to supply your own CSV |
| GC response and startup log omitted the new cleanup counters | `POST /api/resource/gc` now returns `tempFilesRemoved`, `handoversArchived`, `browserRecycled` |

## What shipped

| Req | Outcome |
|---|---|
| R1 | `dotenv` override removed; `scripts/run-tests.sh` gives tests a temp `ARTIFACTS_DIR` with `trap` cleanup; `scripts/demo-extraction.ts` de-hardcoded; `.ast-grep/rules/no-absolute-host-paths.yml` added |
| R2 | Premise retracted (above). Constant renamed, scope test added, `dirSize()` tab-split bug fixed |
| R3 | All 12 importers migrated; `lib/controls.ts` and `lib/runtimeControls.ts` deleted; shim-only logic moved into new `lib/state/nlWebhook.ts` and `lib/state/controlPanel.ts` |
| R4 | `module-boundaries.json` gained `runtime_state` and `scheduler` modules, a `barrel_exports` entry-point map, and a `removed_modules` record; both tsconfigs documented (kept separate — bundler vs NodeNext resolution cannot be merged) |
| R5 | Verified live: `GET` 200, `POST` 200 with round-trip persistence (v97→v98), stale write returns **409** (was 500), `GET /api/health/resources` 200, `POST /api/resource/gc` 200 |
| R6 | 506 files untracked, all intact on disk; `.gitignore` rewritten with deduplicated rules and provenance comments; `.env.docker.example` is now tracked (previously ignored by accident) |
| R7 | Root: 27 loose files → 24, 36 directories → 25 |
| R8 | `cleanOrphanedTempFiles()` and `rotateSessionHandovers()` added to `runGarbageCollection()`; `writeFileAtomic` now removes its temp file on failure; `npm run clean:all` added with `--dry-run`; retention table written into `.agent/OPERATIONS.md` |

### Root directory changes

Archived to `archive/` (see `archive/README.md`): `_bmad/`, `agent-os/`,
`AgentQMS/`, `.ai/`, `kakaoauto-controller-preview/`.

Deleted: `.qwen/`, `.dev/` (empty), `docs/` (empty), `kakaoauto-controller.zip`,
`AGENT-INTEGRATION.md` (merged into `.agent/ARCHITECTURE.md`).

Relocated: `metadata.json` → `.agent/`, `examples/` → `mcp/examples/`,
`scratch/` contents → `.planning/` and `.planning/known-issues/`.

`.agent/session-handovers/` rotated 49 → 10 active, 35 in `archive/`,
now enforced automatically by GC.

`CLAUDE.md` and `AGENTS.md` stayed at root — both are loaded by path convention,
and this document's original suggestion to fold `CLAUDE.md` into `.agent/` would
have broken that.

## Caveats

- **`.ast-grep/rules/no-absolute-host-paths.yml` is unverified.** No ast-grep
  binary is installed on this machine (`/usr/bin/sg` is util-linux's `sg`, not
  ast-grep). The rule is written against the documented schema but has never
  been executed. Run `sg scan --rule .ast-grep/rules/no-absolute-host-paths.yml`
  once the binary is available.
- **Two `ocr-vlm.test.ts` cases fail without a local Ollama server** (`fetch
  failed`). Pre-existing and environmental. Noted in `tests/README.md`.
- **The developer `.env` was repointed** from `/parent/marketing-automation` to
  `/home/qubit/workspace/marketing-automation`. It is gitignored, so this is a
  local-machine change only. Before it, live `POST /api/control-panel` returned
  500 on this machine.
- **`git rm --cached` does not shrink existing clones.** History still contains
  the 13 MB of artifacts. Only a `git-filter-repo` rewrite would reclaim that,
  and it was explicitly declined.
