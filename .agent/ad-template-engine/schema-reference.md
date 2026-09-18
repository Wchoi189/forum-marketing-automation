# Schema Reference & Design System Token Dictionary

**Schema Version:** `ad-1.0`  
**Schema Authority:** `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml`  
**Engine Implementation:** `tools/ad-template-engine/generator.ts` & `tools/ad-template-engine/extractor.ts`

---

## 1. Card Styles & Visual Tokens

Every card in a section subsection carries a `style` property that controls borders, shadows, badges, and text emphasis:

| Style | Border CSS | Card Background | Badge Background & Color | Price Color | Intended Usage |
|---|---|---|---|---|---|
| `normal` | `border: 1px solid rgba(0,0,0,0.04); border-top: 4px solid #3E3C38;` | `#F9F8F6` | `#3E3C38` (White text) | `#1E1E1E` | Entry-level, trial, or secondary cards (e.g. 1개월, 체험형) |
| `best` | `border: 2px solid #1E1E1E;` | `#F9F8F6` | `#1E1E1E` (White text) | `#1E1E1E` | Flagship, recommended long-term, or popular tiers (e.g. 12개월 연간) |
| `pro` | `border: 2px solid #C87A53; box-shadow: 0 8px 24px rgba(200,122,83,0.12);` | `#FAF6F3` / `#F9F8F6` | `#C87A53` (White text) | `#C87A53` | Highlighted high-value, AS-guaranteed, or partner tiers |

---

## 2. Section Brand Accent Borders

Section titles (`<h3>`) sit atop a 2px bottom border defined by `section.id`:

| Section ID | Brand Color | Visual Accent |
|---|---|---|
| `section-youtube` | `rgba(0, 0, 0, 0.06)` | Subtle gray baseline |
| `google-ai` | `rgba(0, 0, 0, 0.06)` | Subtle gray baseline |
| `picsart` (Canva) | `#C87A53` | Warm Terracotta |
| `section-adobe` | `#1E1E1E` | Slate Dark |
| `section-lovable` | `#C87A53` | Warm Terracotta |
| `section-notion` | `rgba(0, 0, 0, 0.06)` | Subtle gray baseline |
| `section-n8n` | `#C87A53` | Warm Terracotta |
| `section-surfshark` (NordVPN) | `#C87A53` | Warm Terracotta |
| `section-coursera` (Online Courses) | `#C87A53` | Warm Terracotta |
| `section-extra` | `#5C5A56` | Neutral Dark |

> [!WARNING]
> **Never modify `section.id`** when updating a section's visible name. Modifying `id` breaks the border color lookup and disconnects top navigation anchors. Only update `section.title`.

---

## 3. Data Schema Shape

```yaml
schemaVersion: "ad-1.0"

header:
  logoSrc: string              # Absolute URL to host logo
  logoAlt: string              # e.g. "SharePlan Logo"
  title: string                # Main heading, e.g. "회원 모집 안내"
  subtitle: string             # Subheading description

navLinks:
  - id: string                 # Anchor href matching section id, e.g. "#section-youtube"
    label: string              # Navigation button label, e.g. "유튜브"

sections:
  - id: string                 # Canonical anchor id
    title: string              # Displayed title, e.g. "Adobe (Creative Cloud & Express)"
    subsections:
      - label?: string         # Optional badge (e.g. "개인 단독")
        desc?: string          # Optional subsection subtitle
        cards:
          - title: string      # Card title with emoji (e.g. "⚡ Adobe Express (12개월)")
            badge?: string     # Pill badge text (e.g. "인기", "BEST", "88% 절감")
            duration?: string  # e.g. "12개월 이용권"
            originalPrice?: string # Strikethrough price, e.g. "공식 정가 169,000원"
            price: string      # Discounted price, e.g. "22,000원" or "품절"
            priceDesc: string  # Unit price, e.g. "(월 평균 1,833원)"
            style: "normal" | "best" | "pro"
    notices:
      - type: "details" | "box"
        title: string          # e.g. "✨ Canva Pro Edu 상세 안내"
        content: string        # Bulleted explanation text with • or 🛡️ AS guarantee

extraSection:
  id: "section-extra"
  title: string
  items:
    - name: string             # App name (e.g. "Supabase Pro Plan")
      duration: string         # e.g. "12개월"
      price: string            # e.g. "82,000원"
  deliveryNote: string         # e.g. "※ 발급 및 세팅 소요 시간: 24시간 이내"

footer:
  termsNotice: string
  kakaoLink: string
  phone: string
  bankAccount: string
  bankDetails: string
  copyright: string
```
