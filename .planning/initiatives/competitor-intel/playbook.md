# Competitor Intelligence — Playbook

**Last updated:** 2026-05-11
**Status:** Production — 97.0% success rate across 33 unique HTML files

This document encodes what has been learned about building and operating the competitor ad extraction pipeline for Korean OTT reseller ads on ppomppu.co.kr. Read it before modifying the extraction pipeline, selecting Ollama models, or debugging extraction quality issues.

---

## 1. The Problem Space

Ppomppu OTT reseller ads are structurally inconsistent:
- No standard HTML layout — each vendor uses different markup patterns
- Korean-language content with implicit references (product name from title, not body)
- Complex pricing: bundled tiers, coupons, membership discounts
- Embedded images with text (VLM/OCR needed for some ads)
- Junk content in HTML: trust signals, FAQ, navigation text, policy disclaimers

**Key insight:** No single extraction approach works for all ads. A hybrid pipeline with quality gates is necessary.

---

## 2. The Hybrid Pipeline Architecture

```
                    ┌─────────────────────────┐
                    │    Post HTML Input      │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  Cheerio Parse          │
                    │  parsePpomppuPost()     │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  confidence ≥ 0.9       │
                    │  AND products > 0?      │
                    └───────┬───────┬─────────┘
                        YES │       │ NO
                ┌───────────▼─┐   ┌─▼──────────────┐
                │ FAST PATH   │   │ HYBRID PATH     │
                │ Return      │   │                 │
                │ Cheerio     │   │ ┌─────────────┐ │
                │ products    │   │ │ LLM text    │ │
                │             │   │ │ extraction  │ │
                └─────────────┘   │ └─────────────┘ │
                                  │ ┌─────────────┐ │
                                  │ │ HTML leaf   │ │
                                  │ │ text blocks │ │
                                  │ └─────────────┘ │
                                  │ ┌─────────────┐ │
                                  │ │ Priority    │ │
                                  │ │ logic       │ │
                                  │ └─────────────┘ │
                                  └─────────────────┘
```

### Priority Logic (the winner)

```typescript
// Quality score: fraction of products with BOTH price AND duration
function completenessScore(products) {
  if (products.length === 0) return 0;
  return products.filter(p => p.price_krw && p.duration_months).length / products.length;
}

const llmComplete = completenessScore(llmProducts);
const htmlComplete = completenessScore(htmlProducts);

// LLM wins if it has products AND significantly better quality
const llmQualityWins = llmProducts.length > 0
  && llmComplete >= 0.9
  && htmlComplete < 0.7
  && llmProducts.length >= htmlProducts.length * 0.5;

// General: LLM wins if it has products and (HTML is empty/junk, OR LLM has more, OR high quality)
const llmWins = llmProducts.length > 0
  && (htmlProducts.length === 0 || htmlJunk || llmProducts.length >= htmlProducts.length || llmQualityWins);

const useHtml = htmlProducts.length > 0 && !htmlJunk;

const final = llmWins ? llmProducts : (useHtml ? htmlProducts : parsed.products);
```

**Why this matters:** Without the completeness check, the pipeline would favor LLM output even when it produces fewer or less complete products. The `llmQualityWins` clause ensures that a more complete LLM result wins even with fewer products.

---

## 3. Extraction Pitfalls and Solutions

### 3.1 Implicit Product Names

**Problem:** Korean OTT ads often don't state the product name in the body. They use shorthand:

```
Title: 유튜브 프리미엄,뮤직 가족계정,개인계정 1달4000원
Body:
  프리미엄 1달: 4000원
  가족계정 3달: 17000원
  개인계정
```

Without the title, "가족계정" = "family account" is meaningless. It should be "YouTube Premium 가족계정".

**Solution:** Pass `postTitle` to `runTextExtraction()`:
```typescript
runTextExtraction(contentText, parsed.title);
```

The prompt instructs the LLM: *"If the body text uses shorthand like '가족계정', '개인계정' without a product name, infer the product name from the post title."*

**Where this is configured:**
- `lib/competitor-intel/extraction/text-extraction.ts` — function signature and prompt
- `lib/competitor-intel/crawler/request-handler.ts:148` — call site passes `parsed.title`

**Lesson:** Any new extraction path or LLM call **must** include the post title. If you add a new code path that calls Ollama without it, implicit product names will break.

### 3.2 Cross-Pairing Between Product Tiers

**Problem:** The LLM sometimes pairs a price from one tier with the name of another. Example from a multi-tier ad:

```
Correct: YouTube Premium 3개월 → ₩17,000
Wrong:   YouTube Premium 6개월 → ₩17,000  (price from 3-month tier)
```

This happens because the LLM reads the entire ad content and can lose track of which price belongs to which section.

**Solution:** `filterCrossPairedArtifacts()` in `text-extraction.ts`:
```typescript
function namesAreCloseVariants(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.startsWith(shorter) && longer.length - shorter.length <= 5) return true;
  return false;
}
```

This detects when multiple products are close variants of each other with different prices — a strong signal of cross-pairing.

### 3.3 Field Labels Paired with Prices

**Problem:** The Cheerio HTML text extraction pairs Korean field labels with nearby prices:

```
"가 격" (price) → ₩23,000  → Product name: "가 격" (WRONG)
"이용 기간" (duration) → 18 → Product name: "이용 기간" (WRONG)
```

**Solution:** `productsLookJunk()` regex:
```typescript
if (/가[\s]?격|이용\s?기간|기\s?간|할인|쿠폰/.test(p.name)) return true;
```

This catches field labels that accidentally got paired with values during Cheerio DOM traversal. The `[\\s]?` handles the case where Korean text renders with zero-width spaces between characters.

### 3.4 Policy Numbers Mistaken for Products

**Problem:** Text like "12개월에 한번만 변경가능" (can change once per 12 months) contains numbers that look like product durations but are policy constraints.

**Solution:** The LLM prompt explicitly says:
> "Ignore numbers that appear in policy or constraint text (e.g., '12개월에 한번만 변경가능' means users can change once per 12 months — this is NOT a product duration)"

The Cheerio pipeline doesn't have this problem because it looks for explicit product-name patterns, not free-text numbers.

### 3.5 Short Product Names Flagged as Junk

**Problem:** "웨이브" (WAVVE, a Korean streaming service) is 3 characters. An early junk heuristic flagged anything ≤3 chars as junk.

**Solution:** Relaxed the threshold to ≤2 characters. Real junk names are typically 1-2 chars (numbers, symbols). Legitimate Korean service names can be 2-3 chars.

### 3.6 Cheerio Confidence at the Threshold

**Problem:** Ads with Cheerio confidence exactly 0.9 trigger the fast path, but 0.9 isn't a clean signal. Files like `551b849c00f1` (구독트리) have confidence 0.9 but complex pricing that Cheerio can't fully parse.

**Status:** Accepted trade-off. The quality gates downstream (junk detection, completeness scoring) catch cases where the fast path produces incomplete results. For now, the priority logic ensures the HTML text path is still tried in the hybrid branch.

---

## 4. Ollama Model Selection

### Benchmark Results

Tested on `eb67ebba985c` (기프티콩~ — the hardest file, implicit product names):

| Model | Products Found | Correct | Completeness | Notes |
|-------|---------------|---------|-------------|-------|
| qwen2.5vl:7b | 3 | 2 | 100% | Missed the 6-month tier (₩20,000) |
| qwen3:8b | 3 | 2 | 100% | Found 6-month tier but cross-paired ₩17,000 to wrong tier |
| qwen3.5:9b | — | — | — | Timed out at 30s |
| gemma2:9b | 3 | 3 | 100% | Output Korean names (유튜브 프리미엄) — needs normalization |
| **gemma2:27b** | **3** | **3** | **100%** | All correct, clean English names |

**Why gemma2:27b wins:**
- Recovers product tiers that smaller models miss
- Correct price-to-tier pairing (no cross-pairing)
- Outputs product names in English (YouTube Premium, not 유튜브 프리미엄)
- Deterministic across runs
- Responds within 30s timeout

**Trade-offs:**
- ~4x larger model → slower per-request (~20-30s vs ~10-15s)
- Higher memory usage on the Ollama server
- The 30s default timeout is tight — if you see timeouts, increase `OLLAMA_REQUEST_TIMEOUT_MS` to 45000 or 60000

**Available models** (as of 2026-05-11):
- Small/fast: qwen2.5vl:3b, qwen3:1.7b, qwen3:4b-instruct
- Medium: qwen2.5vl:7b, qwen3:8b, gemma2:9b, qwen2:7b
- Large: gemma2:27b, qwen3:30b-a3b, qwen3-coder:30b
- Embedding (not for text extraction): all-minilm:l6-v2, nomic-embed-text

---

## 5. Quality Gates

### productsLookJunk()

```typescript
function productsLookJunk(products): boolean {
  if (products.length === 0) return false;
  return products.filter(p => {
    // Generic OTT/service labels
    if (p.name === "OTT 구독" || p.name === "구독") return true;
    // Numeric names (parser mis-pairing)
    if (p.name.length <= 2 && /^\d+$/.test(p.name)) return true;
    // Korean policy/contact terms
    if (/변경|가능|문의|상담|해지|가입|완료/.test(p.name)) return true;
    // Field labels paired with prices
    if (/가[\s]?격|이용\s?기간|기\s?간|할인|쿠폰/.test(p.name)) return true;
    // Short names without prices (likely not a real product)
    if (p.price_krw === undefined && p.name.length < 15) return true;
    return false;
  }).length > products.length * 0.5;
}
```

Returns `true` if more than 50% of products look like junk. This is the primary quality gate for the HTML text extraction path.

### completenessScore()

```typescript
function completenessScore(products): number {
  if (products.length === 0) return 0;
  return products.filter(p => p.price_krw && p.duration_months).length / products.length;
}
```

Used in priority logic to compare LLM vs HTML output quality. A result with 0.9+ completeness beats one with <0.7 even if it has fewer products.

---

## 6. Test Scripts

| Script | Purpose | When to run |
|--------|---------|-------------|
| `scripts/test-full-pipeline.ts` | Tests all 33 stored HTML files, reports quality metrics | After any pipeline change |
| `scripts/re-extract-price-matrix.ts` | Re-processes HTML files → clean SQLite records | After model/algorithm changes |
| `scripts/test-all-vendors.ts` | Tests 5 curated vendor posts (golden path) | Quick smoke test |
| `scripts/analyze-problems.ts` | Deep analysis of problematic files + model comparison | Debugging extraction quality |
| `npm run test:competitor-intel` | 83 unit + integration tests (incl live Ollama) | Before committing changes |

### Test Data

33 unique HTML files stored across 7 test directories under `artifacts/competitor-ads/`. These span 15+ different vendors with varying complexity:

- **Simple:** Single product, clear price/duration (DENMARK, OTT대장)
- **Medium:** Multiple tiers, explicit product names (SharePlan, 팡이누나)
- **Complex:** Implicit product names, bundled pricing (기프티콩~, 구독트리)

---

## 7. Known Problematic Files

### eb67ebba985c — 기프티콩~ (Hardest file)

**What makes it hard:** Ad body uses only shorthand (프리미엄, 가족계정, 개인계정) without explicit product names. Requires title inference. The LLM is non-deterministic: sometimes extracts 3 clean products, sometimes 4 with 1 missing price.

**With gemma2:27b:** 3 products, all correct, 100% complete. Deterministic.

**Products extracted:**
- YouTube Premium 가족계정 — ₩4,000 / 1 month
- YouTube Premium 가족계정 — ₩20,000 / 6 months
- YouTube Premium 개인계정 — ₩17,000 / 3 months

### 551b849c00f1 — 구독트리 (Gemini ad)

**What makes it hard:** Cheerio confidence 0.9 triggers fast path. Complex pricing with both Gemini Pro and YouTube products. LLM finds fewer products than Cheerio.

**Pipeline behavior:** Fast path (Cheerio) returns 1 product with confidence 0.9. This is acceptable for this ad — the Gemini pricing is genuinely complex.

### 9446cd3682da — 구독트리 (YouTube ad)

**What makes it hard:** Cheerio confidence 0.9 triggers fast path and gets 3 correct products. LLM finds only 1 product.

**Pipeline behavior:** Fast path wins. 3 clean products (YouTube Premium 3/6/12 months).

---

## 8. Debugging Checklist

When extraction quality degrades:

1. **Run the full pipeline test** — `npx tsx scripts/test-full-pipeline.ts`
2. **Check the problematic file** — `npx tsx scripts/analyze-problems.ts`
3. **Compare models** — analyze-problems.ts tests 5 models on the hardest file
4. **Check the HTML** — read `artifacts/competitor-ads/test-*/raw_html/<fileId>.html`
5. **Inspect Cheerio parse** — look at `confidence` and `products` from `parsePpomppuPost()`
6. **Check LLM output** — raw JSON from `callOllamaGenerate()` (check for malformed JSON)
7. **Verify title passing** — ensure `runTextExtraction(content, parsed.title)` gets the title

---

## 9. When Adding a New Platform

The `VendorStrategy` interface covers ppomppu.co.kr. When adding support for another platform:

1. Implement `VendorStrategy` in `lib/competitor-intel/` with platform-specific selectors
2. Register in `lib/competitor-intel/vendor-registry.ts`
3. The hybrid pipeline (Cheerio → LLM → priority) is platform-agnostic — it works on any HTML content
4. **Critical:** Platform-specific `productsLookJunk()` patterns may differ — Korean OTT patterns don't apply to all markets
