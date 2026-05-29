# Parser Pipeline Documentation

> **Purpose:** Comprehensive visualization and reference for the 6-stage extraction pipeline
> **Design Intent:** Human-readable diagrams + machine-readable schemas
> **Change Impact:** Core extraction logic - changes affect all downstream consumers

---

## Contents

| File | Description |
|------|-------------|
| `overview-diagram.mmd` | High-level flow showing all stages, decision points, and early-exit paths |
| `stage-0-diagram.mmd` | LOCATE: Trafilatura + Cheerio fallback |
| `stage-1-diagram.mmd` | CLASSIFY: Ollama gemma2:9b post type classification |
| `stage-2-diagram.mmd` | NOISE FILTER: Regex block scoring |
| `stage-3-diagram.mmd` | LLM EXTRACT: Ollama gemma2:27b product extraction |
| `stage-4-diagram.mmd` | MERGE: Vote + Catalog validation |
| `stage-5-diagram.mmd` | EVIDENCE: Provenance assembly |
| `stage-6-diagram.mmd` | DEDUP: Embedding similarity check |
| `schema-reference.md` | TypeScript type definitions for each stage's input/output |
| `flow-description.md` | Human-readable explanation of each stage's logic |

---

## Quick Start

### Render Diagrams with Pretty-Mermaid

```bash
# Render overview to SVG
cd /parent/DEVELOPMENT_FRAMEWORK/Pretty-mermaid-skills
node scripts/render.mjs \
  --input /parent/marketing-automation/.planning/spec-kit/reference/parser-pipeline-docs/overview-diagram.mmd \
  --output /tmp/parser-overview.svg \
  --theme github-dark

# Batch render all diagrams
node scripts/batch.mjs \
  --input-dir /parent/marketing-automation/.planning/spec-kit/reference/parser-pipeline-docs \
  --output-dir /tmp/parser-diagrams \
  --format svg \
  --theme github-dark \
  --workers 4
```

### View in Mermaid Live Editor

Copy `.mmd` content to https://mermaid.live/ for interactive editing.

---

## Pipeline Summary

```
Raw HTML → [S0: LOCATE] → [S1: CLASSIFY] → 
  ├─ affiliate/promo_code → EARLY EXIT
  └─ direct_offer/comparison → [S2: NOISE FILTER] →
      ├─ ≥0.85 signal → SKIP LLM
      └─ <0.85 signal → [S3: LLM EXTRACT] →
    [S4: MERGE] → [S5: EVIDENCE] → [S6: DEDUP] →
      ├─ Unique → SQLite
      └─ Duplicate → Drop
```

---

## Threshold Summary

| Stage | Threshold | Good | Warn | Bad |
|-------|-----------|------|------|-----|
| S0 | reductionRatio | ≥0.70 | <0.40 | fallback_used |
| S1 | classifierConfidence | ≥0.9 | unknown | <0.5 |
| S2 | signalScore | ≥0.85 | 0.6-0.85 | <0.3 |
| S3 | llmConfidence | ≥0.7 | retry | junk |
| S4 | sourceAttribution | mixed ≥0.9 | single 0.7-0.8 | empty |
| S5 | name_evidence | exists | - | missing |
| S6 | similarity | <0.85 | 0.85-0.95 | ≥0.95 |

---

## Color Legend (Applied to Diagrams)

| Color | Meaning |
|-------|---------|
| Blue (`#e6f3ff`) | Input nodes |
| Light blue (`#cce5ff`) | Processing nodes |
| Orange (`#fff0e6`) | Decision nodes |
| Green (`#d1e7dd`) | Success/Output nodes |
| Yellow (`#fff3cd`) | Warning/Early-exit nodes |
| Red (`#f8d7da`) | Error/Rejection nodes |
| Dark green (`#e6ffe6`) | Storage nodes |

---

## Related Files

- Original diagram: `.planning/spec-kit/reference/multi-stage-parser-pipeline-mermaid.md`
- Competitor intel roadmap: `.planning/spec-kit/refs/competitor-intel-roadmap.md`
- Known issues: `.planning/known-issues/`
- Parser implementation: `lib/competitor-intel/extraction/pipeline.ts`