# Hardware Context (AG-007)

> System specifications for AI resource planning. Defines what models/tasks are feasible.

## Specifications

```yaml
gpu:
  model: RTX 3090
  vram: 24 GB
  compute: 35.58 TFLOPS (FP32)
  memory_bandwidth: 936 GB/s
  
cpu:
  model: Ryzen 9 9950X
  cores: 16 (32 threads)
  base_clock: 4.4 GHz
  boost_clock: 5.7 GHz
  
memory:
  type: DDR5-6000
  capacity: 64 GB
  bandwidth: ~96 GB/s
  
os:
  host: Windows 11
  container: WSL2 (Docker)
  gpu_passthrough: CUDA supported
```

## What This Means for AI Agents

### VRAM Constraints (24 GB)

| Model Size | Feasible? | Notes |
|------------|-----------|-------|
| ≤ 8 GB | ✅ Fast | Single model, batch inference |
| 8-16 GB | ✅ Comfortable | Most models fit with context |
| 16-22 GB | ⚠️ Tight | `gemma2:27b-instruct-q6_K` (22 GB) - maxes out |
| > 24 GB | ❌ Impossible | Requires multi-GPU or cloud |

**Max concurrent models**:
- 1 large model (22 GB) + small utility (≤2 GB)
- 2 medium models (8-12 GB each)
- 4 small models (≤6 GB each)

**Recommended model allocation**:
```
Stage 1 (Classify): mistral-nemo (7.1 GB) ✅
Stage 3 (Extract):  gemma2:27b-instruct (22 GB) ✅ - maxes VRAM
Stage 6 (Embed):    snowflake-arctic (669 MB) ✅ - negligible
OCR (Image):        qwen2.5vl:7b (5.9 GB) ✅
```

### RAM Constraints (64 GB)

- HTML files: Can load ~100K posts in memory
- SQLite DB: 146 records trivial, can scale to millions
- Embedding cache: Store thousands of vectors in RAM
- DuckDB: In-memory OLAP, fast filtering

### CPU Constraints (16 cores / 32 threads)

- Trafilatura: Multi-threaded HTML parsing (8-16 threads)
- Cheerio: Single-threaded, but can parallelize across posts
- DuckDB: Uses all cores for SQL queries
- Node.js: Single-threaded event loop, worker threads for parallel

### WSL2 Container Limitations

- **GPU**: CUDA works, but ~10% slower than native Linux
- **File I/O**: Windows filesystem slower (use `/tmp` or Docker volumes)
- **Network**: Docker DNS works (`http://ollama:11434`)
- **Memory**: Shared with Windows host (64 GB total)

## Resource Budget by Pipeline Stage

| Stage | Resource | Budget | Feasible? |
|-------|----------|--------|-----------|
| Stage 0 | Trafilatura (CPU) | 8 cores | ✅ Fast HTML parsing |
| Stage 1 | mistral-nemo (VRAM) | 7.1 GB | ✅ Plenty of headroom |
| Stage 2 | jq/DuckDB (CPU+RAM) | 2 cores, 1 GB RAM | ✅ Negligible |
| Stage 3 | gemma2:27b-instruct (VRAM) | 22 GB | ⚠️ Maxes VRAM, slow |
| Stage 4 | Zod validation (CPU) | 1 core | ✅ Fast TypeScript |
| Stage 5 | Evidence assembly (CPU) | 1 core | ✅ Fast |
| Stage 6 | snowflake-arctic (VRAM) | 669 MB | ✅ Negligible |

## Performance Expectations

| Task | Expected Time | Notes |
|------|---------------|-------|
| Trafilatura parse | ~50ms/post | CPU bound |
| Classification (mistral-nemo) | ~3-5s/post | GPU bound |
| Extraction (gemma2:27b) | ~10-15s/post | GPU bound, maxes VRAM |
| OCR (qwen2.5vl) | ~5-10s/image | GPU bound |
| Embedding (snowflake) | ~100ms/post | Fast |
| Full pipeline | ~20-30s/post | Total per post |

**Throughput**: 
- 10-15 posts/minute with gemma2:27b
- 20-30 posts/minute with gemma2:9b (faster)
- 60+ posts/minute for classification only (no extraction)

## Model Loading Strategy

### Recommended: Sequential Loading
```
1. Load mistral-nemo (7.1 GB) → Classify posts
2. Unload mistral-nemo
3. Load gemma2:27b-instruct (22 GB) → Extract products
4. Unload gemma2:27b
5. Load snowflake-arctic (669 MB) → Dedup (always resident)
```

**Why**: Can't fit 22 GB + 7 GB simultaneously. Sequential loading saves VRAM.

### Alternative: Use Smaller Extraction Model
```
Always loaded:
- snowflake-arctic (669 MB) for dedup
- mistral-nemo (7.1 GB) for classify

Swap in:
- gemma2:9b (5.4 GB) for fast extraction
- OR deepseek-r1:7b (4.7 GB) for reasoning
```

**VRAM used**: ~12-14 GB (fits comfortably)

## Parallel Processing

| Strategy | Feasible? | Notes |
|----------|-----------|-------|
| GPU parallel inference | ❌ | Single RTX 3090, can't split |
| Multi-threaded HTML parse | ✅ | Trafilatura on 8-16 cores |
| Batch LLM inference | ⚠️ | Limited by VRAM, batch size 1-2 |
| Parallel posts (CPU stages) | ✅ | Stage 0, 2, 4, 5, 6 parallel |
| Parallel posts (GPU stages) | ❌ | Sequential GPU inference |

**Best strategy**: 
- Parallel CPU stages (Stage 0, 2, 4, 5, 6) across 16 cores
- Sequential GPU stages (Stage 1, 3) due to single GPU

## Hardware-Aware Recommendations

### For Fast Iteration (Development)
```
Use: gemma2:9b (5.4 GB) + mistral-nemo (7.1 GB)
VRAM: ~12 GB used
Speed: 20-30 posts/minute
Best for: Testing pipeline, debugging
```

### For Maximum Accuracy (Production)
```
Use: gemma2:27b-instruct-q6_K (22 GB) alone
VRAM: 22 GB used (maxed)
Speed: 10-15 posts/minute
Best for: Final extraction on complex posts
```

### For Classification-Only (Filtering)
```
Use: mistral-nemo (7.1 GB) + snowflake-arctic (669 MB)
VRAM: ~8 GB used
Speed: 60+ posts/minute
Best for: Classifying post types, skipping extraction
```

## Environment Variables

```bash
# Tell AI about hardware
export GPU_VRAM_GB=24
export CPU_CORES=16
export RAM_GB=64
export MAX_MODEL_SIZE_GB=22  # Leave 2 GB headroom

# Model selection based on hardware
export OLLAMA_LARGE_MODEL="gemma2:27b-instruct-q6_K"  # Max accuracy
export OLLAMA_MEDIUM_MODEL="mistral-nemo:latest"      # Balanced
export OLLAMA_SMALL_MODEL="gemma2:9b"                 # Fast iteration
export OLLAMA_EMBED_MODEL="snowflake-arctic-embed:latest"
```

## Actions AI Should Take

1. **Check VRAM before loading**: `nvidia-smi` to see free VRAM
2. **Unload models after use**: `ollama stop <model>` to free VRAM
3. **Use smaller models for iteration**: gemma2:9b, mistral-nemo
4. **Batch CPU work**: Parallel Trafilatura on 8-16 posts
5. **Sequential GPU work**: One post at a time through Stage 1/3
6. **Monitor resources**: `htop` + `nvidia-smi` during pipeline runs

---

## Summary for AI Agents

**You have**:
- RTX 3090 with 24 GB VRAM → Can run gemma2:27b-instruct (22 GB) max
- Ryzen 9 9950X with 16 cores → Parallel CPU work (Trafilatura, DuckDB)
- 64 GB RAM → In-memory processing, no swapping needed
- WSL2 container → GPU works, Docker DNS works

**You cannot**:
- Run two large models simultaneously (22 GB + 7 GB > 24 GB)
- Do parallel GPU inference (single GPU)
- Load models > 24 GB (multi-GPU needed)

**Best practice**:
1. Use mistral-nemo (7.1 GB) for classification
2. Unload, then load gemma2:27b-instruct (22 GB) for extraction
3. Keep snowflake-arctic (669 MB) always resident for dedup
4. Parallelize CPU stages across 16 cores