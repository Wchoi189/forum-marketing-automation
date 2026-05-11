# Product Catalog

## What this is

The product catalog maps vendor-specific naming variants (Korean, English, abbreviations) to canonical product names used in the Competitor Intelligence price matrix.

**Location:** `config/product-catalog.json`

**Loader:** `lib/competitor-intel/extraction/product-catalog.ts` (reads JSON at runtime, no code changes needed to add products)

## When to update

- A new vendor post mentions a product not in the catalog
- The gap report (`scripts/discover-catalog-gaps.ts`) shows an unmapped real product name
- A new service category appears in the Korean OTT/subscription market

## How to add a product

1. Open `config/product-catalog.json`
2. Add an entry **before less-specific patterns** it might shadow. Example: "YouTube Premium + Music" must come before "YouTube Premium"
3. Each entry has these fields:

```json
{
  "regex": "유튜브.*프리미엄|YouTube\\s*Premium|유프리",
  "canonical": "YouTube Premium",
  "description": "YouTube Premium ad-free subscription",
  "keywords": ["유튜브", "YouTube", "프리미엄", "Premium"],
  "addedBy": "session-8",
  "addedAt": "2026-05-12"
}
```

- `regex`: Case-insensitive pattern(s) to match vendor text. Use `|` for alternation. Escape backslashes in JSON (`\\s` not `\s`).
- `canonical`: The standardized product name used everywhere downstream
- `description`: What this product is (for future reference)
- `keywords`: Individual search terms for LLM prompts
- `addedBy`, `addedAt`: Provenance tracking

## How to discover gaps

Run the discovery script against the SQLite DB:

```bash
npx tsx scripts/discover-catalog-gaps.ts        # human-readable report
npx tsx scripts/discover-catalog-gaps.ts --json  # JSON output
npx tsx scripts/discover-catalog-gaps.ts --vendor "OTT대장"  # filter by vendor
```

This shows product names that exist in the DB but don't match any catalog entry. Sort by frequency to find the highest-impact gaps.

## Important rules

1. **Order matters** — more specific regex patterns must come BEFORE general ones in the JSON array
2. **Do not add products in code** — the canonical names are ONLY in `config/product-catalog.json`. If you find yourself writing a new product name in `ppomppu-parser.ts` or `text-extraction.ts`, add it to the JSON instead
3. **Bundles are auto-detected** — if an ad says "YouTube Premium + Gemini" or "유튜브 프리미엄 + 제미나이 패키지", the matcher splits on `+`/`&`/`패키지` and reassembles as "YouTube Premium + Gemini". You don't need separate catalog entries for every bundle combination
4. **Noise vs. real product** — if a gap is vendor text like "뽐뿌 20 가입" or marketing text like "(5월할인)", it's not a product. Fix the Cheerio parser to skip it instead of adding it to the catalog

## Architecture

```
config/product-catalog.json          ← Source of truth (JSON, no code changes needed)
    │
    ▼
lib/competitor-intel/extraction/product-catalog.ts  ← Runtime loader
    │
    ├── getProductNameMap()  → [(RegExp, canonical)]  for Cheerio parser
    ├── getCatalogForPrompt() → string               for LLM prompts
    ├── getProductKeywords() → string[]              for LLM prompts
    └── matchProductName(text) → string | null       for post-extraction validation
    │
    ▼
lib/competitor-ad-parser/ppomppu-parser.ts    ← Uses getProductNameMap()
lib/competitor-intel/extraction/text-extraction.ts  ← Uses all four functions
```
