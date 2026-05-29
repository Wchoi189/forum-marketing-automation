# Ollama Models Configuration (AG-006)

> Ollama model catalog with specifications for parsing, classification, and extraction.
> Updated 2026-05-27 with new development models.

## Current Model Inventory

```
NAME                             ID              SIZE      MODIFIED
gemma2:27b-instruct-q6_K         42dd7dda6a9b    22 GB     4 minutes ago
mistral-nemo:latest              e7e06d107c6c    7.1 GB    About an hour ago
snowflake-arctic-embed:latest    21ab8b9b0545    669 MB    2 hours ago
deepseek-r1:7b                   755ced02ce7b    4.7 GB    2 hours ago
llama3.1:latest                  46e0c10c039e    4.9 GB    3 hours ago
aya-expanse:latest               65f986688a01    5.1 GB    3 hours ago
qwen3-coder:30b                  ...             18.5 GB   Previous
qwen3.5:9b                       ...             6.5 GB    Previous
qwen2.5vl:7b                     ...             5.9 GB    Previous
qwen2.5vl:3b                     ...             3.2 GB    Previous
gemma2:27b                       ...             15.6 GB   Previous
gemma2:9b                        ...             5.4 GB    Previous
exaone3.5:latest                 ...             4.7 GB    Previous
nomic-embed-text:latest          ...             274 MB    Previous
all-minilm:l6-v2                 ...             46 MB     Previous
```

## Model Recommendations by Pipeline Stage

### Stage 0: HTML Locate (Trafilatura)
**No model needed** - Trafilatura handles HTML parsing mechanically.

### Stage 1: Post Type Classification
| Model | Size | Use Case | Why |
|-------|------|----------|-----|
| `mistral-nemo:latest` | 7.1 GB | **Primary classifier** | Fast, structured output, good for Korean |
| `llama3.1:latest` | 4.9 GB | Fallback classifier | General purpose, instruction following |
| `aya-expanse:latest` | 5.1 GB | Multilingual specialist | Korean/English bilingual |
| `gemma2:9b` | 5.4 GB | Fast iteration | Quick testing |

**Recommended**: `mistral-nemo:latest` for balanced speed + accuracy.

### Stage 2: Noise Filtering
**No model needed** - jq/DuckDB handles filtering mechanically.

### Stage 3: Product Extraction
| Model | Size | Use Case | Why |
|-------|------|----------|-----|
| `gemma2:27b-instruct-q6_K` | 22 GB | **Primary extraction** | Best accuracy, handles implicit names |
| `deepseek-r1:7b` | 4.7 GB | Reasoning model | Bloated marketing title resolution |
| `gemma2:27b` | 15.6 GB | Previous default | Good accuracy |
| `qwen3.5:9b` | 6.5 GB | Fast extraction | Quick iteration |

**Recommended**: `gemma2:27b-instruct-q6_K` for maximum accuracy on complex posts.

### Stage 4: Merge & Validation
**No model needed** - Zod handles validation mechanically.

### Stage 5: Evidence Tracking
**No model needed** - TypeScript handles evidence assembly.

### Stage 6: Deduplication
| Model | Size | Use Case | Why |
|-------|------|----------|-----|
| `snowflake-arctic-embed:latest` | 669 MB | **Primary embedding** | Korean embedding, good similarity |
| `nomic-embed-text:latest` | 274 MB | Fallback embedding | General purpose |
| `all-minilm:l6-v2` | 46 MB | Fast dedup check | Lightweight |

**Recommended**: `snowflake-arctic-embed:latest` for Korean text similarity.

---

## Model Specifications

### Classification Models

```yaml
classification:
  - name: mistral-nemo:latest
    role: Primary Post Classifier
    size: 7.1 GB
    context_window: 128000
    strengths:
      - Structured JSON output
      - Korean text understanding
      - Fast inference (~5s)
    use_for:
      - Stage 1: postType classification
      - Affiliate/promo/comparison detection

  - name: llama3.1:latest
    role: Fallback Classifier
    size: 4.9 GB
    context_window: 128000
    strengths:
      - Instruction following
      - General classification
    use_for:
      - Stage 1: backup classifier

  - name: aya-expanse:latest
    role: Multilingual Specialist
    size: 5.1 GB
    context_window: 8192
    strengths:
      - Korean/English bilingual
      - Cross-lingual understanding
    use_for:
      - Posts with mixed Korean/English
```

### Extraction Models

```yaml
extraction:
  - name: gemma2:27b-instruct-q6_K
    role: Primary Product Extractor
    size: 22 GB
    context_window: 8192
    quantization: q6_K (high quality)
    strengths:
      - Best accuracy
      - Implicit name resolution
      - Bloated marketing parsing
    use_for:
      - Stage 3: product extraction
      - Posts requiring deep reasoning

  - name: deepseek-r1:7b
    role: Reasoning Extractor
    size: 4.7 GB
    context_window: 128000
    strengths:
      - Chain-of-thought reasoning
      - Complex logic
      - Marketing intent detection
    use_for:
      - Stage 1/3: complex posts
      - Comparison posts (two prices)

  - name: gemma2:9b
    role: Fast Extractor
    size: 5.4 GB
    context_window: 8192
    strengths:
      - Quick iteration
      - Good accuracy
    use_for:
      - Testing, development
```

### Embedding Models

```yaml
embedding:
  - name: snowflake-arctic-embed:latest
    role: Primary Korean Embedding
    size: 669 MB
    dimension: 1024
    strengths:
      - Korean text similarity
      - Deduplication
    use_for:
      - Stage 6: post deduplication

  - name: nomic-embed-text:latest
    role: General Embedding
    size: 274 MB
    dimension: 768
    strengths:
      - Fast similarity
      - Long context
    use_for:
      - Stage 6: fallback embedding
```

### OCR/Vision Models

```yaml
ocr_vision:
  - name: qwen2.5vl:7b
    role: Primary OCR (Vision-Language)
    size: 5.9 GB
    strengths:
      - Image-to-text extraction
      - Korean OCR
    use_for:
      - SharePlan posts (pricing in images)

  - name: qwen2.5vl:3b
    role: Fallback OCR
    size: 3.2 GB
    strengths:
      - Fast OCR
      - Lower VRAM
    use_for:
      - Quick OCR iteration
```

---

## Connection Information

### Endpoint
| URL | Status |
|-----|--------|
| `http://ollama:11434` | ✅ Primary (Docker DNS) |
| `http://172.20.0.4:11434` | ✅ Container IP |
| `http://localhost:11434` | ❌ Fails (inside container) |

### Testing Commands

```bash
# List models
curl http://ollama:11434/api/tags | jq '.models[].name'

# Test classification
curl http://ollama:11434/api/generate -d '{"model":"mistral-nemo","prompt":"Classify: 유튜브 프리미엄 1달 4000원"}'

# Test embedding
curl http://ollama:11434/api/embeddings -d '{"model":"snowflake-arctic-embed","prompt":"유튜브 프리미엄 가족계정"}'

# Test extraction
curl http://ollama:11434/api/generate -d '{"model":"gemma2:27b-instruct-q6_K","prompt":"Extract products: ..."}'
```

---

## Environment Configuration

```typescript
// config/env.ts
OLLAMA_ENDPOINT: "http://ollama:11434",
OLLAMA_CLASSIFIER_MODEL: "mistral-nemo:latest",  // Stage 1
OLLAMA_EXTRACT_MODEL: "gemma2:27b-instruct-q6_K", // Stage 3
OLLAMA_EMBED_MODEL: "snowflake-arctic-embed:latest", // Stage 6
OLLAMA_OCR_MODEL: "qwen2.5vl:7b", // OCR fallback
```

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

## References

- Pipeline stages: `.planning/spec-kit/plans/multi-stage-parser-v1/`
- Model recommendations: `.planning/spec-kit/plans/multi-stage-parser-v1/model-recommendations.md`
- Tool integration: `.planning/spec-kit/plans/multi-stage-parser-v1/tool-integration.md`
