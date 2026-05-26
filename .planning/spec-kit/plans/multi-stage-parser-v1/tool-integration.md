# Tool Integration — Final Decisions

**Context**: Multi-stage parser pipeline
**Status**: Decisions finalized. See `multi-stage-parser-v1.json` `tool_decisions` block.

---

## Decision Matrix

| Tool | Decision | Stage | Reason |
|------|----------|-------|--------|
| **Trafilatura** | ✅ ACCEPTED | Stage 0 | 98.5% reduction tested. Replaces Cheerio selector chain. |
| **Zod (zod@4.3.6)** | ✅ ACCEPTED | Stage 3 + 4 | Already installed. LLM output validation + cross-pair check. |
| **jq** | ❌ REJECTED (pipeline) | — | AI-generated jq is non-deterministic. Dev/debug only. |
| **DuckDB** | 🔜 DEFERRED | — | Not tested. Possible analytics use on competitor-ads.db. |
| **Outlines** | ❌ FAILED | — | pydantic_core wheel invalid. Zod replaces for validation. |
| **Newspaper4k** | ❌ NOT NEEDED | — | Trafilatura sufficient. |

---

## Trafilatura — Stage 0

**Tested results**:
| Post | Original | Clean | Reduction | Prices preserved |
|------|----------|-------|-----------|-----------------|
| SharePlan (0aea7978e7b3) | 82,054 | 1,271 | **98.5%** | 3 |
| Sample 1 | 87,781 | 1,665 | **98%** | 6 |
| Sample 2 | 98,764 | 2,179 | **98%** | 31 |

**Critical**: Use `include_tables=True` — Ppomppu price data often in `<table>` elements.

**Python bridge** (`scripts/trafilatura_extract.py`):
```python
import sys, json, trafilatura

html = sys.stdin.read()
metadata = trafilatura.extract_metadata(html)
body = trafilatura.extract(html, include_comments=False, include_tables=True, no_fallback=False)

json.dump({
    "title": metadata.title if metadata else "",
    "body": body or "",
    "originalChars": len(html),
    "cleanChars": len(body) if body else 0
}, sys.stdout)
```

**TypeScript call**:
```typescript
import { spawnSync } from "child_process";
const result = spawnSync(PYTHON_BIN, [TRAFILATURA_SCRIPT], {
  input: html, encoding: "utf8", timeout: 5000
});
const { title, body, originalChars, cleanChars } = JSON.parse(result.stdout);
```

**Install**: `source /parent/marketing-automation/.venv/bin/activate && uv pip install trafilatura`

**Language boundary**: Python ONLY for Stage 0 bridge. All other stages: TypeScript.

---

## Zod — Stage 3 + Stage 4

**Already installed**: `zod@4.3.6`

**Stage 3 schema** (`stage3-llm/schema.ts`):
```typescript
import { z } from "zod";

export const LlmProductSchema = z.object({
  name: z.string().min(1),
  price_krw: z.number().positive().nullable(),
  duration_months: z.number().positive().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string()
});

export const LlmOutputSchema = z.object({
  products: z.array(LlmProductSchema),
  postType: z.enum(["direct_offer", "affiliate", "promo_code", "comparison", "unknown"])
});
```

**Stage 4 cross-pair check**:
```typescript
// Pain 4 fix: price_per_month must be in plausible range
const pricePerMonth = price_krw / duration_months;
if (pricePerMonth < 500 || pricePerMonth > 50000) {
  // Reject as cross-paired artifact
}
```

---

## jq — Dev/Debug Only

**Valid uses** (manual, not automated):
```bash
# Inspect pipeline stage outputs
cat artifacts/competitor-ads/llm-cache/*.json | jq '.products[] | {name, price_krw}'

# Debug Stage 2 filtered blocks
jq '.cleanBlocks[] | select(.hasPrice)' stage2-debug.json
```

**NOT for**: automated pipeline steps. Noise patterns are deterministic regex — TypeScript is more maintainable.

---

## Architecture Impact Summary

**Trafilatura changes Stage 0 output**:
- Before: `{ titleElement, bodyElement, cleanHtml }` (HTML)
- After: `{ titleText, bodyText, reductionRatio }` (plain text)

**Cascades to Stage 2**:
- Removes `cheerio_extraction` step_0 (no DOM needed)
- Now: split `bodyText` by lines → apply regex patterns → score signal

**Cascades to Stage 3**:
- LLM receives `contentForLlm` (plain text, not HTML) → fewer tokens, cleaner context
- Zod validates output JSON → prevents hallucinated structures, catches cross-pairing

---

## References

- Trafilatura: https://trafilatura.readthedocs.io/
- Zod: https://zod.dev/
- spec: `stage-locate-v1.json` (Trafilatura implementation)
- spec: `stage-llm-extraction-v1.json` (Zod validation)
- spec: `multi-stage-parser-v1.json` `tool_decisions` block
