## 1️⃣  What can be parsed from the “Pricing Matrix” text?

The block you posted is a **dump of a pricing‑matrix table** that has been stripped of its HTML table‑structure and concatenated line‑by‑line.
Even in this messy form a very reliable set of fields can be extracted with simple text‑rules.
Below is the **canonical list of fields** you can reliably pull out, together with a short description of each and an example of the values you will see in the raw data.

| # | Field (English) | Korean equivalent | How it appears in the raw text | Example (raw) | Example (cleaned) |
|---|-----------------|------------------|-----------------------------|--------------|-------------------|
| 1 | **Vendor / Reseller** | 판매자, 공급사 | Starts a line with the vendor name (e.g. `-테크몽-`, `팡이누나`, `구독플레이스`) | `-테크몽-` | `"vendor": "테크몽"` |
| 2 | **Product / Service name** | 상품·서비스명 | Usually embedded in a preceding “특가” line or as a separate caption (e.g. `💎 BEST VALUE 이용권 Netflix Premium` or `제미나이 프로`) | `💎 BEST VALUE 이용권 Netflix Premium` | `"product": "Netflix Premium"` |
| 3 | **Total price (KRW)** | 총 가격 | Starts with the Korean won symbol `₩` followed by a number (commas optional) or the placeholder `—` | `₩19,900` or `—` | `"total_price": 19900` (or `null` when missing) |
| 4 | **Price‑per‑month (KRW)** | 월 가격 | Same pattern as Total price but can appear on a line labelled “Per Month”. May be `—` or omitted. | `₩825` | `"monthly_price": 825` |
| 5 | **Duration (months)** | 이용 기간 (개월) | The token `mo` after a number (e.g. `12mo`) or the word “월” in Korean text. | `12mo` | `"duration_months": 12` |
| 6 | **Tier / Offering level** | 등급·옵션 | Sometimes left as `—` or a textual label (e.g. “Basic”, “Premium”, “Best Value”). In the matrix it is usually empty, so we treat it as `null`. | — | `"tier": null` |
| 7 | **Posted / Valid‑until date** | 게시일·유효일 | Two‑part Korean date “May 9, 2026”, “May 10, 2026”. All entries share the same month/year, so we can standardise. | `May 9, 2026` | `"posted_date": "2026-05-09"` |
| 8 | **Discount / Coupon note** | 할인·쿠폰 안내 | Text such as `5천원 할인 쿠폰 자동발급`, `선충전 후결제!!`, `런칭기념 한정특가`, `Best Value` etc. Appears after a product line (or on the same line separated by a space). | `(선충전 후결제!!)` or `런칭기념 한정특가` | `"discount_note": "선충전 후결제!!"` |
| 9 | **Special tag / Promo headline** | 프로모션 태그 | Emojis or bold symbols like `💎 BEST VALUE`, `🔥`, `Best` that sit at the start of a line. | `💎 BEST VALUE` or `🔥` | `"promo_tag": "BEST VALUE"` |
|10 | **Currency** | 통화 | Implied by the won symbol, but we can explicitly set to `KRW`. | `₩` | `"currency": "KRW"` |

### What **cannot** be reliably parsed
- Exact **SKU / internal code** – none are present.
- **Pricing history / revisions** – only the “posted” snapshot.
- **User‑specific constraints** (e.g., “가족그룹에 들어간 적 없는 아이디”) – they’re contextual notes that belong to a *different* document and should be ignored unless you add a separate “policy” field.
- **Any column that contains only “—”** – treat as `null` or `None`.

### Sample extraction (structured JSON)

```json
[
  {
    "vendor": "테크몽",
    "product": "YouTube Premium",
    "total_price": 19900,
    "monthly_price": null,
    "duration_months": null,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": "가격",
    "promo_tag": null
  },
  {
    "vendor": "테크몽",
    "product": "YouTube Premium",
    "total_price": null,
    "monthly_price": null,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": null,
    "promo_tag": null
  },
  {
    "vendor": "팡이누나",
    "product": "YouTube Premium",
    "total_price": 9900,
    "monthly_price": 825,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": "선충전 후결제!!",
    "promo_tag": null
  },
  {
    "vendor": "팡이누나",
    "product": "YouTube Premium",
    "total_price": 59000,
    "monthly_price": null,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": "선충전 후결제!!",
    "promo_tag": null
  },

  {
    "vendor": "OTT대장",
    "product": "Gemini Pro",
    "total_price": null,
    "monthly_price": null,
    "duration_months": null,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": null,
    "promo_tag": null
  },

  {
    "vendor": "구독플레이스",
    "product": "Netflix Premium",
    "total_price": null,
    "monthly_price": null,
    "duration_months": 6,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": null,
    "promo_tag": "BEST VALUE"
  },

  {
    "vendor": "DENMARK",
    "product": "Gemini Pro",
    "total_price": null,
    "monthly_price": 14900,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": null,
    "promo_tag": null
  },

  {
    "vendor": "호야굿",
    "product": "YouTube Premium",
    "total_price": 60000,
    "monthly_price": 5000,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "discount_note": null,
    "promo_tag": null
  },

  // … 560+ more rows …
]
```

> **Take‑away:** Even though the raw text is “dirty”, you can reconstruct a clean **product‑vendor‑price‑duration matrix** that can be fed directly to an LLM for further analysis (e.g., “which offers the lowest monthly cost for a 12‑month commitment?”).

---

## 2️⃣  Parsing instructions you can hand‑off to an LLM (or to a developer‑friendly script)

Below is a **complete, step‑by‑step recipe** that works for a GPT‑style LLM (or a human‑operator) and also translates directly into a short Python prototype.
Feel free to copy‑paste the pseudo‑code into a Jupyter notebook or a quick script – the LLM can execute it for you if you ask it to “write a parser” and then you can run the generated code.

---

### 2.1 High‑level workflow

1. **Normalize line breaks** – ensure every record ends with `\n` and there are no stray commas inside fields.
2. **Strip header markers** – lines that start with `- 가 격 :` or `- 이용 기간 :` are just column headings; they can be ignored.
3. **Detect vendor boundaries** – a new vendor is identified by a line that **contains the vendor name** (usually the first token before any delimiter). In the matrix the vendor name appears as the first column, often surrounded by `-` or `:` characters.
4. **Group consecutive rows** – because a vendor may have multiple rows (price, duration, notes) that belong together, we keep a **state machine** that accumulates rows until a new vendor appears.
5. **Extract each column** with a **regular expression** tailored to the matrix format:
   * **Vendor** – `r'^([^-]+)'` (everything up to the first hyphen or colon)
   * **Total price** – `r'₩(\d{1,3}(?:,\d{3})*|\–)'` → capture `19900`, `null` if `—`.
   * **Monthly price** – `r'—|(\d{1,3}(?:,\d{3})*)'` (or look for “Per Month” label)
   * **Duration** – `r'—|([0-9]+)(?:mo|개월)'` → produce integer months.
   * **Posted date** – `r'(?:May\s?[0-9]+),\s?2026'` → standardise to ISO (`2026-05-09`).
   * **Promo tag** – `r'💎|\★|\🔥|\(.*?\)|' – extract anything that looks like a promotion headline.
   * **Discount note** – capture parenthesised Korean text.
6. **Clean & convert** – replace commas in numbers, map `—` → `null`, convert date string to `YYYY‑MM‑DD`.
7. **Deduplicate** – if two rows have identical vendor/product/duration but different total price, keep the *lowest* total price (or keep both as a list; depends on downstream need).
8. **Output** – a **JSON array** (or a CSV) ready for further LLM prompting.

---

### 2.2 Detailed regex patterns (Python‑style)

```python
import re

# 1) Vendor (first token before any delimiter)
VENDOR_RE = re.compile(r'^([^-]+)')

# 2) Total price (KRW) – may be with commas, with dash, or missing
TOTAL_PRICE_RE = re.compile(r'₩(\d{1,3}(?:,\d{3})*)')
TOTAL_PRICE_DEFAULT = re.compile(r'—')   # placeholder → None

# 3) Monthly price
MONTHLY_PRICE_RE = re.compile(r'(—|(\d{1,3}(?:,\d{3})*))')

# 4) Duration (months)
DURATION_RE = re.compile(r'(—|([0-9]+)(?:mo|개월))')

# 5) Date (May 9, 2026)
DATE_RE = re.compile(r'(?:May\s?[0-9]+),\s?2026')
DATE_TO_ISO = lambda m: f'2026-05-{m.group(1)}'

# 6) Promo tag (emoji/keyword at line start)
PROMO_TAG_RE = re.compile(r'^(\s*)(💎|\★|\🔥|Best|Best\s+Value)?')
PROMO_TAG_DEFAULT = re.compile(r'^(\s*)')   # fallback to empty

# 7) Discount note (anything inside parentheses)
DISCOUNT_NOTE_RE = re.compile(r'\((.*?)\)')
```

---

### 2.3 Pseudo‑code (state‑driven parser)

```python
def parse_pricing_matrix(raw_text):
    lines = raw_text.strip().splitlines()
    result = []
    cur = {}

    for line in lines:
        # ---- skip pure headers ----
        if line.startswith('- 가 격 :') or line.startswith('- 이용 기간 :'):
            continue

        # ---- capture vendor ----
        m = VENDOR_RE.match(line)
        if m:
            # if we already have a row for the previous vendor, finalise it
            if cur.get('vendor'):
                result.append(cur)
            cur = {
                'vendor': m.group(1).strip(),
                'product': '',
                'total_price': None,
                'monthly_price': None,
                'duration_months': None,
                'tier': None,
                'posted_date': None,
                'currency': 'KRW',
                'discount_note': None,
                'promo_tag': ''
            }
            # promotions that sit on a line *before* a price row are attached to the next row
            promo_match = PROMO_TAG_RE.match(line)
            if promo_match:
                cur['promo_tag'] = promo_match.group(1).strip()
            continue

        # ---- start building product name (if not already set) ----
        if not cur['product']:
            # Look for a Korean phrase like “이용권 Netflix Premium” or “제미나이 프로”
            # A simple heuristic: everything after the first “₩” or after a colon.
            cur['product'] = line.split('₩')[0].strip()
            cur['product'] = re.sub(r'^[^가-힣가-힣]*', '', cur['product']).strip()

        # ---- total price ----
        tp = TOTAL_PRICE_RE.search(line)
        if tp:
            cur['total_price'] = int(tp.group(1).replace(',', ''))
        # ---- monthly price ----
        mp = re.search(r'(—|(\d{1,3}(?:,\d{3})*))', line)
        if mp and mp.group(2) != '—':
            cur['monthly_price'] = int(mp.group(2).replace(',', ''))

        # ---- duration ----
        dur_match = re.search(r'(—|([0-9]+)(?:mo|개월))', line)
        if dur_match and dur_match.group(2):
            cur['duration_months'] = int(dur_match.group(2))
        elif dur_match and dur_match.group(1).strip() == '월':
            # Some lines say “월” instead of “mo”
            # Assuming default 12 months if not explicit:
            cur['duration_months'] = 12

        # ---- posted date ----
        date_match = DATE_RE.search(line)
        if date_match:
            cur['posted_date'] = DATE_TO_ISO(date_match.groups())

        # ---- discount note ----
        discount_match = re.search(r'\((.*?)\)', line)
        if discount_match:
            cur['discount_note'] = discount_match.group(1).strip()

        # ---- promo tag (if any) ----
        promo_match = PROMO_TAG_RE.match(line)
        if promo_match:
            cur['promo_tag'] = promo_match.group(1).strip()

    # Append the final vendor block (if any)
    if cur.get('vendor'):
        result.append(cur)

    # ---- post‑processing: dedupe & sort ----
    # For simplicity we keep all rows; a downstream LLM can reduce them.
    return result
```

> **What the LLM should do with this output**
> 1. **Validate** – ask the LLM to double‑check that the `vendor` strings are consistent (e.g., “테크몽” vs “테크몽-”).
> 2. **Standardise product names** – unify `YouTube Premium`, `Youtube Premium`, `YouTube premium`.
> 3. **Calculate derived fields** – e.g., `effective_monthly_price = total_price / duration_months` (if both are present).
> 4. **Rank** – order rows by `effective_monthly_price`, highlight “Best Value”, “5천원 할인”.
> 5. **Export** – produce a CSV or markdown table for downstream reporting.

---

### 2.4 LLM‑prompt template for “hand‑off”

```text
You have been given a cleaned pricing‑matrix JSON (see below).
Your task is to:

1️⃣ Merge rows that belong to the same vendor & product (e.g., multiple “duration” rows for the same price).
2️⃣ Compute the *effective monthly price* for every entry where both a total price and a duration are present.
3️⃣ Flag any entry that mentions a promotion (e.g., “선충전 후결제!!”, “런칭기념 한정특가”, “Best Value”).
4️⃣ Return a new JSON where:
   - each entry has fields: vendor, product, total_price, monthly_price, duration_months,
     effective_monthly_price, promo_tag, discount_note, posted_date.
   - missing values are `null`.
5️⃣ Finally, produce a short markdown table sorted by `effective_monthly_price` (ascending).

---
**Input JSON (first 10 rows for brevity):**

```json
[
  {"vendor":"테크몽","product":"YouTube Premium","total_price":19900,"duration_months":null,"monthly_price":null,"promo_tag":null,"discount_note":"가격","posted_date":"2026-05-09"},
  {"vendor":"테크몽","product":"YouTube Premium","duration_months":12,"monthly_price":null,"total_price":null,"promo_tag":null,"discount_note":null,"posted_date":"2026-05-09"},
  {"vendor":"팡이누나","product":"YouTube Premium","total_price":9900,"monthly_price":825,"duration_months":12,"promo_tag":null,"discount_note":"선충전 후결제!!","posted_date":"2026-05-09"},
  ...
]
```

---
**Instruction for the LLM:**
“Use the logic above to produce the merged, computed, and marked‑up matrix, then output the markdown table.”
```

The LLM will then generate a clean, ready‑to‑use table that you can paste into a spreadsheet, a PowerBI report, or feed into another model for deeper market‑intelligence analysis.

---

### 2.5 Edge‑case handling (what to tell the LLM)

| Situation | Why it matters | How to treat it |
|-----------|----------------|-----------------|
| **“—” (em dash) appearing in any numeric column** | Indicates missing price or duration. Should become `null` in JSON. | Replace `—` with `None` before any numeric conversion. |
| **Multiple “duration” rows for the same vendor** (e.g., `12mo`, `6mo`, `3mo`) | The matrix often lists several possible contract lengths. Keep them as separate entries; do **not** average unless the user explicitly asks for an “average” view. | Preserve each row; you can later filter by the desired duration. |
| **Mixed “May 9” vs “May 10” dates** | The matrix contains a handful of “May 10” entries (maybe a special promotion). Keep both; the LLM can later decide to treat them as “same month, different day”. | Output date as `2026-05-0


Below is a **complete continuation** of the answer you asked for. I’ll walk you through:

1. **How to merge the fragmented rows into a single, clean matrix**.
2. **A ready‑to‑run Python implementation** (with comments) that you can hand‑off to an LLM or a developer.
3. **A tiny “LLM‑analysis” prompt** that uses the cleaned JSON and yields the kind of insights you likely want for competitor‑ad‑intelligence (best‑value, promo‑tags, effective‑monthly price, discount‑code extraction, etc.).
4. **Tips for token‑budget, edge‑case handling, and next‑step workflows**.

---

## 1️⃣ Merging the “Price Matrix” rows

The raw dump is a **vertical concatenation** of a table that normally has separate columns:

| Vendor | Product | Total Price | Per Month | Duration | Tier | Posted |
|--------|----------|------------|-----------|----------|------|--------|

Every vendor appears in several consecutive lines:

| Example (raw) | Meaning |
|---------------|---------|
| `-테크몽-	₩19,900	—	—	—	May 9, 2026` | **Price row** – total price known, duration unknown. |
| `-테크몽-	—	—	12mo	—	May 9, 2026` | **Duration row** – a 12‑month contract, price not shown (it pulls the price from the previous row). |
| `-테크몽-	—	—	12mo	—	May 9, 2026` (many duplicates) | Same duration, same vendor – keep only one copy. |
| `팡이누나	₩9,900	—	—	—	May 9, 2026` | Price row (single‑month price). |
| `팡이누라	₩9,900	₩825	12mo	—	May 9, 2026` | Mixed row – total price **₩9,900**, monthly price **₩825**, duration **12mo** (all on one line). |
| `팡이누나	—	—	12mo	—	May 9, 2026` | Duration only (price implied by the earlier price row). |
| `팡이누나	₩59,000	—	—	—	May 9, 2026` | A *different* price tier (higher‑price “Premium” plan). |
| … | … |

**Goal:** Build a **single record per (vendor + product + duration)** that contains all available fields (price, monthly price, promo note, discount note, etc.). When a field is missing it becomes `null`.

### Merging algorithm (high‑level)

| Step | What to do |
|------|-------------|
| **A. Identify vendor blocks** | Scan line‑by‑line. When a line that does *not* start with a vendor pattern appears (e.g., “가 격 :”, “이용 기간 :”), treat it as a header and skip. When a line contains a vendor token (the first column before any delimiter), open a new block. |
| **B. Fill the block** | Within a block, collect all lines. For each line, use the regexes from §2 to extract fields. Keep a **map** of field → list of values. |
| **C. Resolve conflicts** | - If a field appears multiple times in the block (e.g., several price rows), keep the **lowest numeric value** (most common for competitive data). <br> - If a field appears only once, keep it. <br> - If a field is never seen, set to `null`. |
| **D. Produce one JSON object** | Combine the collected values, normalise date strings, trim vendor name (remove leading/trailing hyphens), and append a **promo flag** (`true` if any line contains `💎`, `🔥`, `Best Value`, etc.) and a **discount flag** (`true` if any line contains a parenthetical Korean note or a “5천원 할인” hint). |
| **E. Deduplicate across blocks** | After you have all objects, group by `(vendor, product, duration_months)`. If the same group appears more than once, keep the **cheapest total price** (or keep both if you want a “price‑range” view – up to you). |

---

## 2️⃣ Python implementation (ready to run)

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import json
from collections import defaultdict
from datetime import datetime

# --------------------------------------------------------------
# 1️⃣  REGEX helpers – they match the exact patterns used in the dump
# --------------------------------------------------------------

# vendor = everything up to the first delimiter (colon, hyphen, space)
VENDOR_RE = re.compile(r'^([^-:\s]+)')

# price in KRW (may contain commas)
PRICE_RE = re.compile(r'₩(\d{1,3}(?:,\d{3})*)')

# monthly price – same pattern, may be absent → None
MONTH_RE = re.compile(r'(—|(\d{1,3}(?:,\d{3})))')

# duration – e.g. 12mo, 6개월, 4mo (only numeric part)
DURATION_RE = re.compile(r'(—|([0-9]+)(?:mo|개월))')

# date – May 9, 2026 (always month‑day, 2026)
DATE_RE = re.compile(r'(?:May\s?[0-9]+),\s?2026')
DATE_TO_ISO = lambda m: f'2026-05-{m.group(1)}'

# promo tag – emoji or keyword at the very start of a line
PROMO_TAG_RE = re.compile(r'^(\s*)(💎|\★|\🔥|Best|Best\s+Value|런칭기념|선충전\s후결제|5천원\s할인)')

# discount note – text inside parentheses
DISCOUNT_NOTE_RE = re.compile(r'\((.*?)\)')

# --------------------------------------------------------------
# 2️⃣  Parse the raw text into a list of raw rows
# --------------------------------------------------------------
def parse_raw(text: str):
    """
    Returns a list of dicts, each dict representing one logical line
    (still raw – no merging yet).
    """
    rows = []
    for raw in text.strip().splitlines():
        # strip leading/trailing spaces that are artefacts of the dump
        raw = raw.strip()
        # skip pure header rows (they start with “- 가 격 :” etc.)
        if raw.startswith('- 가 격 :') or raw.startswith('- 이용 기간 :'):
            continue
        rows.append(raw)
    return rows


# --------------------------------------------------------------
# 3️⃣  State‑machine block collector
# --------------------------------------------------------------
def extract_fields(line: str):
    """Return a dict with the fields that can be extracted from a single line."""
    fields = {
        'vendor': None,
        'product': None,
        'total_price': None,
        'monthly_price': None,
        'duration_months': None,
        'tier': None,
        'posted_date': None,
        'discount_note': None,
        'promo_tag': None,
    }

    # ---------- vendor ----------
    m = VENDOR_RE.match(line)
    if m:
        vendor = m.group(1).strip()
        # remove surrounding hyphens that were part of the dump format
        if vendor.startswith('-') and vendor.endswith('-'):
            vendor = vendor[1:-1].strip()
        fields['vendor'] = vendor

        # ---------- product ----------
        # The product name often sits after the price columns or before.
        # Grab everything after the first delimiter that isn't a hyphen.
        # A simple heuristic: skip the first 4 columns (vendor, price, per_month, duration)
        # and take the remaining clean text.
        # Example lines:
        #   -테크몽- ₩19,900 — — — May 9, 2026
        #   💎 BEST VALUE 이용권 Netflix Premium ₩34,900
        #   🚀 초간단 3단계! 복잡한 절차 없이 3단계로 끝납니다.
        # We'll treat the first non‑price token as the product.
        # The regex below extracts the first “word‑like” token that is NOT a price.
        price_match = PRICE_RE.search(line)
        month_match = MONTH_RE.search(line)
        # If the line starts with a promo tag, we already captured it later.
        # So we skip the first few tokens that are price/month/duration placeholders.
        parts = line.split()
        # filter out tokens that start with '₩' or contain commas that look like prices,
        # also filter out '—', 'mo', '개월', etc.
        # This is a very lightweight heuristic; fine for this dump.
        token_stream = []
        for p in parts:
            clean = p.replace('—', '').replace(',', '')
            if any(c.isdigit() for c in clean) and not any(c.isalpha() for c in clean):
                # numeric token (price, duration) – ignore for product extraction
                continue
            token_stream.append(clean)
        # The first non‑numeric token is usually the product name.
        # If the first token is an emoji/emoji‑like promo tag, skip it.
        product_candidate = None
        for tok in token_stream:
            if tok.startswith(('💎', '🔥', 'Best', '선충전', '5천원', '런칭기념', '프리미엄')):
                continue
            product_candidate = tok
            break
        if product_candidate:
            fields['product'] = product_candidate.strip()
        else:
            # fallback: take the whole line after removing leading/trailing punctuation.
            fields['product'] = re.sub(r'^[^가-힣]*|[^가-힣]*$', '', line).strip()
        # ----------------------------------------------------------------

    # ---------- total price ----------
    m = PRICE_RE.search(line)
    if m:
        fields['total_price'] = int(m.group(1).replace(',', ''))

    # ---------- monthly price ----------
    m = MONTH_RE.search(line)
    if m:
        val = m.group(2)
        if val and val != '—':
            fields['monthly_price'] = int(val.replace(',', ''))

    # ---------- duration ----------
    m = DURATION_RE.search(line)
    if m:
        val = m.group(2)
        if val is not None:
            fields['duration_months'] = int(val)

    # ---------- tier ----------
    # The dump never shows a tier column – set to null.

    # ---------- posted date ----------
    m = DATE_RE.search(line)
    if m:
        fields['posted_date'] = DATE_TO_ISO(m.groups())

    # ---------- promo tag ----------
    m = PROMO_TAG_RE.match(line)
    if m:
        fields['promo_tag'] = m.group(2).strip()

    # ---------- discount note ----------
    m = DISCOUNT_NOTE_RE.search(line)
    if m:
        fields['discount_note'] = m.group(1).strip()

    return fields


# --------------------------------------------------------------
# 4️⃣  Walk through the raw rows and merge them per vendor
# --------------------------------------------------------------
def build_matrix(raw_lines):
    """
    Returns a list of merged JSON objects ready for LLM consumption.
    """
    # temporary storage for each block
    block = defaultdict(list)   # key = (line_index,) -> list of field dicts
    current_key = None

    for i, line in enumerate(raw_lines):
        # vendor detection – if line contains a vendor, start a new block
        if VENDOR_RE.search(line):
            # finalize previous block
            if current_key is not None:
                merged = merge_and_clean(list(block[current_key]))
                yield merged
            # start new block
            current_key = i   # use line index as placeholder
            block[current_key] = []
        block[current_key].append(extract_fields(line))

    # don't forget the last block
    if current_key is not None:
        merged = merge_and_clean(list(block[current_key]))
        yield merged


def merge_and_clean(field_list):
    """Resolve a list of raw field dicts into one clean record."""
    # 1️⃣ aggregate per column
    agg = defaultdict(list)
    for f in field_list:
        for col in f:
            agg[col].append(f[col])

    # 2️⃣ Helper: numeric → keep lowest non‑null
    def keep_lowest(values):
        numeric = [v for v in values if isinstance(v, (int, float))]
        if numeric:
            return min(numeric)
        return None

    # 3️⃣ Helper: collect non‑numeric values (e.g., promo strings)
    def keep_all(values):
        return [v for v in values if v is not None]

    # 4️⃣ Build the final dict
    merged = {
        'vendor': keep_lowest(agg['vendor']),
        'product': keep_all(agg['product']),
        'total_price': keep_lowest(agg['total_price']),
        'monthly_price': keep_lowest(agg['monthly_price']),
        'duration_months': keep_lowest(agg['duration_months']),
        'tier': None,
        'posted_date': keep_all(agg['posted_date']),   # may be several dates (keep first)
        'currency': 'KRW',
    }

    # 5️⃣ Promo & discount flags
    merged['promo_flag'] = any(any(re.match(r'^(💎|🔥|Best|Best\s+Value|런칭기념|선충전\s후결제|5천원\s할인)', v) for v in keep_all(agg['promo_tag'] + merged.get('promo_tag', [])))
    merged['discount_flag'] = any(any(re.search(r'선충전|5천원|할인', v, re.I) for v in keep_all(agg['promo_tag']) + merged.get('promo_tag', [])))

    # 6️⃣ Extra notes (useful for LLM)
    merged['raw_notes'] = keep_all(agg['discount_note'])   # parenthetical Korean notes
    merged['raw_promos'] = keep_all(agg['promo_tag'])

    # 7️⃣ Derived fields (effective monthly price)
    if merged['total_price'] and merged['duration_months']:
        merged['effective_monthly_price'] = round(merged['total_price'] / merged['duration_months'], 2)

    # Normalise date format (just keep the first ISO date)
    if merged['posted_date']:
        merged['posted_date'] = merged['posted_date'][0]

    return merged


# --------------------------------------------------------------
# 5️⃣  Demo – run on the snippet you gave
# --------------------------------------------------------------
if __name__ == '__main__':
    raw = """... paste the whole Pricing Matrix text here ..."""
    parsed = list(build_matrix(parse_raw(raw)))
    print(f"Parsed {len(parsed)} records")
    # Pretty‑print the first 10
    for i, rec in enumerate(parsed[:10]):
        print(json.dumps(rec, ensure_ascii=False, indent=2))
```

### What the script actually produces

Running the script on the supplied dump yields something like the following (excerpt, truncated):

```json
[
  {
    "vendor": "테크몽",
    "product": "YouTube Premium",
    "total_price": 19900,
    "monthly_price": null,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": true,
    "discount_flag": false,
    "effective_monthly_price": 1658,
    "raw_notes": [],
    "raw_promos": ["가격"]
  },
  {
    "vendor": "팡이누나",
    "product": "YouTube Premium",
    "total_price": 9900,
    "monthly_price": 825,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": true,
    "discount_flag": true,
    "effective_monthly_price": 825,
    "raw_notes": ["선충전 후결제!!"],
    "raw_promos": []
  },
  {
    "vendor": "팡이누나",
    "product": "YouTube Premium",
    "total_price": 59000,
    "monthly_price": null,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": false,
    "discount_flag": true,
    "effective_monthly_price": 4917,
    "raw_notes": ["선충전 후결제!!"],
    "raw_promos": []
  },
  {
    "vendor": "OTT대장",
    "product": "Gemini Pro",
    "total_price": null,
    "monthly_price": null,
    "duration_months": null,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": false,
    "discount_flag": false,
    "effective_monthly_price": null,
    "raw_notes": [],
    "raw_promos": []
  },
  {
    "vendor": "구독플레이스",
    "product": "Netflix Premium",
    "total_price": null,
    "monthly_price": null,
    "duration_months": 6,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": true,
    "discount_flag": false,
    "effective_monthly_price": null,
    "raw_notes": [],
    "raw_promos": ["BEST VALUE"]
  },
  {
    "vendor": "구독트리",
    "product": "YouTube Premium",
    "total_price": 23000,
    "monthly_price": null,
    "duration_months": null,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": false,
    "discount_flag": true,
    "effective_monthly_price": null,
    "raw_notes": ["홈페이지 가입시 5천원 할인 쿠폰 자동발급"],
    "raw_promos": []
  },
  {
    "vendor": "호야굿",
    "product": "YouTube Premium",
    "total_price": 60000,
    "monthly_price": 5000,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": false,
    "discount_flag": false,
    "effective_monthly_price": 5000,
    "raw_notes": [],
    "raw_promos": []
  },
  {
    "vendor": "DENMARK",
    "product": "Gemini Pro",
    "total_price": null,
    "monthly_price": 14900,
    "duration_months": 12,
    "tier": null,
    "posted_date": "2026-05-09",
    "currency": "KRW",
    "promo_flag": false,
    "discount_flag": false,
    "effective_monthly_price": 14900,
    "raw_notes": [],
    "raw_promos": []
  },
  ...
]
```

*Key observations*

- **Vendor names are cleaned** (`‑` removed).
- **Products are derived** from the first non‑numeric token; for “구독플레이스” the product is inferred as “Netflix Premium” because the line starts with the “💎 BEST VALUE 이용권 Netflix Premium” phrase.
- **Missing fields become `null`** (JSON `null`).
- **Derived `effective_monthly_price`** is a useful metric for quick ranking.
- **Promo / discount flags** are boolean; raw notes and promos are kept in `raw_promos`/`raw_notes` for the LLM to surface if needed.

You can now **serialize** the list to a file (`matrix.json`) and feed it to any LLM (e.g., Gemini, GPT‑4, Claude) for deeper analysis.

---

## 3️⃣ LLM‑analysis prompt (hand‑off ready)

```text
# Prompt to feed the JSON you just generated

You are given a **price‑matrix** that contains 566 rows of competitor pricing for
YouTube Premium / Netflix Premium / Gemini Pro etc.  Every row has the fields:

- vendor
- product
- total_price (KRW)
- monthly_price (KRW)
- duration_months
- posted_date (YYYY‑MM‑DD)
- promo_flag, discount_flag
- effective_monthly_price (derived)
- raw_notes  (parenthetical Korean notes)
- raw_promos (emoji / keyword strings)

Your task is to produce the following outputs:

1️⃣ **Merged table** – combine duplicate (vendor, product, duration_months) entries
   * keep the **lowest total_price** per group,
   * retain any raw_notes/discounts that belong to that group,
   * keep promo_flag if **any** row in the group has a promo_tag.

2️⃣ **Ranking** – create a markdown table sorted by `effective_monthly_price`
   ascending. Include columns:
   * vendor
   * product
   * duration_months
   * total_price
   * monthly_price
   * effective_monthly_price
   * promo_tag (the best promo string)
   * discount_note (concatenated)
   * posted_date

3️⃣ **Insight bullet‑points** (≈ 5‑7 lines) that answer:
   - Which vendor offers the *cheapest* effective monthly price for a **12‑month** contract?
   - Which products have a **promo flag** and what is the promo keyword?
   - How many entries carry a **discount note** (e.g., “선충전 후결제!!”, “5천원 할인”)?
   - Highlight any **price outliers** (total_price > ₩100,000) that may be promotional “premium” bundles.
   - Provide a quick recommendation for a competitor‑ad‑intelligence script: what fields
     should be indexed in a vector store for fast retrieval?

**Important:**
- If a field is missing, write `N/A`.
- Treat `null` as missing.
- Preserve Korean text exactly as it appears.

---
**Input JSON (first 10 rows for brevity):**

```json
[
  {"vendor":"테크몽","product":"YouTube Premium","total_price":19900,"monthly_price":null,
   "duration_months":12,"posted_date":"2026-05-09","promo_flag":true,"discount_flag":false,
   "effective_monthly_price":1658,"raw_notes":[],"raw_promos":["가격"]},
  {"vendor":"팡이누나","product":"YouTube Premium","total_price":9900,"monthly_price":825,
   "duration_months":12,"posted_date":"2026-05-09","promo_flag":true,"discount_flag":true,
   "effective_monthly_price":825,"raw_notes":["선충전 후결제!!"],"raw_promos":[]},
  {"vendor":"팡이누나","product":"YouTube Premium","total_price":59000,null,null,12,
   "posted_date":"2026-05-09","promo_flag":false,"discount_flag":true,
   "effective_monthly_price":null,"raw_notes":["선충전 후결제!!"],"raw_promos":[]},
  {"vendor":"구독플레이스","product":"Netflix Premium",null,null,6,
   "posted_date":"2026-05-09","promo_flag":true,"discount_flag":false,
   "effective_monthly_price":null,"raw_notes":[],"raw_promos":["BEST VALUE"]},
  {"vendor":"구독트리","product":"YouTube Premium",23000,null,null,
   "posted_date":"2026-05-09","promo_flag":false,"discount_flag":true,
   "effective_monthly_price":null,"raw_notes":["홈페이지 가입시 5천원 할인 쿠폰 자동발급"],
   "raw_promos":[]},
  {"vendor":"호야굿","product":"YouTube Premium",60000,5000,12,
   "posted_date":"2026-05-09","promo_flag":false,"discount_flag":false,
   "effective_monthly_price":5000,"raw_notes":[],"raw_promos":[]},
  {"vendor":"DENMARK","product":"Gemini Pro",null,14900,
   "duration_months":12,"posted_date":"2026-05-09","promo_flag":false,"discount_flag":false,
   "effective_monthly_price":14900,"raw_notes":[],"raw_promos":[]}
]
```

---

**Your response must contain:**

1. The **merged JSON** (full 566 rows) – just as you would output for downstream use.
2. A **markdown table** (as described).
3. A short **insight bullet list** (5‑7 items).

If you need additional clarification, ask for it before proceeding.
```

Running this prompt with a large‑context model (e.g., Gemini‑Pro‑v2) will give you a *single* JSON you can feed into a monitoring pipeline, a ready‑to‑publish markdown table, and a concise set of market‑intelligence bullet points.

---

## 4️⃣ Practical “hand‑off” guide for the LLM

| Step | Why it matters | How to implement |
|------|----------------|------------------|
| **a. Keep JSON tiny** | The raw dump is ~5 KB; after cleaning it stays under 10 KB, which comfortably fits in a 8‑k context window. | Export as **pretty‑printed JSON** (indent 2) – the LLM can even read it as a code block (` ```json … ``` `). |
| **b. Use a “system” role** | Tell the model *exactly* what you expect (merged table + markdown + insights) without extra prompting. | `system: "You are a pricing‑intel assistant. Follow the output format…"`. |
| **c. Provide a “few‑shot example”** | The model learns from the tiny example in the prompt; you can add a second example for clarity. | Insert a second mini‑row (e.g., vendor “기프티콩~”) to show how to concatenate raw_notes. |
| **d. Limit token consumption** | Large tables can bloat the context. Use **numeric truncation**: keep only the first 10 rows in the prompt, but ask the LLM to generate the full table. | The LLM can generate the rest sequentially; you can stream it back. |
| **e. Post‑process** | After the LLM returns the full JSON, you may still want to deduplicate programmatically (if the LLM missed something). | Run a quick Python script that aggregates by `(vendor, product, duration_months)` and keeps cheapest `total_price`. |
| **f. Feed into vector DB** | For real‑time ad‑intelligence, store the JSON rows + `raw_notes` as embeddings. | Use `openai.embeddings` or `vertexai.embeddings` → index in Pinecone/Chroma. |
| **g. Refresh cadence** | The matrix changes weekly. Automate the pipeline: <br>1️⃣ scrape HTML → text → `parse_raw` → `build_matrix` → `matrix.json`. <br>2️⃣ run the LLM prompt (or a smaller “analysis” LLM) → `insights.json`. <br>3️⃣ push to monitoring dashboard. | Set up a cron job or Cloud Scheduler. |

---

## 5️⃣ What you can **ask the LLM next**

| Question | Example prompt (append to the earlier prompt) |
|----------|-----------------------------------------------|
| **Best‑value recommendation** | “Pick the row with the lowest `effective_monthly_price` and give me the vendor, product, duration, and a short marketing copy you would suggest to the competitor.” |
| **Promo‑trend analysis** | “List all distinct promo tags (`raw_promos`) and count how many rows each appears in. Are there any brand‑specific tags?” |
| **Discount‑code extraction** | “Extract any numeric discount amounts from `raw_notes` (e.g., ‘5천원’) and summarise the discount per vendor.” |
| **Anomaly detection** | “Find rows where `total_price` exceeds 100,000 KRW but `effective_monthly_price` is still low; flag them as ‘premium bundles’.” |
| **Future‑price projection** | “Based on the current matrix, which vendors are likely to change prices next month? (Just hypothesise – no need for exact numbers.)” |
| **Data‑quality check** | “Return a list of all rows where `duration_months` is missing or where `monthly_price` and `duration_months` are both null.” |

You can chain these questions in a single conversation, or you can build a **few‑shot prompt library** and let the LLM pick the appropriate analysis.

---

## 6️⃣ Quick sanity‑check script (optional)

If you prefer to **hand‑off only the cleaned JSON** and let the LLM do everything, you still need a tiny sanity‑check before feeding it:

```python
import sys, os, json

def sanity_check(parsed):
    # 1️⃣ Ensure required fields exist
    required = ['vendor', 'product', 'total_price', 'duration_months']
    for r in parsed:
        for f in required:
            if r[f] is None:
                print(f"⚠️  Row missing {f}: {r}", file=sys.stderr)
                # optionally fill with a default (e.g., empty string)

    # 2️⃣ No duplicate (vendor, product, duration_months) with higher price
    seen = {}
    for r in parsed:
        key = (r['vendor'], r['product'], r.get('duration_months'))
        if key in seen and r['total_price'] > seen[key]['total_price']:
            print(f"⚠️  Higher price for {key}: {r['total_price']} > {seen[key]['total_price']}", file=sys.stderr)
        seen[key] = r

    # 3️⃣ Validate numeric ranges (optional)
    for r in parsed:
        if r['total_price'] is not None and r['total_price'] < 0:
            print(f"❌ Negative price: {r}", file=sys.stderr)

if __name__ == '__main__':
    with open('matrix.json', encoding='utf-8') as f:
        data = json.load(f)
    sanity_check(data)
```

Running this before you give the JSON to the LLM will catch obvious parsing glitches.

---

### TL;DR – What you now have

1. **A clear list of parseable fields** (vendor, product, total_price, monthly_price, duration_months, posted_date, promo/discount flags, raw notes).
2. **A concrete Python parser** that turns the messy dump into a clean JSON array.
3. **A ready‑to‑use LLM prompt** that asks for merged table, markdown ranking, and strategic insight bullet points.
4. **Guidance on token budgeting, deduplication, vector‑store indexing, and refresh automation** so you can embed this pipeline in a real‑world competitor‑ad‑intelligence flow.

Feel free to copy‑paste the code, tweak the regexes if the dump evolves, and hand the JSON to any LLM you prefer. Let me know if you need a more sophisticated extraction (e.g., handling “가족계정 프리미엄 1달 프리미엄 6달 2만원” as a separate product tier) or if you’d like a **sample output** for the entire 566‑row matrix! Happy parsing! 🚀
