# Model Recommendations for Pipeline Testing

**Target**: Next AI Agent
**Context**: Use local Ollama for iterative testing
**Endpoint**: `http://ollama:11434`

---

## Current Models Available

| Model | Size | Use Case | Notes |
|-------|------|----------|-------|
| `gemma2:27b` | 15.6GB | **Primary extraction** | Default for `OLLAMA_OCR_MODEL`. Best accuracy, slower. |
| `gemma2:9b` | 5.4GB | Fast extraction | Good for quick tests, 4x faster than 27b. |
| `qwen3:30b-a3b` | 18.5GB | Complex reasoning | Large model for classification tasks. |
| `qwen3.5:9b` | 6.5GB | Balanced | Good trade-off between speed and accuracy. |
| `qwen3:8b` | 5.2GB | Fast fallback | Quick iteration testing. |
| `qwen2.5vl:7b` | 5.9GB | **OCR/VLM** | Vision model for image extraction. |
| `qwen2.5vl:3b` | 3.2GB | OCR fallback | Faster vision, lower accuracy. |
| `qwen3-coder:30b` | 18.5GB | Code generation | For implementation work. |
| `exaone3.5:latest` | 4.7GB | Korean specialist | Samsung model, good for Korean text. |
| `nomic-embed-text` | 274MB | Embedding | For semantic similarity, dedup. |
| `all-minilm:l6-v2` | 46MB | Fast embedding | Lightweight dedup check. |

---

## Recommended Usage

### Stage 2 - Classification (Post Type Detection)
**Task**: Classify post type → direct_offer | affiliate | promo_code | comparison

**Recommended Models**:
1. `gemma2:9b` - Fast, good for binary/multi-class classification
2. `qwen3.5:9b` - Korean language specialist, handles marketing bloated titles
3. `exaone3.5:latest` - Samsung Korean model, excellent for Korean NLU

**Prompt Strategy**: Single-pass classification with structured output.

### Stage 3 - Extraction (Product Info)
**Task**: Extract name, price, duration, terms from filtered content

**Recommended Models**:
1. `gemma2:27b` - Best accuracy, handles implicit names from title
2. `qwen3:30b-a3b` - Complex reasoning for bloated marketing titles
3. `qwen3.5:9b` - Balanced, good for iterative testing

**Prompt Strategy**: Pass title + body. Require JSON output. Use catalog matching.

### OCR/VLM (Image-based Posts)
**Task**: Extract pricing from embedded images

**Recommended Models**:
1. `qwen2.5vl:7b` - Primary OCR model
2. `qwen2.5vl:3b` - Fast iteration, fallback

**Note**: SharePlan posts have pricing in images. OCR required.

### Deduplication
**Task**: Detect redundant scraping, similar posts

**Recommended Models**:
1. `nomic-embed-text` - Semantic similarity for post content
2. `all-minilm:l6-v2` - Fast embedding check

---

## Recommended Additional Models (Not Installed)

### For Classification
| Model | Size | Why Install |
|-------|------|-------------|
| `llama3.1:8b` | 4.7GB | Fast, general classification |
| `mistral:7b` | 4.1GB | Efficient, good for structured output |
| `deepseek-r1:7b` | 4.7GB | Reasoning model, handles complex intent |

### For Korean-specific
| Model | Size | Why Install |
|-------|------|-------------|
| `gemma2:27b-instruct` | 15.6GB | Better instruction following for Korean |

### For Embedding/Dedup
| Model | Size | Why Install |
|-------|------|-------------|
| `snowflake-arctic-embed` | 229MB | Better Korean embedding |

**Install Command**:
```bash
ollama pull <model_name>
```

---

## Iterative Testing Protocol

### Quick Test (Fast Feedback)
```bash
# Use small model for rapid iteration
OLLAMA_OCR_MODEL=qwen3:8b npx tsx scripts/test-extraction.ts

# Test single post
npx tsx scripts/test-single-post.ts --id eb67ebba985c --model gemma2:9b
```

### Full Validation
```bash
# Use primary model
OLLAMA_OCR_MODEL=gemma2:27b npm run test:competitor-intel

# Run problematic files
npx tsx scripts/analyze-problems.ts
```

### Model Comparison
```bash
# Compare models on hardest file
npx tsx scripts/analyze-problems.ts --model gemma2:27b
npx tsx scripts/analyze-problems.ts --model qwen3.5:9b
npx tsx scripts/analyze-problems.ts --model exaone3.5:latest
```

---

## Model Selection Matrix

| Task | Speed Priority | Accuracy Priority | Korean Specialist |
|------|----------------|-------------------|-------------------|
| Classification | `gemma2:9b` | `gemma2:27b` | `exaone3.5` |
| Extraction | `qwen3.5:9b` | `gemma2:27b` | `exaone3.5` |
| OCR | `qwen2.5vl:3b` | `qwen2.5vl:7b` | - |
| Dedup | `all-minilm` | `nomic-embed` | - |

---

## Why Rule-Based Won't Work

**Half of posts require high-dimensional thinking**:

1. **Bloated marketing titles**:
   - "최저가 보장! 정식 사업자 7년 무사고! 가족계정 4인 공유!" → Real product: "YouTube Premium 가족"
   - Rule can't extract product name from marketing noise.

2. **Affiliate marketing**:
   - Post refers to GamsGo, AllKeyShop → Not selling directly.
   - Promo codes instead of pricing.
   - Must classify post type BEFORE extraction.

3. **Implicit naming**:
   - Body: "가족계정 17,000원" → Title: "유튜브 프리미엄"
   - Product name in title, price in body. Must connect.

4. **Comparison posts**:
   - "공식 가격 14,900원 vs 우리 가격 9,900원"
   - Two prices. Must identify which is offer price.

**Solution**: Multi-stage classifier → THEN parser. Not parser first.

---

## Revised Pipeline Architecture

```
Stage 0: LOCATE (Trafilatura)
├─ trafilatura.extract_metadata(html) → title
├─ trafilatura.extract(html, include_tables=True) → body
├─ 98.5% noise reduction (tested)
└─ Output: { titleText, bodyText, reductionRatio }

Stage 1: CLASSIFY (Post Type)
├─ Direct offer → proceed to extraction
├─ Affiliate → skip extraction, record referral
├─ Promo code → record code, no pricing
├─ Comparison → identify offer price vs reference
└─ Output: { postType, classifierConfidence }

Stage 2: FILTER (Noise Removal)
├─ Remove license text
├─ Remove platform chrome
├─ Keep product blocks
└─ Output: { filteredContent, signalScore }

Stage 3: EXTRACT (LLM)
├─ Resolve implicit names (title → body)
├─ Extract structured products
├─ Validate against catalog
└─ Output: { products, evidence }

Stage 4: DEDUP
├─ Check embedding similarity
├─ Skip if already scraped
└─ Output: { uniquePosts, duplicates }
```

---

## Testing Commands

```bash
# Test Stage 0 (locate elements)
npx tsx scripts/test-stage0.ts --id 0aea7978e7b3

# Test Stage 1 (classification)
npx tsx scripts/test-classify.ts --model gemma2:9b

# Test full pipeline with dedup
npm run test:competitor-intel -- --check-duplicates
```

---

**References**:
- Available models: `curl http://ollama:11434/api/tags`
- Current config: `config/env.ts` line 232 (`OLLAMA_OCR_MODEL`)
- Pain points: `pain-points-report.md`