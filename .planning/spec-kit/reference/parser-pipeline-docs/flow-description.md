# Parser Pipeline - Flow Description

> **Purpose:** Human-readable explanation of each stage's logic
> **Design Intent:** Understanding the pipeline for debugging and maintenance
> **Change Impact:** Changes to any stage affect downstream behavior

---

## Overview

The multi-stage parser pipeline extracts structured product data from Korean OTT reseller ads on ppomppu.co.kr. It uses a **hybrid approach**: deterministic Cheerio parsing for clear signals, Ollama LLM for complex cases.

**Key principles:**
1. **Fail-closed:** Missing required evidence blocks persistence
2. **Cost optimization:** Skip LLM when signal is strong enough
3. **Early exit:** Affiliate/promo_code posts skip heavy extraction
4. **Confidence thresholds:** Each stage has clear quality gates

---

## Stage 0: LOCATE

**Purpose:** Extract clean title and body text from raw HTML

### Process
1. **Trafilatura (Python subprocess)** - Primary path
   - `extract_metadata()` → title
   - `extract(include_tables=True)` → bodyText
   - Returns clean plain text, stripped of HTML noise

2. **Cheerio fallback (TypeScript)** - If Trafilatura returns empty
   - Selectors: `h1, .title, meta og:title` for title
   - Selectors: `.content, .post-body, article` for body

### Output Quality
- `reductionRatio` = extracted text size / raw HTML size
- Good: ≥0.70 (Trafilatura did its job)
- Warn: <0.40 (HTML was noisy or Trafilatura failed)
- Bad: `trafilatura_empty_fallback_used` in warnings

### Why Trafilatura?
- Python library specialized in web article extraction
- Handles Korean text well
- Removes ads, navigation, boilerplate automatically

---

## Stage 1: CLASSIFY

**Purpose:** Determine extraction strategy based on post type

### Process
1. Build prompt: `titleText + bodyText`
2. Call Ollama `gemma2:9b` (fast, lightweight)
3. Parse JSON response: `{ postType, confidence, evidence }`

### Post Types
| Type | Meaning | Path |
|------|---------|------|
| `direct_offer` | Vendor selling OTT directly | Full pipeline |
| `affiliate` | Referral link to external site | Early exit |
| `promo_code` | Discount code only | Early exit |
| `comparison` | Comparing multiple products | Full + multi-product |
| `unknown` | Unclear classification | Full + review flag |

### Early Exit Logic
```
postType = 'affiliate' OR 'promo_code'
→ Skip Stages 2-5
→ Record referral URL or promo code only
→ Persist minimal record to SQLite
```

This saves LLM costs for posts that don't contain product pricing.

---

## Stage 2: NOISE FILTER

**Purpose:** Remove noise blocks and determine LLM requirement

### Process
1. Split `bodyText` into blocks by newline
2. Apply `noise_patterns` regex:
   - License text: "이용약관", "약관"
   - Payment info: "결제", "입금"
   - FAQ sections: "FAQ", "Q&A"
3. Score each block:
   - `hasPrice`: Contains "₩" or price numbers
   - `hasDuration`: Contains "개월", "일"
   - `hasProductKeyword`: Contains OTT names
4. Calculate `signalScore` = signal blocks / total blocks

### Decision Logic
```
signalScore ≥ 0.85
→ LLM SKIPPED
→ Use cleanBlocks directly in Stage 4

signalScore 0.6-0.85
→ LLM required
→ contentForLlm = filtered text

signalScore < 0.3
→ Noise-dominant (SharePlan posts often hit this)
→ Proceed with low confidence
```

### Why This Matters
- SharePlan posts often have 80% noise (policy text, FAQs)
- Filtering before LLM saves tokens and improves accuracy
- High signal means Cheerio can handle it alone

---

## Stage 3: LLM EXTRACT

**Purpose:** Extract structured products from pre-filtered content

### Process
1. Build prompt:
   - `titleText` (for implicit name resolution)
   - `contentForLlm` (filtered from Stage 2)
   - `postType` context (for comparison posts)
2. Call Ollama `gemma2:27b` (heavy, accurate)
3. Parse JSON output via Zod schema
4. Apply cross-pair artifact filter

### Implicit Name Resolution
Korean ads use shorthand:
- Post title: "기프티콩~ Netflix Premium"
- Body: "가족계정 ₩15,000 3개월"
- LLM must resolve "가족계정" → "Netflix Premium 가족계정"

Without title, LLM outputs generic junk like "가족계정" with no product context.

### Cross-Pair Artifact Filter
LLM sometimes pairs:
- Price from 6-month tier → 3-month product name
- This is detected via shared-prefix matching and rejected

### Zod Validation
If validation fails:
- Retry once with stricter prompt
- If still fails, reject and use HTML-only

---

## Stage 4: MERGE

**Purpose:** Combine Cheerio and LLM results, validate against catalog

### Process
1. **Voting logic:**
   - Match products by `name` and `duration`
   - Compare `price` from both sources
   - Assign `source` attribution

2. **Catalog validation:**
   - Check `product-catalog.json` for known products
   - Normalize names to canonical form
   - Reject unknown products (unless high confidence)

3. **Duplicate removal:**
   - Same name + duration = duplicate
   - Keep higher confidence version

4. **Compute `price_per_month_krw`:**
   - Normalize pricing across different duration tiers

### Source Attribution
```
source = 'mixed' → Both Cheerio and LLM agreed
  → confidence ≥ 0.9 (voted)

source = 'html' → Only Cheerio had this product
  → confidence 0.7-0.8

source = 'llm' → Only LLM had this product
  → confidence 0.7-0.8
```

---

## Stage 5: EVIDENCE

**Purpose:** Attach source excerpts for debugging and transparency

### Process
1. For each product field (`name`, `price`, `duration`):
   - Find source block that contained this value
   - Extract excerpt ≤160 characters
   - Attach `EvidenceLink` with `source_type` (html/llm)

2. Build `evidenceChain` array for full provenance

### Fail-Closed Rule
```
name_evidence missing
→ readyForPersist = false
→ But still proceeds with lowered confidence
→ Warning added
```

This ensures every persisted record has debugging capability. You can always trace back to the source text.

---

## Stage 6: DEDUP

**Purpose:** Prevent duplicate posts from cluttering the database

### Process
1. Generate embedding:
   - Model: `nomic-embed-text` (768 dimensions)
   - Input: `title + body` concatenated
2. Compare cosine similarity against stored embeddings
3. Decision:
   - `<0.85`: Unique → persist
   - `≥0.95`: Duplicate → skip, log postId
   - `0.85-0.95`: Similar → flag, persist anyway

### Why Embeddings?
- Exact match fails when vendors repost with slight changes
- Semantic similarity catches "Netflix Premium 3개월" vs "Premium Netflix 3개월"

---

## Complete Flow Summary

```
Raw HTML
    ↓
[S0: LOCATE] Trafilatura → titleText, bodyText
    ↓
[S1: CLASSIFY] gemma2:9b → postType
    ↓
    ├─ affiliate/promo_code → EARLY EXIT → SQLite (minimal)
    │
    └─ direct_offer/comparison → Continue
        ↓
    [S2: NOISE FILTER] Regex → signalScore
        ↓
        ├─ ≥0.85 → LLM SKIPPED
        └─ 0.6-0.85 → LLM required
        ↓
    [S3: LLM EXTRACT] gemma2:27b → llmProducts
        ↓
    [S4: MERGE] Vote + Catalog → finalProducts
        ↓
    [S5: EVIDENCE] Provenance → productsWithEvidence
        ↓
    [S6: DEDUP] Embedding → uniquePosts
        ↓
        ├─ Unique → SQLite (full record)
        └─ Duplicate → Drop
```

---

## Performance Characteristics

| Stage | Avg Time | Cost Factor |
|-------|----------|-------------|
| S0 | 200ms | Low (Python subprocess) |
| S1 | 500ms | Medium (gemma2:9b) |
| S2 | 50ms | Free (TypeScript regex) |
| S3 | 2-5s | High (gemma2:27b) - **skipped 30% of time** |
| S4 | 100ms | Free (TypeScript) |
| S5 | 100ms | Free (TypeScript) |
| S6 | 300ms | Low (embedding API) |

**Total pipeline:** 3-8 seconds per post (depending on LLM skip)

---

## Known Issues

1. **KE-001:** Scheduler reverts to 60-min interval after publish (see `.planning/known-issues/KE-001-scheduler-gap-recheck.md`)

2. **SharePlan posts:** Often have `signalScore < 0.3` due to extensive policy text. Pipeline proceeds with low confidence.

3. **Implicit names:** Must pass `titleText` to LLM or output is generic junk.

4. **Cross-pairing:** LLM may mix prices across tiers. Filter catches this.

---

## Debugging Tips

1. **Check `reductionRatio`** in Stage 0 output - low ratio means Trafilatura struggled

2. **Check `signalScore`** in Stage 2 output - tells you if LLM was needed

3. **Check `sourceAttribution`** in Stage 4 output - shows which source won

4. **Check `evidenceChain`** in Stage 5 output - trace back to source text

5. **Check `similarityScores`** in Stage 6 output - see why duplicate was detected