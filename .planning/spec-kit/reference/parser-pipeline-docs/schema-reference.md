# Parser Pipeline - Schema Reference

> **Purpose:** Detailed type definitions for each stage's input/output
> **Design Intent:** Fail-closed validation, confidence thresholds, evidence traceability
> **Change Impact:** All downstream consumers depend on these contracts

---

## Stage 0: LOCATE

### Input
```typescript
interface Stage0Input {
  rawHtml: string;        // Full HTML from Crawlee request-handler
  postUrl: string;        // Canonical URL for the post
}
```

### Output
```typescript
interface Stage0Output {
  titleText: string;      // Clean title from Trafilatura or Cheerio fallback
  bodyText: string;       // Clean plain text body
  reductionRatio: number; // 0-1: ratio of extracted text to raw HTML size
  
  // Quality thresholds
  // ✅ Good:  ratio ≥ 0.70
  // ⚠️ Warn:  ratio < 0.40
  // ❌ Bad:   warnings contains 'trafilatura_empty_fallback_used'
  
  warnings: string[];     // ['trafilatura_empty_fallback_used'] if Cheerio used
}
```

---

## Stage 1: CLASSIFY

### Input
```typescript
interface Stage1Input {
  titleText: string;      // From Stage0Output
  bodyText: string;       // From Stage0Output
}
```

### Output
```typescript
interface Stage1Output {
  postType: PostType;     // 'direct_offer' | 'affiliate' | 'promo_code' | 'comparison' | 'unknown'
  classifierConfidence: number; // 0-1
  
  classifierEvidence: {
    excerpt: string;      // Key text snippet used for classification
    reasoning: string;    // LLM's reasoning for the classification
  };
  
  // Quality thresholds
  // ✅ Good:  confidence ≥ 0.9, postType = direct_offer
  // ⚠️ Review: postType = unknown
  // ❌ Bad:   confidence < 0.5
}

// Early Exit Paths:
// - postType = 'affiliate' → Record referral URL only, skip Stages 2-5
// - postType = 'promo_code' → Record promo code only, skip Stages 2-5
```

---

## Stage 2: NOISE FILTER

### Input
```typescript
interface Stage2Input {
  bodyText: string;       // From Stage0Output
}
```

### Output
```typescript
interface Stage2Output {
  cleanBlocks: CleanBlock[];
  filterReasons: FilterReason[];
  signalScore: number;    // 0-1: fraction of blocks with signal
  llmRequired: boolean;   // true if signalScore < 0.85
  contentForLlm: string;  // Pre-filtered text for LLM prompt
  
  // Quality thresholds
  // ✅ Good:  signalScore ≥ 0.85 → LLM SKIPPED
  // ⚠️ Medium: 0.6-0.85 → LLM runs
  // ❌ Bad:   score < 0.3 (SharePlan noise-dominant post)
}

interface CleanBlock {
  text: string;
  hasPrice: boolean;      // Contains price pattern (e.g., "₩29,900")
  hasDuration: boolean;   // Contains duration pattern (e.g., "3개월")
  hasProductKeyword: boolean; // Contains OTT keywords (e.g., "Netflix", "YouTube")
}

interface FilterReason {
  blockIndex: number;
  reason: string;         // 'noise_license' | 'noise_payment' | 'noise_faq'
  pattern: string;        // Regex pattern that triggered filter
}
```

---

## Stage 3: LLM EXTRACT

### Input
```typescript
interface Stage3Input {
  titleText: string;      // For implicit name resolution
  contentForLlm: string;  // From Stage2Output
  postType: PostType;     // For context injection (comparison posts)
}
```

### Output
```typescript
interface Stage3Output {
  llmProducts: LlmProduct[];
  promptContext: string;  // Full prompt sent to LLM
  llmConfidence: number;  // 0-1: aggregate confidence across products
  skipped: boolean;       // true if Stage 2 skipped LLM
  
  // Quality thresholds
  // ✅ Good:  llmConfidence ≥ 0.7, catalog match
  // ⚠️ Retry: Zod validation fail → retry once with stricter prompt
  // ❌ Bad:   cross-pair artifact | junk generic name (rejected)
}

interface LlmProduct {
  name: string;           // Product name (resolved from title if implicit)
  duration?: string;      // e.g., "3개월", "6개월"
  price?: number;         // Price in KRW
  confidence: number;     // 0-1
  evidence: string;       // Text snippet supporting extraction
}
```

### Known Pitfalls
- **Implicit names:** Korean ads use shorthand like "가족계정" (family account) without product name. Title must be passed for resolution.
- **Cross-pairing:** LLM may pair price from one tier with name of another. `filterCrossPairedArtifacts()` catches this.
- **Junk detection:** Generic names like "가격" (price) are rejected via regex.

---

## Stage 4: MERGE

### Input
```typescript
interface Stage4Input {
  cleanBlocks: CleanBlock[];  // From Stage2Output (Cheerio results)
  llmProducts: LlmProduct[];  // From Stage3Output
  skipped: boolean;           // If LLM was skipped
}
```

### Output
```typescript
interface Stage4Output {
  finalProducts: FinalProduct[];
  sourceAttribution: SourceAttribution[];
  confidenceBreakdown: {
    overall: number;
    perProduct: number[];
  };
  warnings: string[];
  
  // Quality thresholds
  // ✅ Good:  source = 'mixed', confidence ≥ 0.9
  // ⚠️ OK:   single source, confidence 0.7-0.8
  // ❌ Bad:   finalProducts = [] | catalog rejection | warnings populated
}

interface FinalProduct {
  name: string;
  duration?: string;
  price?: number;
  source: 'html' | 'llm' | 'mixed';  // Which extraction source won
  confidence: number;
  price_per_month_krw?: number;      // Computed from price/duration
}

interface SourceAttribution {
  productId: string;
  sources: ('html' | 'llm')[];
  votes: number;  // How many sources agreed
}
```

### Catalog Validation
Products are validated against `product-catalog.json`:
- Rejects products not in catalog (unless high confidence)
- Normalizes product names to canonical form
- Computes `price_per_month_krw` for comparison

---

## Stage 5: EVIDENCE

### Input
```typescript
interface Stage5Input {
  finalProducts: FinalProduct[];  // From Stage4Output
  cleanBlocks: CleanBlock[];      // For HTML evidence extraction
  llmProducts: LlmProduct[];      // For LLM evidence extraction
}
```

### Output
```typescript
interface Stage5Output {
  productsWithEvidence: ProductWithEvidence[];
  evidenceChain: EvidenceLink[];
  readyForPersist: boolean;
  
  // Quality thresholds
  // ✅ Good:  readyForPersist = true, all evidence links present
  // ❌ Bad:   missing name_evidence → confidence lowered + warning
}

interface ProductWithEvidence {
  name: string;
  name_evidence: EvidenceLink;    // REQUIRED - fail-closed
  price_evidence?: EvidenceLink;
  duration_evidence?: EvidenceLink;
}

interface EvidenceLink {
  source_type: 'html' | 'llm';
  excerpt: string;        // ≤160 characters
  confidence: number;     // 0-1
}
```

### Fail-Closed Rule
`name_evidence` must exist. If missing:
- `readyForPersist` = false (but still proceeds with lowered confidence)
- Warning added to output
- This ensures debugging capability for all persisted records

---

## Stage 6: DEDUP

### Input
```typescript
interface Stage6Input {
  productsWithEvidence: ProductWithEvidence[];
  title: string;
  body: string;
}
```

### Output
```typescript
interface Stage6Output {
  uniquePosts: boolean;
  duplicateIds: string[];
  similarityScores: SimilarityScore[];
  
  // Decision thresholds
  // ✅ Unique:    similarity < 0.85 → persist
  // ⏭️ Duplicate: similarity ≥ 0.95 → skip + log
  // ⚠️ Similar:   similarity 0.85-0.95 → flag + persist
}

interface SimilarityScore {
  postId: string;
  score: number;  // Cosine similarity 0-1
}
```

### Embedding Details
- Model: `nomic-embed-text` (768 dimensions)
- Input: `title + body` concatenated
- Storage: `artifacts/competitor-ads/embeddings/`
- Comparison: Cosine similarity against all stored embeddings

---

## Final Output: SQLite Record

```typescript
interface PpomppuParsedRecord {
  postId: string;
  postUrl: string;
  vendor: string;
  title: string;
  
  // Classification
  postType: PostType;
  classifierConfidence: number;
  
  // Products
  products: ProductWithEvidence[];
  
  // Metadata
  extractedAt: Date;
  pipelineVersion: string;
  reductionRatio: number;
  signalScore: number;
  finalConfidence: number;
  
  // Dedup
  embeddingId?: string;
  similarityFlag?: boolean;
}

// Minimal record for early-exit paths:
interface ReferralPromoRecord {
  postId: string;
  postUrl: string;
  vendor: string;
  title: string;
  postType: 'affiliate' | 'promo_code';
  referralUrl?: string;
  promoCode?: string;
  extractedAt: Date;
}
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

## Error Handling

| Error Type | Stage | Recovery |
|------------|-------|----------|
| Trafilatura empty | S0 | Cheerio fallback |
| Zod validation fail | S3 | Retry once with stricter prompt |
| Cross-pair artifact | S3 | Reject, use HTML-only |
| Catalog rejection | S4 | Add warning, proceed |
| Missing name_evidence | S5 | Lower confidence, add warning |
| Duplicate detected | S6 | Skip persist, log postId |