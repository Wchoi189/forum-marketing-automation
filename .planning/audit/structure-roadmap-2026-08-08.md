# Structure & Organization Roadmap

**Date:** 2026-08-08
**Author:** Claude (post-implementation review of the cleanup in `cleanup-requirements-2026-08-08.md`)
**Status:** Part 6 steps 1–5 shipped (2026-08-09). Steps 6–9 open.

| Step | State |
|---|---|
| 1 Re-enable CI | Done — `.github/workflows/ci.yml`, PR #2 |
| 2 Ollama tests | Done — gated behind a reachability probe, PR #2 |
| 3 ast-grep in CI | Done — `@ast-grep/cli` devDependency, `ast-grep scan` in `npm run lint`, PR #2 |
| 4 `.structure.json` + validator | Done — `scripts/check-structure.ts`, `npm run lint:structure`, own CI step |
| 5 Pre-commit hook | Done — `scripts/hooks/pre-commit`, installed by `npm run hooks:install` |
| 6–9 | Open, see Part 6 |

Step 4 shipped wider than "root allowlist only": placement rules, module entry
points, and size budgets are all checked. Module entry points run as a **ratchet**
rather than a hard gate — 82 cross-module imports already exist, so the count is
recorded as `module_boundary_baseline` and only an increase fails. Step 7 lowers it.

Companion documents:
- `.planning/audit/codebase-feedback-2026-08-08.md` — original architecture audit
- `.planning/audit/implementation-feedback-2026-08-08.md` — refactor execution notes
- `.planning/audit/cleanup-requirements-2026-08-08.md` — what was just implemented

---

## Part 1 — Remaining Work

### Blocked on tooling

| # | Item | Detail |
|---|---|---|
| 1 | **Verify the ast-grep rule** | `.ast-grep/rules/no-absolute-host-paths.yml` was written but never executed — no ast-grep binary on this machine (`/usr/bin/sg` is util-linux's `sg`). Install (`npm i -D @ast-grep/cli`) and run `sg scan`. Until then the guard is decorative. The same applies to the five pre-existing rules — **none of them have ever run in CI.** |
| 2 | **Ollama-dependent tests** | Two cases in `tests/unit/competitor-intel/ocr-vlm.test.ts` fail with `fetch failed` when no local Ollama is running. Either gate them behind a reachability probe that skips cleanly, or move them to a separate `test:ollama` script excluded from `npm test`. Right now `test:competitor-intel` can never be green in CI. |

### Correctness / hygiene

| # | Item | Detail |
|---|---|---|
| 3 | **Re-enable CI** | `.github/workflows/deploy-aws.yml.disabled` has been disabled since 2026-05-09 ("Competitor Intelligence feature preview complete. Needs additional testing."). It already contains `npm run lint` + `npm run test:integration`. **Nothing has gated a change for three months.** See Part 3 — this is the root cause of everything else in this document. |
| 4 | **`src/AnalyticsPage.tsx` (799 lines)** | Largest frontend file, and the only page still outside `src/pages/`. `src/App.tsx` was already decomposed from ~1800 lines down to 156; this file did not get the same treatment. |
| 5 | **`routes/api/logs.ts` (569 lines)** | Largest route file by a wide margin — the next is `control.ts` at 467. Worth checking whether it is doing analytics work that belongs in `lib/`. |
| 6 | **Spec lifecycle** | 55 files in `.planning/spec-kit/specs/`. **35 have no `status` field at all**; the 20 that do use seven different vocabularies: `done`, `implemented`, `active`, `ACTIVE`, `IN_PROGRESS`, `proposed`, `draft`. Nine are marked complete but still sit beside in-flight specs. |
| 7 | **`lib/` flat files** | 24 loose `.ts` files against 8 subdirectories. Several are obvious clusters — see Part 5. |

### Deferred by decision

| # | Item | Why deferred |
|---|---|---|
| 8 | Git history rewrite | 13 MB of untracked artifacts still live in history. `git rm --cached` stops growth but does not shrink clones. Only `git-filter-repo` reclaims it, and it rewrites every SHA. Explicitly declined. |
| 9 | `archive/` deletion | Review date 2027-02-08 per `archive/README.md`. |

---

## Part 2 — Pain Points Encountered

Concrete friction from this session, with the generalizable lesson.

### 2.1 Config that silently overrides explicit intent

`config/env.ts` called `dotenv.config({ override: true })`. That single flag made the `.env` file beat explicitly-set process environment. Consequences:

- Five integration tests failed for weeks and were misdiagnosed as an `artifacts/` **permission** problem. The previous investigation stopped at the `EACCES` string without asking *why the path was `/parent/marketing-automation`* on a machine where the project lives elsewhere.
- `docker-compose.yml` sets `ARTIFACTS_DIR=/app/data/artifacts`. That value was being discarded whenever a `.env` was present in the image.
- No amount of adding variables to the npm test script could have fixed it — the fix had to be in `config/env.ts`.

**Lesson:** precedence inversions are invisible at the call site. The test script *looked* correct. Anything that makes a lower-priority source win must be loudly commented or not exist. It is now commented in place.

### 2.2 Compatibility shims that duplicate types

`lib/runtimeControls.ts` defined its own `RuntimeControlsVersionConflictError` while the code that actually threw used `StateVersionConflictError`. `routes/api/control.ts` checked `instanceof` against the shim's class. It never matched, so **HTTP 409 responses silently became 500s.**

TypeScript could not catch this: both classes are structurally identical, and `instanceof` against an `unknown` in a catch block is always type-valid.

**Lesson:** a shim may re-export, alias, and rename. It must never *define* a type or class the real module also defines. This is now recorded in `module-boundaries.json` under `removed_modules` and in the `refactor_policy`.

### 2.3 Failures masking failures

The 409-vs-500 bug was invisible while the environment bug existed — both produced a 500. Fixing the environment revealed it immediately.

**Lesson:** a persistently red suite has unknown depth. "5 failing tests" was actually "1 environment bug + 1 real defect + an entire suite that never ran". Treat a red suite as a blocker, not a known condition.

### 2.4 Test scripts that lie about what they run

Three separate discoveries, all in the same afternoon:

- `test:competitor-intel` passed a glob to `node --test`. **Glob support landed in Node v21; this project runs v20.** Node printed `Could not find '<pattern>'` and exited. 121 tests had not run in however long that script has existed.
- Five test files (`aiAdvisor`, `parser-session`, `rateLimit`, `trendInsights`, `bot-stability`) were referenced by no npm script at all. Wiring them in raised the suite from 65 tests to 118 — **a 45% coverage increase from configuration alone, no new tests written.**
- `test:unit` listed files individually, so every new test file needed a `package.json` edit that nobody remembered to make.

**Lesson:** enumerating test files by hand guarantees drift. Glob at the directory level and let the filesystem be the source of truth. And a test runner that exits 1 on "no files matched" is not optional.

### 2.5 Documentation that drifts silently

`CLAUDE.md` described `src/App.tsx` as "All dashboard state, routing, and API calls (~1800 lines)". Actual: **156 lines**, decomposed into `src/pages/` and `src/hooks/` some time ago. The doc also credited `App.tsx` with polling behavior that now lives in `useAppData.ts`.

`implementation-feedback-2026-08-08.md` recommended adding barrel exports to `lib/parser/` and `lib/competitor-intel/`. Both already had them.

I made the same class of error myself: I claimed in the requirements document that GC would delete `artifacts/competitor-ads/`, having misread a module-local `ARTIFACTS_DIR` that shadows the config value. **A human reader and an AI reader make identical mistakes when the code contradicts the map.**

**Lesson:** prose that restates facts derivable from code will drift, and drifted docs are worse than no docs — they actively mislead. See Part 3.4 for the fix.

### 2.6 Shadowed names

```typescript
// lib/resourceMonitor.ts — before
const ARTIFACTS_DIR = path.join(ENV.ARTIFACTS_DIR, 'publisher-runs');
```

A module-local constant with the same name as the config value it narrows. Every `readdir(ARTIFACTS_DIR)` in that file reads as if it scans all artifacts. It cost me a wrong finding in a requirements document that a reviewer might have acted on. Renamed to `PUBLISHER_RUNS_DIR`.

**Lesson:** never shadow a config key with a local that means something narrower. Name the narrowing.

### 2.7 No enforcement anywhere

- No active CI (`.github/workflows/` contains one `.disabled` file)
- No git hooks (`.git/hooks/` is stock samples only)
- No `.claude/settings.json` with hooks (only `settings.local.json`)
- ast-grep rules exist but nothing runs `sg scan`

Every convention in this project is advisory. That is the whole story of Part 3.

---

## Part 3 — The Root Cause, and a Permanent Fix

> *"It is a matter of time before more files are created in the root and clutter multiplies."*

Correct, and the mechanism is precise.

### 3.1 Why clutter is inevitable today

Adding a file to the project root costs **nothing**. No check fails. No review comment fires. The commit goes green — because nothing is green or red at all.

Meanwhile, *not* adding it costs real effort: you must know the convention exists, find where it is written, decide which of `.agent/`, `.planning/`, `docs/`, or `lib/` applies, and be confident enough to not just drop the file at the root.

**When the wrong action is free and the right action costs thought, entropy wins by default.** Every cleanup is a one-time payment against a permanent leak. This session removed 11 root directories; without a mechanism, they will return.

Documentation cannot fix this. `CLAUDE.md` already said where things go, and the root still accumulated `kakaoauto-controller.zip`, `metadata.json`, `AGENT-INTEGRATION.md`, `scratch/`, and eight dead agent-tooling directories. **A rule nobody is forced to read is a rule nobody follows** — and Part 2.5 shows the rule was itself wrong about the codebase.

### 3.2 The fix: make structure a build artifact, not a convention

Invert the cost. Make the wrong action fail loudly and the right action obvious.

Three pieces, in dependency order:

**1. A machine-readable structure manifest** — one file declaring what may exist where.

```jsonc
// .structure.json
{
  "root": {
    "policy": "allowlist",
    "rationale": "Anything not listed here belongs in a subdirectory. Adding an entry requires a reason in the PR description.",
    "allowed_files": [
      "README.md", "CLAUDE.md", "AGENTS.md",
      "package.json", "package-lock.json",
      "tsconfig.json", "tsconfig.server.json", "vite.config.ts", "sgconfig.yml",
      "Dockerfile", "docker-compose.yml", "docker-entrypoint.sh", "Makefile",
      "index.html", "server.ts", "bot.ts",
      ".gitignore", ".dockerignore", ".mempalaceignore",
      ".env.example", ".env.docker.example", ".structure.json"
    ],
    "allowed_dirs": [
      ".agent", ".planning", ".claude", ".github", ".vscode", ".ast-grep", ".cursor",
      "archive", "config", "contracts", "lib", "routes", "src", "scripts",
      "tests", "mcp", "ops", "storage", "templates",
      "artifacts", "data", "dist", "node_modules", "ppomppu_profile", ".git"
    ]
  },
  "placement_rules": [
    { "pattern": "*.md",   "deny_at_root": true, "goes_to": ".agent/ (agent-facing) or .planning/ (specs, audits)", "except": ["README.md", "CLAUDE.md", "AGENTS.md"] },
    { "pattern": "*.zip",  "deny_anywhere": true, "reason": "Build outputs are not versioned. Rebuild from source." },
    { "pattern": "*.orig", "deny_anywhere": true, "reason": "Merge/backup leftovers." },
    { "pattern": "*.bak*", "deny_anywhere": true, "reason": "Use git." }
  ],
  "module_entry_points": {
    "lib/state": "lib/state/index.ts",
    "lib/scheduler": "lib/scheduler/index.ts",
    "lib/observer": "lib/observer/index.ts",
    "lib/publisher": "lib/publisher/index.ts",
    "lib/parser": "lib/parser/index.ts",
    "lib/competitor-intel": "lib/competitor-intel/index.ts"
  },
  "size_budgets": {
    "default_max_lines": 500,
    "rationale": "Not a hard law — a trigger for a conversation. Exceeding it requires an entry in exemptions with a reason.",
    "exemptions": {
      "src/AnalyticsPage.tsx": "799 — decomposition tracked in structure-roadmap-2026-08-08.md item 4",
      "routes/api/logs.ts": "569 — see item 5"
    }
  }
}
```

**2. A validator** — `scripts/check-structure.ts`, run as `npm run lint:structure`. Roughly 150 lines, no dependencies beyond `node:fs`:

- Read the repo's tracked files via `git ls-files`
- Fail on any root entry absent from the allowlist
- Fail on any `placement_rules` violation
- Fail on cross-module imports that bypass a declared entry point (regex over `from '...'` is sufficient — full AST is overkill)
- **Warn** on files exceeding the size budget without an exemption
- Print the fix, not just the error:
  `✗ notes.md at root. Markdown belongs in .agent/ (agent-facing) or .planning/ (specs). Move it, or add to allowed_files in .structure.json with a reason.`

**3. Two enforcement points:**

- **CI** — re-enable the workflow, add `npm run lint:structure` alongside `lint` and `test`. This is the authority.
- **Pre-commit hook** — the same command, for fast local feedback. `.git/hooks/` is not versioned, so install it from `scripts/install-hooks.sh` and call that from a `prepare` script in `package.json`.

### 3.3 Why an allowlist, not a denylist

A denylist enumerates what is forbidden and is permanently behind — the next junk file is one you did not think of. An allowlist enumerates what is permitted; **anything new fails by default.**

That inverts the economics. Adding a root file now costs a deliberate edit to `.structure.json` with a reason attached, visible in code review. Putting it in the right directory costs nothing. The path of least resistance becomes the correct path — which is the only arrangement that survives deadline pressure and agent-driven edits.

This also handles the AI-agent case specifically. An agent asked to "write up findings" will drop `findings.md` at the root, because the root is where a relative path lands by default. A failing check redirects it in the same turn, without the agent needing to have read `CLAUDE.md` carefully.

### 3.4 Killing documentation drift

Complementary, and cheap. Three rules:

1. **Docs point, code proves.** Never restate in prose what code states — no line counts, no "this file does X" for X derivable from the filename. Point at the file and describe the *non-obvious* constraint. `CLAUDE.md`'s "Non-Obvious Architecture Facts" section is the right shape; the file table above it was the part that rotted.

2. **Assertions that a test can check.** Where a doc must state a fact, make it checkable. The retention table in `.agent/OPERATIONS.md` names functions — a test can assert those functions exist and are called from `runGarbageCollection()`. `module_entry_points` in `.structure.json` is a doc *and* an enforced rule.

3. **Doc-adjacent code changes flag the doc.** A `PostToolUse` hook in `.claude/settings.json` that prints a reminder when `lib/state/`, `routes/`, or `config/env.ts` is edited: *"`CLAUDE.md` and `.agent/ARCHITECTURE.md` describe this module — confirm they are still accurate."* Advisory, but at the moment of change rather than months later.

---

## Part 4 — Workspace Organization

### 4.1 Current state after the cleanup

Root: 24 loose files, 25 directories (from 27 and 36). The remaining directories are legitimate but not equally obvious to a newcomer.

### 4.2 Ambiguities worth resolving

| Pair | Problem | Suggested rule |
|---|---|---|
| `.agent/` vs `.planning/` | Both hold markdown about the system. A new doc could plausibly go in either. | **`.agent/` = current truth** (how the system works now — architecture, operations, known issues). **`.planning/` = intent and history** (specs, roadmaps, audits, things that were or will be true). Test: "would this be wrong if we shipped a change?" If yes, `.agent/`. If it is a record of a moment, `.planning/`. |
| `storage/` vs `data/` vs `artifacts/` | Three names for places things are stored. | Rename `storage/` to something that says what it holds, or fold it in. Then: `data/` = pipeline inputs and outputs, `artifacts/` = machine-generated runtime output. Document both in one line in `.structure.json`. |
| `ops/` vs `scripts/` | Both hold executables. | `scripts/` = developer-invoked (`npm run …`). `ops/` = deployment and systemd. Currently true; write it down before it stops being true. |
| `templates/` (64 files, 984 K) | Referenced only by `config/watch.ts` as an *exclusion*. Nothing reads it at runtime. | Determine whether these are live ad assets or historical. If historical → `archive/`. This is the largest unexamined directory left. |
| `contracts/` vs `.agent/contracts/` | Two directories named "contracts" holding different things (TS types vs JSON manifests). | Rename `.agent/contracts/` to `.agent/manifests/`. Cheap, removes a real stumble. |

### 4.3 `.planning/spec-kit/specs/` — 55 flat files

The single worst remaining navigation problem: a newcomer cannot tell which specs describe the running system and which are historical. Nine are marked done but sit beside active work; 35 carry no status at all.

Recommendation:

```
.planning/spec-kit/specs/
├── active/       # in flight — the only directory to read when orienting
├── shipped/      # implemented; kept for the design rationale
└── archive/      # superseded or abandoned  (already exists, 30 files)
```

Plus a required `status` field with a **closed vocabulary** — `proposed | active | shipped | superseded` — validated by `check-structure.ts` against the directory a spec sits in. Directory and field must agree; disagreement is a build failure. That prevents the current seven-vocabulary sprawl from re-forming.

---

## Part 5 — Codebase Structure

### 5.1 The organizing principle to adopt

The codebase has no stated rule for when something becomes a directory. Result: `lib/` holds 24 loose files and 8 subdirectories with no visible logic separating them.

Proposed, and worth writing into `.agent/ARCHITECTURE.md`:

> **A `lib/` entry is a directory with an `index.ts` when it owns a domain concept with more than one file's worth of behavior. It is a loose file when it is a single-purpose utility with no internal structure. There is no middle state — a loose file that grows a companion becomes a directory in the same change.**

That rule alone resolves most of the current ambiguity, and it is checkable: `check-structure.ts` can fail on any `lib/*.ts` that has a sibling importing it exclusively.

### 5.2 Clusters visible in the flat files

Applying the rule to today's 24 loose files:

| Candidate module | Files | Note |
|---|---|---|
| `lib/kakao/` | `kakaoAutoReply.ts`, `kakaoDb.ts`, `kakaoSkill.ts` | Three files, one domain, already a de facto module |
| `lib/logging/` | `logger.ts`, `logEvents.ts`, `logCache.ts` | Same |
| `lib/browser/` | `sharedBrowser.ts`, `browserDebug.ts` | Two files, tightly coupled |
| `lib/analytics/` | `competitorAnalytics.ts` (520), `trendInsights.ts`, `schedulerSignals.ts` | Also the largest loose file |
| stays loose | `utils.ts`, `playbookRunner.ts`, `resourceMonitor.ts`, `notifications.ts`, `nlWebhook.ts`, `scheduleJitter.ts` | Genuinely single-purpose |
| **resolve first** | `scheduler.ts` (334) **and** `lib/scheduler/` | A file and a directory with the same name, where the directory's `index.ts` re-exports from the parent file. Confusing enough that it should be finished: move `startScheduler` into `lib/scheduler/run.ts` and delete `lib/scheduler.ts`. |
| **resolve** | `competitor-ad-sqlite.ts`, `competitor-intel-ui.ts` | Live outside `lib/competitor-intel/` despite the name. Either move in or rename to explain why not. |

Each is a small mechanical change. Do them one per commit so `git log` stays readable — and only *after* CI is running, so they are verified rather than hoped.

### 5.3 Size budgets as a conversation trigger

Six files exceed 500 lines. None is catastrophic; the point is that nothing currently notices growth. A warning at 500 and a required exemption entry turns "this file got big" from something discovered during a painful edit into something discovered in the PR that caused it.

Precedent exists and it worked: `src/App.tsx` went from ~1800 lines to 156 with pages and hooks extracted. That was the right move. Nothing prevents the next `App.tsx` from forming.

---

## Part 6 — Suggested Sequence

Ordered so each step is verified by the previous one.

| Step | Work | Why here |
|---|---|---|
| 1 | **Re-enable CI** with `lint` + `test` | Everything downstream is unverified without it. Highest value single change in this document. |
| 2 | Fix the Ollama tests (skip when unreachable) | CI cannot be green until they are. |
| 3 | Install `@ast-grep/cli`, add `sg scan` to CI | Activates six rules that have never run. |
| 4 | Write `.structure.json` + `check-structure.ts`, add to CI | The permanent fix. Start with the root allowlist only — the narrowest useful version. |
| 5 | Install the pre-commit hook | Local feedback. Optional but cheap once step 4 exists. |
| 6 | Spec lifecycle directories + closed status vocabulary | Largest remaining navigation win. |
| 7 | `lib/` module extraction (5.2), one per commit | Now mechanically verified by steps 1–4. |
| 8 | Decompose `src/AnalyticsPage.tsx`, review `routes/api/logs.ts` | Size budget will have been flagging these. |
| 9 | Resolve `templates/`, `storage/`, `.agent/contracts/` naming | Lowest urgency, still worth doing. |

**If only one item ships: step 1.** Steps 4–9 are conventions, and this session demonstrated at length what happens to conventions with nothing enforcing them.

---

## Part 7 — What Went Well

Worth preserving, because these made the cleanup tractable.

1. **`lib/state/` consolidation was the right call.** Once the shims were gone, the 409 bug was obvious. A single owner for runtime state made a whole class of question — "where does this get persisted?" — have one answer.
2. **Spec-kit grounding works.** Structured acceptance criteria in `.planning/spec-kit/specs/` made completion checkable rather than a judgment call. The problem is lifecycle, not the format.
3. **Lint is fast** (under 2 s for both configs). Fast feedback is why the 12-file shim migration was safe to do mechanically.
4. **The two-tsconfig split is correct and should stay.** `bundler` and `NodeNext` module resolution cannot be expressed in one config. It is now documented in both files so the next reader does not try to merge them.
5. **`.agent/` as an agent-facing docs root is a good pattern** — it kept this cleanup from having to invent a home for `ARCHITECTURE.md`, `OPERATIONS.md`, and `KNOWN_ISSUES.md`.
