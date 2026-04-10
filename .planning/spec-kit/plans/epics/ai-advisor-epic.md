# Epic — AI Advisor + NL Webhook

**Specs:** [`ai-advisor-v1.json`](../../specs/ai-advisor-v1.json) · [`nl-webhook-v1.json`](../../specs/nl-webhook-v1.json)  
**Parent policy:** [`scheduler-adaptation.policy.json`](../../specs/scheduler-adaptation.policy.json)

## Problem

The scheduler's rule-based multipliers (trend × SoV) handle each signal independently and require pre-encoded thresholds for every edge case. Unusual signal combinations (e.g. SoV low + high error rate + off-peak hour) fall through as neutral, producing no response. Operational changes also require SSH access to modify env vars or config files.

## Goal

1. **AI Advisor** — Grok 4 synthesises the full KPI context after each observer run and produces a scheduling recommendation (`intervalMinutes`, `gapThreshold`, `reasoning`). Operator reviews and applies via dashboard. Advisor is advisory only — existing rule-based fallback is unchanged.

2. **NL Webhook** — `POST /api/nl-command` accepts plain-text instructions and dispatches to existing API endpoints. Eliminates SSH for operational changes.

## Execution Principle

> AI advises, existing API executes. The advisor never writes files, triggers browser runs, or modifies scheduler state directly. All mutations flow through already-validated paths.

---

## Delivery Plan

| Sprint | Scope | Session boundary |
|--------|-------|-----------------|
| **S1** | Advisor core: `lib/aiAdvisor.ts` + `GET /api/ai-recommendation` | Done when endpoint returns a valid recommendation (or null) and tsc is clean |
| **S2** | Apply path: `POST /api/apply-ai-recommendation` + dashboard panel | Done when operator can see + apply recommendation in UI |
| **S3** | NL webhook: `POST /api/nl-command` + intent dispatch | Done when all 7 intents pass integration smoke test |

Each sprint is independently deployable. S2 depends on S1. S3 is independent of S2.

---

## What is explicitly out of scope

- Auto-applying the AI recommendation without operator confirmation
- Telegram/Discord adapter (noted in nl-webhook-v1.json but deferred to S4 if needed)
- Changing the rule-based fallback in `trendInsights.ts` (rules stay as-is)
- Any new database or persistence layer (in-memory cache + existing artifacts/)
- Changing the publisher browser flow

---

## Acceptance (epic-level)

- [ ] `XAI_API_KEY` absent → all new endpoints degrade gracefully, no scheduler disruption
- [ ] Existing unit tests still pass after each sprint
- [ ] `tsc --noEmit` clean after each sprint
- [ ] Advisor recommendation is never auto-applied
- [ ] NL webhook `dry_run=true` returns intended action without mutation
- [ ] All new env vars have documented defaults and appear in CLAUDE.md env table
