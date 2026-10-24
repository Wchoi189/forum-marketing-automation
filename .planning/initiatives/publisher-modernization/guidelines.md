---
status: active
---

# Publisher Architecture Modernization: Operational Execution Guidelines

**Initiative ID:** `publisher-architecture-modernization-v1`  
**Target Systems:** `lib/publisher/`, `lib/observer/`, `lib/scheduler/`, `lib/state/`, `scripts/`  
**Reference Plan:** [publisher-architecture-modernization.plan.json](../../plans/publisher-architecture-modernization.plan.json)  

## Initiative Documentation Map (Unified Navigation Index)

All documents across the scattered directories are mapped below for seamless navigation:

| Purpose / Role | Document Path | Focus / Key Insights |
| :--- | :--- | :--- |
| **Bug Report** | [bug-report-publisher-failures.md](file:///home/qubit/workspace/marketing-automation/docs/publisher-assessment/bug-report-publisher-failures.md) | Symptoms, 5-minute failure loops, and unhandled 503 incident logs. |
| **Incident Assessment** | [assessment-report.md](file:///home/qubit/workspace/marketing-automation/docs/publisher-assessment/assessment-report.md) | Detailed log breakdown, component impact matrix, and remediation options. |
| **Architecture Audit** | [publisher-architecture-assessment.md](file:///home/qubit/workspace/marketing-automation/docs/publisher-assessment/publisher-architecture-assessment.md) | Configurability conflicts, 5-min override trap, state drift, and bloat audit. |
| **Browser Eval (Obscura)** | [browser-alternative-obscura-assessment.md](file:///home/qubit/workspace/marketing-automation/docs/publisher-assessment/browser-alternative-obscura-assessment.md) | Technical assessment of Rust Obscura vs Chromium; hybrid suitability. |
| **Docs Architecture Audit** | [planning-documentation-architecture-assessment.md](file:///home/qubit/workspace/marketing-automation/docs/publisher-assessment/planning-documentation-architecture-assessment.md) | Evaluation of planning docs navigability & vertical package overhaul blueprint. |
| **Master Execution Plan** | [publisher-architecture-modernization.plan.json](file:///home/qubit/workspace/marketing-automation/.planning/spec-kit/plans/publisher-architecture-modernization.plan.json) | Multi-phase governance, session boundaries, and model tier rules. |
| **Phase 1 Spec** | [phase1-bloat-pruning-v1.json](file:///home/qubit/workspace/marketing-automation/.planning/spec-kit/specs/active/phase1-bloat-pruning-v1.json) | Script pruning, dead package.json references, and workspace hygiene. |
| **Phase 2 Spec** | [phase2-publisher-scheduler-stabilization-v1.json](file:///home/qubit/workspace/marketing-automation/.planning/spec-kit/specs/active/phase2-publisher-scheduler-stabilization-v1.json) | Proactive 60m cooldown gate, 5-min loop removal, and alert dialog capture. |
| **Phase 3 Spec** | [phase3-maintenance-engine-v1.json](file:///home/qubit/workspace/marketing-automation/.planning/spec-kit/specs/active/phase3-maintenance-engine-v1.json) | Korean maintenance notice regex parser and dynamic scheduler pause. |
| **Phase 4 Spec** | [phase4-state-architecture-consolidation-v1.json](file:///home/qubit/workspace/marketing-automation/.planning/spec-kit/specs/active/phase4-state-architecture-consolidation-v1.json) | Unified reactive state store, micro-file inlining, and `bot.ts` retirement. |
| **Session Handovers** | [.agent/session-handovers/](file:///home/qubit/workspace/marketing-automation/.agent/session-handovers/) | Directory storing Phase session handovers (`handover-YYYYMMDD-HHMM.json`). |

---

## 1. Multi-Phase Roadmap Overview

This initiative modernizes the automated publishing subsystem to eliminate 5-minute retry storms under Ppomppu's 1-post-per-hour rule, automate dynamic pausing during platform maintenance ("점검 중 입니다"), prune repository bloat (~55KB dead scripts), and unify runtime state authority.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             MODERNIZATION PHASES                                 │
├─────────┬──────────────────────────────────────────┬─────────────────────────────┤
│ Phase 1 │ Immediate Bloat Pruning & Script Hygiene │ Delete 10 orphaned scripts, │
│         │ (.planning/spec-kit/specs/active/        │ clean dead package.json     │
│         │  phase1-bloat-pruning-v1.json)           │ references.                 │
├─────────┼──────────────────────────────────────────┼─────────────────────────────┤
│ Phase 2 │ Publisher & Scheduler Stabilization      │ Proactive 60m cooldown gate,│
│         │ (.planning/spec-kit/specs/active/        │ eliminate 5m retry loop,    │
│         │  phase2-publisher-scheduler-             │ alert dialog interceptor.   │
│         │  stabilization-v1.json)                  │                             │
├─────────┼──────────────────────────────────────────┼─────────────────────────────┤
│ Phase 3 │ Platform Maintenance & Pause Engine      │ HTTP 503 & Korean notice    │
│         │ (.planning/spec-kit/specs/active/        │ parser, dynamic pause timer,│
│         │  phase3-maintenance-engine-v1.json)      │ clean Slack notices.        │
├─────────┼──────────────────────────────────────────┼─────────────────────────────┤
│ Phase 4 │ State Unification & Micro-File Cleanup   │ In-memory reactive store,   │
│         │ (.planning/spec-kit/specs/active/        │ inline micro-files, delete  │
│         │  phase4-state-architecture-              │ legacy bot.ts adapter.      │
│         │  consolidation-v1.json)                  │                             │
└─────────┴──────────────────────────────────────────┴─────────────────────────────┘
```

---

## 2. Model Performance Recommendations & Automated Batching Protocol

### 2.1 Model Selection Matrix

Different implementation phases have distinct cognitive demands. Matching task complexity to the optimal model tier maximizes speed, reduces token burn, and prevents hallucinations:

| Phase / Workload | Recommended Model | Task Nature | Execution Strategy |
| :--- | :--- | :--- | :--- |
| **Phase 1: Bloat Pruning** | **Gemini Flash (Low / Med)** | Deterministic file deletions, dead reference scrubbing in `package.json`. | Automated script batching with HITL git diff review. |
| **Phase 2: Publisher Stabilization** | **Gemini Flash (High) / Thinking** | Cooldown arithmetic, scheduler timer logic, Playwright dialog event interception. | Small-batch implementation; verify via unit tests after each file. |
| **Phase 3: Maintenance Engine** | **Gemini Flash (High) / Thinking** | Complex regex extraction for unstructured Korean dates/times, timezone math, pause scheduling. | Batch 1: Regex parser + unit tests; Batch 2: Scheduler integration. |
| **Phase 4: State Consolidation** | **Hybrid:**<br>• Flash Med (Repointing)<br>• Flash High (State Store) | Refactoring state store to an in-memory event bus; repointing 15+ caller import paths. | Flash Med for mechanical import changes; Flash High for state engine. |

### 2.2 Automated Batching Script & Human-In-The-Loop (HITL) Note

> [!IMPORTANT]
> **Operational Rule for Fast Models (Gemini Flash Low / Med / High):**
> Fast models must **not** execute sprawling multi-file modifications in a single unmonitored prompt. They must process work in **small, discrete batches (1–2 files per step)** accompanied by automated lint/test validation and Human-In-The-Loop review.

#### Standard Automated Batching Workflow:
1. **Batch Preparation:** The agent outlines the exact 1–2 files targeted in the current batch.
2. **Execution:** The agent performs modifications using targeted file edits.
3. **Automated Verification:** The agent immediately runs workspace validation commands:
   ```bash
   npm run lint:structure   # Validate placement and size budgets
   npm run lint             # Validate TypeScript compilation & AST scan
   npm run test:unit        # Validate domain logic
   ```
4. **HITL Review & Checkpoint:** The agent presents git diff summaries for operator confirmation before proceeding to the next batch.

---

## 3. Session Boundary & Handover Protocol

### 3.1 Mandatory Auto-Stop Rule
To maintain architectural discipline and prevent token fatigue or drifted context, **agents must automatically stop execution and produce a session handover whenever a Phase boundary is reached**:

1. **Gate Verification:** Check that all `gate_criteria` defined in the active phase spec are 100% satisfied.
2. **Stop Action:** Do **not** begin coding the next phase in the same session turn.
3. **Handover Generation:** Write a structured handover file to `.agent/session-handovers/handover-YYYYMMDD-HHMM.json` conforming to `.agent/session-handovers/template.json`.
4. **Memory Synchronization:** Execute session handover sync:
   ```bash
   npm run mempalace:handover
   ```

---

## 4. Standardized Continuation Prompts per Phase

Every generated session handover **must** conclude with an explicit, copy-pasteable continuation prompt to seamlessly bootstrap the subsequent agent session:

### Continuation Prompt: Phase 1 → Phase 2
```text
Phase 1 (Bloat Pruning & Script Hygiene) of publisher-architecture-modernization-v1 is complete and verified. 
Please read the session handover at .agent/session-handovers/handover-[DATE].json and proceed with Phase 2 implementation per .planning/spec-kit/specs/active/phase2-publisher-scheduler-stabilization-v1.json.
Focus on implementing the proactive 60-minute cooldown pre-flight gatekeeper in lib/publisher/publisherRun.ts, eliminating the hardcoded 5-minute retry loop in lib/scheduler/run.ts, and capturing alert dialogs in lib/publisher/flow/runPublisherFlow.ts.
Execute in small batches with automated test verification after each step.
```

### Continuation Prompt: Phase 2 → Phase 3
```text
Phase 2 (Publisher & Scheduler Stabilization) of publisher-architecture-modernization-v1 is complete and verified. 
Please read the session handover at .agent/session-handovers/handover-[DATE].json and proceed with Phase 3 implementation per .planning/spec-kit/specs/active/phase3-maintenance-engine-v1.json.
Focus on implementing the Korean maintenance notice regex parser in lib/observer/boardDiagnostics.ts, integrating dynamic scheduler pause (maintenanceBlockedUntil) in lib/scheduler/run.ts, and rationalizing Slack maintenance notifications.
Execute in small batches with automated test verification after each step.
```

### Continuation Prompt: Phase 3 → Phase 4
```text
Phase 3 (Platform Maintenance Engine) of publisher-architecture-modernization-v1 is complete and verified. 
Please read the session handover at .agent/session-handovers/handover-[DATE].json and proceed with Phase 4 implementation per .planning/spec-kit/specs/active/phase4-state-architecture-consolidation-v1.json.
Focus on consolidating micro-files in lib/publisher/, unifying state authority into an in-memory reactive store to eliminate optimistic concurrency clobbering, and repointing callers to delete the legacy bot.ts adapter.
Execute in small batches with automated test verification after each step.
```

---

## 5. Verification & Acceptance Checklist

Before declaring any phase complete, the agent must run and verify:

```bash
# 1. Workspace structure check (~1s)
npm run lint:structure

# 2. TypeScript compilation & AST scan (~5s)
npm run lint

# 3. Unit test suite (~8s)
npm run test:unit

# 4. Integration test suite (when modifying browser/API flow)
npm run test:integration
```
