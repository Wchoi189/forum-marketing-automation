# Skill: Ad Template Engine

**Purpose:** Provide data-driven generation of static HTML ad templates from structured YAML schema using `@tools/ad-template-engine`.

**Invocation:** Run as an agent skill when:
- Creating or updating marketing templates (e.g. `ad-data.yaml`).
- Generating the final HTML payload for ad units.

---

## Capabilities & Commands

The toolkit is completely isolated and runs via `npm`.

### 1. Generate Ad Template
Compiles `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml` into static HTML using inline CSS.
```bash
npm run generate --prefix tools/ad-template-engine
```

### 2. Extract Fields From Ad
Extracts structured ad fields from static HTML (e.g. `redesign-v5v1.html`) into `ad-data.yaml` or JSON.
```bash
npm run extract --prefix tools/ad-template-engine
# Or with options:
# npx ts-node extractor.ts --file <path-to-html> --out <path-to-yaml> [--print] [--json]
```

---

## Exit Codes

| Code | Meaning | Agent Action |
|------|---------|--------------|
| `0`  | Success | Proceed with the generated file (`dist/index.html`). |
| `1`  | Build failure | Ensure dependencies are installed via `npm ci --prefix tools/ad-template-engine`. |
| `4`  | Schema or config error | Check if `schemaVersion` is `ad-1.0` and YAML structure is correct. |

---

## Safety & Invariants

1. **Self-Contained Installation**: Never add dependencies to the root workspace for this tool. Always use `--prefix tools/ad-template-engine`.
2. **Schema Versioning**: The data file must always specify `schemaVersion: "ad-1.0"` to distinguish it from interactive UI contracts (`ui-schema-engine`).
