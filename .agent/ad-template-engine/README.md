# Ad Template Engine — Agent Playbook & Prompt Architecture

This directory provides the authoritative reference, hardened prompt specifications, and execution loop for AI agents operating `@tools/ad-template-engine`.

---

## 1. Directory Structure

```
.agent/ad-template-engine/
├── README.md                          # Architecture overview, prompt analysis & quickstart
├── schema-reference.md                # Canonical ad-1.0 schema specification & style dictionary
├── playbook.md                        # Deterministic 4-step Execution Loop for AI agents
└── prompts/
    ├── schema-update.prompt.md        # Hardened Prompt 1: Data-driven template modification
    └── field-extraction.prompt.md     # Hardened Prompt 2: Reverse-sync field extraction
```

---

## 2. Prompt Evaluation: Will the Prompts Work as Expected?

### Prompt 1 (Schema-First Update)
* **Will it work?** **Yes, with caveats.**
* **Critical failure modes to prevent:**
  1. **Visual Left-to-Right Ordering:** In CSS grid layouts (`display: grid`), the array index dictates left-to-right placement. Placing a card "to the left of X" requires **prepending** the card in the `cards: [...]` array. Unprompted agents often append to the end.
  2. **Section ID vs Section Title:** If an agent changes `id: "section-adobe"` to `id: "adobe"`, the engine's hardcoded brand border mapping (`borderColors['section-adobe']`) breaks, reverting the border to default gray, and breaking the top navigation hash link (`#section-adobe`). Agents must be instructed to preserve `id` and only modify `title`.
  3. **Style Enums:** Cards accept `'normal'`, `'best'` (dark black border `#1E1E1E`), or `'pro'` (terracotta border `#C87A53` with orange glow shadow). Prompts must supply the exact enum to maintain visual hierarchy.
  4. **Output Target Awareness:** `npm run generate` compiles to `dist/index.html`. If the project or publisher expects `redesign-v5v1.html`, the prompt must specify sync steps.

### Prompt 2 (Field Extraction from HTML)
* **Will it work?** **Yes, with caveats.**
* **Critical failure modes to prevent:**
  1. **Component Pattern Invariants:** `extractor.ts` expects design system HTML conventions (`border-radius: 16px`, `justify-content: space-between` for card headers, and structured notice boxes). If arbitrary or malformed HTML is introduced, fields can be dropped.
  2. **Idempotency & Drift:** Extracting from HTML and immediately compiling must yield a lossless round-trip. Agents must be instructed to run both `extract` and `generate`, followed by a diff check.
