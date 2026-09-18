# Production Prompt: Field Extraction & Drift Audit

Use this prompt to guide an AI agent to extract fields from an HTML ad template, audit changes against the canonical schema, and synchronize state.

---

```markdown
# Objective
Extract structured marketing fields from the HTML ad template using `@tools/ad-template-engine` and synchronize `ad-data.yaml`.

# Target Files
- Source HTML: `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/redesign-v5v1.html`
- Canonical Schema: `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml`
- Toolkit: `tools/ad-template-engine`

# Instructions

## 1. Run Extractor
Execute the isolated extraction command:
```bash
npm run extract --prefix tools/ad-template-engine
```

## 2. Verify Field Integrity
Inspect the generated `ad-data.yaml` to confirm:
- `schemaVersion` is `"ad-1.0"`.
- All 12 `navLinks` are captured accurately.
- All 9 core sections are present with their corresponding card items and notices.
- Specific verification for recent updates:
  - Section "picsart" (Canva Pro) includes both "Canva Business" (50,000원) and "Canva Pro Edu" (19,800원).
  - Section "section-adobe" (Adobe) includes "Adobe Express (12개월)" (22,000원).
  - All 11 Extra Software items are captured without header row contamination.

## 3. Verify Lossless Round-Trip (Drift Audit)
Re-compile from the extracted schema to verify idempotency:
```bash
npm run generate --prefix tools/ad-template-engine
```
Confirm exit code 0.

## 4. Quality Gate
Run project validation scripts:
```bash
npm run lint:structure
npm run lint
```

## 5. Report
Provide a clean summary of extracted fields, highlighting:
- Total card count per section
- Any newly detected or modified pricing tiers
- AS guarantee and notice updates
```
