---
title: Publisher Resilience
status: active
initiative_id: publisher-resilience
created: 2026-10-24
tags:
  - publisher
  - session
  - turnstile
  - efficiency
  - drafts
---

# Publisher Resilience

> Make a ~7-day session lifetime a planned event instead of an outage, launch
> Chromium only when a tick can publish, and stop single flakes from costing a run.

## 1. Why

Publishing stopped on 2026-10-23 when the ppomppu session expired. The KE-004
fix that handles this had been written a week earlier but never deployed. The
bot cannot log itself in (Turnstile), so every expiry needs a person, and the
current system neither warns nor stops retrying. Separately, 77 % of ticks
launch a full browser only to skip. Evidence:
[research/01-assessment-20261024.md](research/01-assessment-20261024.md).

## 2. Constraints

- No automated login or challenge solving. Session refresh stays human.
- Online ppomppu drafts are the content source of truth. Workspace copies follow them.
- Builds on publisher-modernization R1/R2: gates run cheapest first, and
  `nextAttemptAt` stays the only scheduling decision.

## 3. Map

| Phase | Spec | Focus |
| :--- | :--- | :--- |
| 0 | none, tasks PR-001..004 | Deploy the KE-004 fix, import a session, expose the running commit |
| 1 | [s1-session-lifecycle-v1](specs/active/s1-session-lifecycle-v1.json) | Session state, scheduler park, import endpoint, expiry alerts, cookie hygiene |
| 2 | [s2-browser-efficiency-v1](specs/active/s2-browser-efficiency-v1.json) | Resource blocking, HTTP observer spike, on-demand browser, artifact dedupe |
| 3 | [s3-draft-path-resilience-v1](specs/active/s3-draft-path-resilience-v1.json) | In-run step retry, error taxonomy, online-to-workspace draft mirror |

## 4. Progress

Status, owners, blockers and evidence for every item:
[tasks/publisher-resilience-tasks-v1.json](tasks/publisher-resilience-tasks-v1.json).
Update it in the same change as the work it records. Open questions Q-01..Q-03
live there too.

Related: [KE-004](../../known-issues/KE-004-ppomppu-login-turnstile.md),
[publisher-modernization](../publisher-modernization/README.md).
