# Architecture Overview

## Primary Goals

- Keep publishing behavior deterministic and fail-closed.
- Preserve contract alignment between runtime code and spec-kit manifests.
- Avoid silent regressions in publisher steps (draft load, modal confirm, submit, redirect verification).

## Semantic Spec Goals

- Keep specs machine-readable and semantically meaningful.
- Every major spec should state:
  - `purpose` (why this spec exists),
  - `design_intent` (what decision it protects),
  - `change_impact` (who/what is affected by changes).
- Prefer concise structured fields over long prose.

## Module Structure

```
lib/
├── state/                # Single source of truth for runtime state
│   ├── types.ts          # State shapes + StateVersionConflictError
│   ├── persistence.ts    # Atomic writes, optimistic concurrency
│   ├── observer.ts       # Observer controls + gap threshold
│   ├── publisher.ts      # Publisher controls + rate-limit backoff
│   ├── scheduler.ts      # Scheduler controls
│   ├── nlWebhook.ts      # NL webhook kill-switch
│   └── controlPanel.ts   # Whole-panel single-write persistence
├── scheduler/            # Gap-driven publishing orchestration (run.ts is the tick loop)
├── publisher/            # Publishing automation
│   ├── flow/             # Playbook-driven flow orchestration
│   └── ui/               # Page interactions (rateLimit, draftModal, submit)
├── observer/             # Board observation and parsing
├── browser/              # Chromium lifecycle: shared browser, debug handlers, eval polyfill
├── logging/              # pino instance + LOG_EVENT vocabulary
├── analytics/            # Derived numbers from history: trends, scheduler signals, competitor EDA
├── kakao/                # KakaoTalk skill: webhook types, Postgres log, auto-reply
├── competitor-intel/     # Competitor ad extraction pipeline (crawls and writes)
├── competitor-store/     # SQLite corpus of extracted ads + dashboard read model
├── competitor-ad-parser/ # Deterministic Cheerio HTML -> record parser
└── parser/               # DOM projection and diff utilities

src/                      # React UI (control panel)
contracts/                # Shared type definitions
config/                   # Environment and validation
```

**When a `lib/` entry becomes a directory:** it is a directory with an
`index.ts` when it owns a domain concept with more than one file's worth of
behavior; it is a loose file when it is a single-purpose utility with no
internal structure. There is no middle state — a loose file that grows a
companion becomes a directory in the same change. Every directory above is a
declared entry point in `.structure.json`, so nothing outside it may import
past its `index.ts`.

The three `competitor-*` modules split by direction and by weight:
`competitor-intel/` crawls and writes, `competitor-store/` stores and reads,
`competitor-ad-parser/` turns HTML into records. `competitor-store/` is
deliberately not inside `competitor-intel/` — that barrel re-exports the
Crawlee crawler, and the API server reads the database on every dashboard
request.

**State access rule:** import from `lib/state/index.js` only. The former
`lib/controls.ts` and `lib/runtimeControls.ts` shims were deleted on 2026-08-08;
a duplicate `RuntimeControlsVersionConflictError` class living in the shim meant
`instanceof` checks silently failed and version conflicts returned HTTP 500
instead of 409. Do not reintroduce an aggregation layer over `lib/state/`.

See [module-boundaries.json](../.planning/spec-kit/reference/module-boundaries.json) for dependency rules.

## Environment Variables

| Location | Purpose |
|----------|---------|
| `config/env.ts` | Runtime parsing and validation |
| `.agent/contracts/env.contract.json` | Contract list |
| `.planning/spec-kit/manifest/schemas/env.schema.json` | Schema constraints |

**When adding/changing any env var, update all three files in the same change.**

Never log or commit secret values (e.g., `PPOMPPU_USER_PW`).

`config/env.ts` calls `dotenv.config()` **without** `override: true`. Explicit
process environment therefore beats the `.env` file, which is what lets Docker,
CI, and `scripts/run-tests.sh` redirect paths. Restoring `override: true` would
let a stale developer `.env` clobber those — it previously pointed
`ARTIFACTS_DIR` at a nonexistent absolute path and broke the whole integration
suite. Absolute host paths in source are blocked by
`.ast-grep/rules/no-absolute-host-paths.yml`.

## Agent OS Integration

Standards documents live in `archive/agent-os/standards/` (archived 2026-08-08 —
they were not being maintained). The slash commands that consume them still
resolve from `.claude/commands/agent-os/`:

| Command | Purpose |
|---------|---------|
| `/discover-standards` | Extract patterns and conventions from the codebase |
| `/index-standards` | Update the standards index with new descriptions |
| `/inject-standards` | Inject relevant standards into AI context |
| `/plan-product` | Create structured plans for new features |
| `/shape-spec` | Develop specifications for implementations |

If the commands do not appear, confirm `.claude/commands/agent-os/` exists and
restart the session to reload them.

### Principles the standards encoded

- **Fail-closed automation** — when uncertain, pause rather than risk incorrect
  behavior.
- **Deterministic behavior** — same inputs, same results. Minimize timing- and
  randomness-dependent logic.
- **Contract alignment** — runtime changes and spec-kit manifests move together,
  in both directions.
- **Memory continuity** — use the MemPalace loop for state across agent sessions
  on multi-step work.

## UI Architecture

- Target: SaaS-style app shell with persistent left navigation.
- Principle: "One page, one primary decision" to reduce dashboard sprawl.
- Pattern: Data orchestration in hooks/containers, rendering in presentational components.
- Preserve existing API behavior during UI decomposition unless explicitly changing contracts.

## AI-Friendly Development

- Use feature-slice changes (route + state + API usage + tests + spec update).
- Update reviewer-pack docs in `.planning/spec-kit/reference/` with runtime-facing changes.
- Favor deterministic acceptance criteria and explicit failure behavior over vague narratives.