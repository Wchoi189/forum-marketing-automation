# Pipeline Pain Points Report

**Target**: Next AI Agent
**Context**: Multi-stage parser refactor needed
**Run**: `artifacts/competitor-ads/market-data-2026-05-26-b/`

---

## Pain 1: LLM Reads Noise

**Problem**: LLM gets garbage. 90%+ license text. Signal buried.

**Evidence**:
```
artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/0aea7978e7b3.html
Content length: 1764 chars
Price patterns found: 1 (in LICENSE LINE)
Product lines with price: 0
License lines: 15
```

**Fix**: Stage 2 filter BEFORE LLM. Remove footer patterns. See `stage-noise-filter-v1.json`.

---

## Pain 2: No Per-Product Confidence

**Problem**: One confidence number. Can't tell which product is real vs hallucinated.

**Evidence**:
```
artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/eb67ebba985c.html
Cheerio confidence: 0.45, products: 0
LLM sometimes extracts 3, sometimes 4 products (non-deterministic)
```

**Fix**: Stage 5 evidence chain. Each product has `source`, `confidence`, `excerpt`. See `stage-evidence-v1.json`.

---

## Pain 3: Implicit Names Not Resolved

**Problem**: Body says "가족계정". Title says "유튜브 프리미엄". LLM must connect dots.

**Evidence**:
```
artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/eb67ebba985c.html
Title: "유튜브 프리미엄,뮤직 가족계정,개인계정 1달4000원"
Body: "가족계정 17,000원" (no product name)
```

**Current**: LLM gets title. Sometimes works. Sometimes fails.
**Fix**: Stage 3 always gets title + filtered body. See `stage-llm-extraction-v1.json`.

---

## Pain 4: Cross-Pairing Errors

**Problem**: LLM pairs 6-month price with 3-month name. Wrong tier.

**Evidence**:
```
text-extraction.ts has filterCrossPairedArtifacts() to fix this
But happens after extraction. Not prevented.
```

**Fix**: Stage 4 merge validates tier consistency. See `stage-merge-v1.json`.

---

## Pain 5: High-Confidence Still Calls LLM

**Problem**: Cheerio confidence 0.9+. Still runs LLM. Waste of time.

**Evidence**:
```
artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/551b849c00f1.html
Cheerio confidence: 0.9, products: 1
HTML path wins anyway. LLM call unnecessary.
```

**Fix**: Stage 2 skip condition. `signalScore >= 0.85` → skip Stage 3. See `stage-noise-filter-v1.json`.

---

## Pain 6: Junk Not Rejected Early

**Problem**: "OTT 구독", "가격" extracted as products. Generic junk.

**Evidence**:
```
artifacts/competitor-ads/market-data-2026-05-26-b/raw_html/9446cd3682da.html
HTML products: "OTT 구독" (junk=true)
Products like junk detected AFTER extraction.
```

**Fix**: Stage 2 catalog filter. Reject non-matching names early. See `stage-noise-filter-v1.json` patterns.

---

## Pain 7: No Debug Trail

**Problem**: Ask "why this product?" → trace 300 lines of code. No answer.

**Evidence**:
```
request-handler.ts lines 60-140: decision logic buried
HTML vs LLM vs OCR vote happens inline
No log of which source won for which product
```

**Fix**: Stage 4 source attribution. Stage 5 evidence chain. See `stage-merge-v1.json`, `stage-evidence-v1.json`.

---

## Verification Artifacts

| Post ID | Path | Issue |
|---------|------|-------|
| `0aea7978e7b3` | `raw_html/0aea7978e7b3.html` | Noise dominant, 0 real prices |
| `eb67ebba985c` | `raw_html/eb67ebba985c.html` | Implicit names, LLM non-deterministic |
| `551b849c00f1` | `raw_html/551b849c00f1.html` | HTML wins at 0.9, LLM unnecessary |
| `9446cd3682da` | `raw_html/9446cd3682da.html` | Junk extracted, cheerio products bad |

**DB**: `artifacts/competitor-ads/competitor-ads.db` (146 records, 26 vendors)

---

## Run Pipeline Analysis

```bash
npx tsx scripts/analyze-problems.ts
```

Shows 3 problematic files. SharePlan (0aea7978e7b3) not in list because Cheerio finds 0 products → no problem flagged. But LLM will hallucinate from noise.

---

## Spec References

| Spec | Purpose |
|------|---------|
| `stage-structure-v1.json` | Cheerio extraction, block locations |
| `stage-noise-filter-v1.json` | Filter patterns, signal score |
| `stage-llm-extraction-v1.json` | LLM with filtered input, skip condition |
| `stage-merge-v1.json` | Vote logic, catalog validation |
| `stage-evidence-v1.json` | Evidence chain per-product |

---

## Implementation Order

1. Stage 1 → Structure (extract blocks)
2. Stage 2 → Filter (remove noise, score signal)
3. Stage 3 → LLM (only if needed)
4. Stage 4 → Merge (vote, validate)
5. Stage 5 → Evidence (attach excerpts)

Total: 6 slices, ~23 hours.

---

**Handover**: `.agent/session-handovers/handover-20260526-1600.json`