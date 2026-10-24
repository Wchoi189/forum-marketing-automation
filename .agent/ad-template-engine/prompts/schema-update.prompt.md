# Production Prompt: Schema-First Ad Template Modification

Use this prompt to guide an AI agent to safely perform structured updates using `@tools/ad-template-engine`.

---

```markdown
# Objective
Update marketing template pricing cards and section naming using the `@tools/ad-template-engine` toolkit.

# Target Files
- Canonical Schema: `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml`
- Active HTML Template: `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/redesign-v5v1.html`
- Toolkit: `tools/ad-template-engine`

# Instructions & Specific Changes

## 1. Section: Canva Pro (id: "picsart")
- Add a new card for "Canva Business" to the **left** of "Canva Pro Edu" (i.e. prepend as the FIRST item in the `cards` array):
  - title: "🎨 Canva Business (12개월)"
  - badge: "비즈니스"
  - price: "50,000원"
  - priceDesc: "(월 평균 4,167원)"
  - style: "best"
- Keep the existing "Canva Pro Edu" card as the second card in the array with `style: "pro"`.
- Update notice in `picsart`: Add bullet for Canva Business features (브랜드 키트, 팀 협업, 비즈니스 템플릿 무제한).

## 2. Section: Adobe Creative Cloud (id: "section-adobe")
- Update section `title` from "Adobe Creative Cloud" to "Adobe (Creative Cloud & Express)".
  - **CRITICAL**: Do NOT change `id: "section-adobe"`. Preserving the ID is required for brand border rendering and navigation links.
- Add a new card for "Adobe Express" to the **left** of the 4개월 연간 요금제:
  - title: "⚡ Adobe Express (12개월)"
  - badge: "인기"
  - duration: "12개월 이용권"
  - price: "22,000원"
  - priceDesc: "(월 평균 1,833원)"
  - style: "pro"
- Ensure the existing 4개월 연간 요금제 (`60,000원`) remains directly following it with `style: "best"`.
- Update notice in `section-adobe`: Add a bullet for Adobe Express (SNS 콘텐츠, 릴스/쇼츠 영상 제작, 생성형 AI 템플릿 지원).

# Execution Loop
1. Edit `templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml`.
2. Compile HTML:
   ```bash
   npm run generate --prefix tools/ad-template-engine
   ```
3. Synchronize compiled output to the active ad file:
   ```bash
   cp templates/ppompu-ad-design-system/ui_kits/ppompu-ad/dist/index.html templates/ppompu-ad-design-system/ui_kits/ppompu-ad/redesign-v5v1.html
   ```
4. Verify by running structure and lint checks:
   ```bash
   npm run lint:structure
   npm run lint
   ```
5. Output a markdown summary table showing the updated sections and card orders.
```
