# Ollama Models Configuration (AG-006)

> Ollama model catalog with specifications for Qwen model family and OCR-capable variants.
> Extracted from `AgentQMS/specs/tier2-framework/agent-infra.spec.md`.

## Specification

```yaml
agents:

  qwen:
    description: General coding and utility agents (local Ollama)
    endpoint: http://ollama:11434
    dependencies:
      - SC-007
      - FW-034
    inventory:
      - name: qwen3-coder:30b
        role: Architect
        context_window: 1048576
        vram_requirement: 18 GB
        strengths:
          - Repo-scale refactoring
          - Complex logic
          - Multi-file impact analysis

      - name: qwen3:4b-instruct
        role: Validator
        context_window: 262144
        vram_requirement: 2.5 GB
        strengths:
          - Thinking mode
          - Logical verification
          - Quality scoring

      - name: qwen3:1.7b
        role: Utility / Janitor
        context_window: 32768
        vram_requirement: 1.4 GB
        strengths:
          - Log parsing
          - Metadata extraction
          - Schema validation

  qwen-local-ocr:
    description: Local Ollama vision-language models for Korean OCR on 32x128 patches
    endpoint: http://ollama:11434
    dependencies:
      - SC-007
      - FW-034
    inventory:
      - name: qwen2.5vl:7b
        role: Primary OCR Extractor (Vision-Language)
      - name: qwen2.5vl:3b
        role: Fallback OCR Extractor (Vision-Language)
      - name: qwen3:4b-instruct
        role: Text Validator / Confidence Scorer
      - name: qwen3:1.7b
        role: Fast Text Utility / Fallback Validator
```

## Connection Information

### Findings
Ollama is running and healthy. Here's what was discovered:

| Check | Result |
|-------|--------|
| Container status | Running (started 2026-05-08) |
| http://ollama:11434/ | "Ollama is running" |
| http://172.20.0.4:11434/ | "Ollama is running" |
| http://localhost:11434/ | Connection refused |
| Models available | 16 models (gemma2, qwen3, qwen2.5vl, etc.) |

### Root Cause
localhost:11434 fails because we're inside the ocr-dev Docker container. localhost refers to the current container, not the host machine. Port 11434 is not bound inside this container.

### Fix
Use the Ollama container's Docker DNS name or network IP instead of localhost:

1. `http://ollama:11434` (recommended — uses Docker DNS on the shared ocr-dev_default network)
2. `http://172.20.0.4:11434` (the container's IP on the ocr-dev_default network)
