# Model Recommendations for Pipeline Testing

**Target**: Next AI Agent
**Context**: Use local Ollama for iterative testing
**Endpoint**: `http://ollama:11434`
**Hardware**: RTX 3090 24GB VRAM, Ryzen 9 9950X, 64GB RAM
**Updated**: 2026-05-27

---

## Hardware Constraints

**See**: `.planning/spec-kit/reference/hardware-context.md`

| Constraint | Impact |
|------------|--------|
| 24 GB VRAM | Can run ONE 22 GB model (gemma2:27b-instruct) at max |
| Single GPU | Sequential inference only, no parallel GPU work |
| 16 CPU cores | Parallel Trafilatura, DuckDB across posts |
| 64 GB RAM | In-memory processing, SQLite/Embedding cache |

**Model Loading Strategy**:
- Cannot load gemma2:27b-instruct (22 GB) + mistral-nemo (7.1 GB) simultaneously
- Sequential: Classify (mistral-nemo) → Unload → Extract (gemma2:27b)
- Or: Use smaller gemma2:9b (5.4 GB) + mistral-nemo (7.1 GB) = 12 GB (comfortable)

---

## Current Models Available

| Model | Size | Use Case | Notes |
|-------|------|----------|-------|
| `gemma2:27b-instruct-q6_K` | 22 GB | **Primary extraction** | Best accuracy, q6_K quantization, handles implicit names |
| `mistral-nemo:latest` | 7.1 GB | **Primary classification** | Fast, structured output, Korean capable |
| `snowflake-arctic-embed:latest` | 669 MB | **Primary embedding** | Korean text similarity for dedup |
| `deepseek-r1:7b` | 4.7 GB | Reasoning model | Bloated marketing titles, comparison posts |
| `llama3.1:latest` | 4.9 GB | Fallback classifier | General purpose, instruction following |
| `aya-expanse:latest` | 5.1 GB | Multilingual specialist | Korean/English bilingual |
| `gemma2:27b` | 15.6 GB | Previous extraction default | Good accuracy |
| `gemma2:9b` | 5.4 GB | Fast extraction | Quick iteration testing |
| `qwen3.5:9b` | 6.5 GB | Balanced | Speed + accuracy trade-off |
| `qwen2.5vl:7b` | 5.9 GB | **OCR/VLM** | Vision model for image extraction |
| `qwen2.5vl:3b` | 3.2 GB | OCR fallback | Faster vision, lower accuracy |
| `exaone3.5:latest` | 4.7 GB | Korean specialist | Samsung model |
| `nomic-embed-text:latest` | 274 MB | Embedding fallback | General purpose |
| `all-minilm:l6-v2` | 46 MB | Fast embedding | Lightweight check |

---

## Recommended Usage

### Stage 1 - Classification (Post Type Detection)
**Task**: Classify post type → direct_offer | affiliate | promo_code | comparison

**Recommended Models**:
1. `mistral-nemo:latest` - **Primary**. Fast (7.1 GB), structured JSON output
2. `llama3.1:latest` - Fallback. Good instruction following
3. `aya-expanse:latest` - Multilingual. Korean/English mixed posts
4. `deepseek-r1:7b` - Reasoning. Complex marketing intent

**Prompt Strategy**: Single-pass classification with structured JSON output.

### Stage 3 - Extraction (Product Info)
**Task**: Extract name, price, duration, terms from filtered content

**Recommended Models**:
1. `gemma2:27b-instruct-q6_K` - **Primary**. Best accuracy (22 GB), q6_K quality
2. `deepseek-r1:7b` - Reasoning. Bloated marketing titles, implicit names
3. `gemma2:27b` - Previous default. Good accuracy (15.6 GB)
4. `gemma2:9b` - Fast iteration. Development testing

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
1. `snowflake-arctic-embed:latest` - **Primary**. Korean text similarity (669 MB)
2. `nomic-embed-text:latest` - Fallback. General purpose (274 MB)
3. `all-minilm:l6-v2` - Fast check. Lightweight (46 MB)

---

## Model Selection Matrix

| Task | Speed Priority | Accuracy Priority | Korean Specialist |
|------|----------------|-------------------|-------------------|
| Classification | `llama3.1` (4.9GB) | `mistral-nemo` (7.1GB) | `aya-expanse` (5.1GB) |
| Extraction | `gemma2:9b` (5.4GB) | `gemma2:27b-instruct` (22GB) | `exaone3.5` (4.7GB) |
| Reasoning | `deepseek-r1` (4.7GB) | `deepseek-r1` (4.7GB) | - |
| OCR | `qwen2.5vl:3b` (3.2GB) | `qwen2.5vl:7b` (5.9GB) | - |
| Embedding | `all-minilm` (46MB) | `snowflake-arctic` (669MB) | `snowflake-arctic` |

---

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
