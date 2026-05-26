# Multi-Stage Parser Implementation Plan

## Overview

This plan replaces the monolithic competitor ad parser with a staged pipeline for better noise filtering, debuggability, and evidence tracking.

## Plan Documents

| Document | Purpose |
|----------|---------|
| `multi-stage-parser-v1.json` | Main plan spec - architecture, implementation sequence, acceptance criteria |
| `stage-locate-v1.json` | Stage 0 spec - HTML element isolation, chrome removal |
| `stage-classify-v1.json` | Stage 1 spec - LLM post type classification |
| `stage-noise-filter-v1.json` | Stage 2 spec - Cheerio extraction (step_0) + noise removal + signal scoring |
| `stage-llm-extraction-v1.json` | Stage 3 spec - LLM extraction from filtered content |
| `stage-merge-v1.json` | Stage 4 spec - Cheerio vs LLM vote, catalog validation |
| `stage-evidence-v1.json` | Stage 5 spec - Evidence chain, product provenance |
| `stage-dedup-v1.json` | Stage 6 spec - Embedding similarity deduplication |
| `stage-structure-v1.json` | **DEPRECATED** - Cheerio extraction merged into Stage 2 |
| `execution-loop.contract.json` | Execution protocol - state machine (Stage 0-6), session workflow |
| `session-handover.protocol.json` | Handover format - copy-paste ready templates |

## Architecture (7-stage)

```
Stage 0: LOCATE      → Trafilatura (Python): 98.5% noise reduction. titleText + bodyText (plain text).
Stage 1: CLASSIFY    → Ollama LLM post type: direct_offer | affiliate | promo_code | comparison
Stage 2: FILTER      → Text-line pattern matching on bodyText + signal scoring (LLM skip condition)
Stage 3: LLM         → Ollama extraction with titleText + contentForLlm. Zod validates output.
Stage 4: MERGE       → Text-extracted vs LLM vote, Zod cross-pair check, catalog validation
Stage 5: EVIDENCE    → Evidence chain per-product, provenance tracking
Stage 6: DEDUP       → Embedding similarity (nomic-embed-text), skip redundant posts
```

**Tool decisions**:
- `Trafilatura` → Stage 0. Python subprocess bridge. Replaces Cheerio selector chain.
- `Zod (zod@4.3.6)` → Stage 3 (LLM output) + Stage 4 (cross-pair validation). Already installed.
- `jq` → Dev/debug tooling ONLY. Not used in automated pipeline.
- `stage-structure-v1.json` deprecated. No Cheerio DOM step in pipeline.

## Implementation Sequence

| Slice | Stage | Name | Est. Hours | Deps |
|-------|-------|------|------------|------|
| 1 | 0 | Locate | 2 | - |
| 2 | 1 | Classify | 3 | 1 |
| 3 | 2 | Filter (Cheerio + Noise) | 4 | 1,2 |
| 4 | 3 | LLM Extract | 4 | 3 |
| 5 | 4 | Merge | 4 | 3,4 |
| 6 | 5 | Evidence | 3 | 5 |
| 7 | 6 | Dedup | 2 | 6 |
| 8 | - | Orchestrator + Adapter | 4 | 1-7 |

**Total**: ~26 hours

## Validation Posts

These posts test the pipeline across edge cases:

| Post ID | Vendor | Challenge | Expected Behavior |
|---------|--------|-----------|-------------------|
| `eb67ebba985c` | 기프티콩~ | Implicit names | Stage 3 LLM resolves from title |
| `551b849c00f1` | 구독트리 | HTML wins at 0.9 | Stage 1 confidence >= 0.9, Stage 3 skipped |
| `9446cd3682da` | 구독트리 | HTML wins | Stage 4 merge picks Cheerio products |
| `0aea7978e7b3` | SharePlan | Noise dominant | Stage 2 signalScore < 0.3, Stage 3 runs |

## Session Handover Protocol

At session end, create a handover file and output copy-paste summary:

```bash
# Create handover
npm run mempalace:handover -- --file .agent/session-handovers/handover-multi-stage-parser-YYYYMMDD-HHMM.json

# Or manually create JSON following session-handover.protocol.json schema
```

At session start:

```bash
# Wake up with previous context
npm run mempalace:wake-up

# Read handover
cat .agent/session-handovers/handover-multi-stage-parser-*.json
```

## Copy-Paste Handover Template

Use this at session end:

```markdown
# Session Handover - Multi-Stage Parser
**Session**: multi-stage-parser-YYYYMMDD-HHMM
**Slice**: X - Slice Name
**Status**: completed | in_progress | blocked

## Completed
- [item 1]
- [item 2]

## Remaining
- [next slice tasks]

## Next Actions (Atomic)
1. [specific action with file/command]
2. [specific action with file/command]

## Blockers
- [blocker 1] OR "None"

## Validation Posts
- eb67ebba985c: [status]
- 551b849c00f1: [status]
- 9446cd3682da: [status]
- 0aea7978e7b3: [status]

## Files Changed
- lib/competitor-intel/pipeline/stageX-XXX/

---
**To continue**: Run `npm run mempalace:wake-up` then read handover file.
```

## Acceptance Criteria Summary

1. Each stage isolated with typed input/output
2. Stage 2 reduces LLM context by 50%+ for SharePlan posts
3. Stage 3 skip condition works (high Cheerio confidence)
4. Stage 4 produces source attribution per-product
5. Stage 5 links products to evidence excerpts
6. Pipeline runs in <5s per post
7. Adapter preserves backward compatibility
8. Existing tests pass unchanged
9. 4 validation posts produce same or better results

## References

- Parent spec: `.planning/spec-kit/specs/ppomppu-ott-competitor-ads-intel-v1.json`
- Module boundaries: `.planning/spec-kit/specs/module-boundaries.json`
- AI design guidelines: `.planning/spec-kit/specs/ai-design-guidelines.json`
- MemPalace spec: `.planning/spec-kit/specs/mempalace-memory-loop-v1.json`