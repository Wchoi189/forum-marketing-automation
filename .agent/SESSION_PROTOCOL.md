# Session Protocol

Detail behind the "Decision Authority" section of `CLAUDE.md`. Read it when you
write a handover, close a spec implementation session or milestone, or when
context is running out. Ordinary turns do not need it.

## Why this exists

Mid-session and end-of-session questions to the operator did not improve
outcomes. Answers were given without the context the agent had, and they
introduced errors the agent would not have made alone. A question is a cost
paid by the operator and a new point of failure. Spend it only at the boundary
in `CLAUDE.md`.

## Deciding without asking

1. Look for the answer: project principles (`CLAUDE.md`, `AGENTS.md`), git
   history, the KEDB, existing code conventions, then developer ergonomics.
2. Pick the reversible option when two are close.
3. Do it. Record it under **Decisions made** in the closing summary, with the
   reason in one clause. The operator can reverse it after the fact; that is
   cheaper than a round trip.

Do not ask "should I do X now or later?" If X completes the stated goal, do X.
Do not offer follow-ups as questions. Either do them (in scope) or log them as
next work (out of scope).

A gate that fails for a documented reason (KEDB entry, a known false positive)
gets the documented resolution immediately. A gate that fails for an
undocumented reason gets investigated, not escalated.

## Escalate only for

1. **Irreversible loss**: force-push, deleting uncommitted or untracked work
   you did not create, deleting `artifacts/` databases, rewriting history.
2. **Outward effects**: a real ppomppu publish (`DRY_RUN_MODE=false` through
   `/api/run-publisher`) that the task did not call for, posting credentials,
   sending anything to a third party.
3. **Direct conflict** with an instruction the operator gave in this session.

Two things are not questions at all, because the answer is always no:
weakening a fail-closed publisher check, and retrying a login without a
Turnstile token (KE-004). If a task seems to need either, the task is wrong;
solve the underlying problem.

## Mechanical guards

Two hooks in `.claude/settings.json` back the prose with checks:

- `.claude/hooks/guard-bash.mjs` (PreToolUse, Bash) blocks blanket staging
  (`git add -A`, `.`, `-u`), `commit -a`, `--no-verify`, commits on `main`,
  force pushes, `reset --hard`, `git clean -f`, whole-tree `checkout`/`restore`,
  `branch -D`, and `rm -r` on `artifacts/`. A block names the safe alternative;
  take it, do not ask.
- `.claude/hooks/no-closing-question.mjs` (Stop) sends a reply that ends in a
  question back once. It does not fire again on the retry, so a real escalation
  still goes through.

`npm run agent:friction` reports question closings, `AskUserQuestion` calls and
hook blocks per session from the transcripts. Compare sessions before and after
a change to these rules.

## Commits

- Commit finished work in the same turn, on the current branch. If the branch
  is `main`, branch first.
- Stage **explicit paths** you changed. Never `git add -A` or `git add .`: the
  working tree often holds another session's or the operator's files.
- Do not push, open a PR, or merge unless asked.
- Leave other people's uncommitted files alone and say which you left.

## Closing an ordinary turn

What changed and what is next, in a few lines. No lists of operator steps, no
restated blockers, no verification tallies, no file inventories, no closing
question.

## Handover: only when needed

Write one when work stops unfinished: context is past about four fifths, or a
blocker outside your reach ends the session. Past about two thirds, say so once
in one sentence. Never at a routine boundary, never because the session is
ending with the work done.

Commit first, so the handover describes a committed state. Use
`.agent/session-handovers/template.json` (the mempalace scripts read it) and set
`last_handover_file` in `.agent/state/state.index.json`. It must let a reader
who has seen nothing else resume. Fill these, in `objective`, `pending_items`,
`next_actions`, `constraints`, `decisions` and `artifacts_touched`:

- Date, branch, HEAD, what is done and what remains.
- The next task and the constraint that governs it.
- One command that proves the state (a test or `git log`).
- Uncommitted or untracked files, and why they were left.
- The thing most likely to mislead a fresh reader: a measurement they would
  misdiagnose as a bug, a gap between design docs and code and how it was
  settled.

MemPalace indexing (`npm run mempalace:handover`) is optional and best effort.
If it fails or the tool is absent, skip it and say nothing.

## Milestone summary

For the end of a spec implementation session or a completed phase only. Five
headings, each short. Omit one that is empty.

- **STATUS**: current task, done or blocked, the blocker if any.
- **STATE VERIFIED**: literal output, not claims. HEAD, test counts as the
  runner printed them, files modified.
- **DECISIONS MADE**: each judgment call and why. These were already made; this
  is a log, not a request.
- **TRAPS**: anything a fresh reader would misread, upstream anomalies.
- **CONTINUATION**: only if stopping unfinished. A fenced block with the next
  task ID, the handover file, and one proof-of-state command.

There is deliberately no "decisions needed" section. If the analysis can answer
a question, it was not a question. If it truly cannot and the answer is at the
escalation boundary above, put it under STATUS as the blocker.

## Where memory lives

One home per kind of fact; do not duplicate across them.

| Kind | Home |
|------|------|
| Operator preferences, feedback, standing lessons | Claude auto-memory (`~/.claude/projects/.../memory/`) |
| State of unfinished work | Handover JSON + `state.index.json` (above) |
| Design, specs, history | `.planning/` |
| How the system works now | `.agent/` |

MemPalace is an optional search index over handovers and `.agent/` files. It is
never a source of truth; if it disagrees with the files, the files win.

## Model and effort

Not the agent's concern mid-session. When writing a handover or tasks file for
a later session, one line is enough, chosen by the cost of a wrong answer:
anything touching a live publish, credentials, or recorded figures wants the
strongest model; settled implementation does not.
