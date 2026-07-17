---
name: pricing-access-matrix
description: Use when the user wants to clean gray-market or reseller-style subscription product lists, verify official pricing where possible, convert USD prices to KRW, build markup pricing matrices, and generate Korean product cards or chat-notification copy. Triggers on phrases like pricing matrix, markup, KRW conversion, official price, chat cards, Korean product cards, access requirements, subscription offers.
---

# pricing-access-matrix

This skill standardizes product offer cleanup for subscription-style product lists.

## Use cases
- Clean messy product lists into normalized tables.
- Verify official vendor pricing where possible.
- Flag gaps between candidate resale price and official public MSRP.
- Convert USD to KRW.
- Build 30%, 35%, and 40% markup tables.
- Generate Korean product cards for KakaoTalk, Telegram, or chat notifications.
- Add access requirement notes such as email only, activation key, shared profile, or credentials required.

## Inputs expected
The user may provide any of the following:
- Raw candidate product lines, for example: `Supabase 12m - 40$`
- Structured tables with columns like service, plan, price, access method, and requirements
- A preferred FX rate, or previously used internal conversion logic
- Requested output format such as report, CSV, HTML, spreadsheet, or chat cards

## Workflow
1. Normalize product names.
2. Parse duration, plan type, and candidate USD price.
3. Research official pricing pages for each product when possible.
4. Mark each item as one of:
   - `official matched`
   - `official structure verified, candidate price used`
   - `public official price unclear`
5. Convert USD to KRW using one of these rules in order:
   - User-provided FX rate
   - Existing workspace baseline files
   - Live market FX lookup
6. Build a matrix with these columns:
   - Product
   - Clean title
   - Term
   - Candidate USD
   - Official pricing note
   - KRW base cost
   - KRW sell @ 30%
   - KRW sell @ 35%
   - KRW sell @ 40%
   - Margin at 40%
   - Access requirement
   - Risk note
7. Generate Korean product-card copy using the 40% price by default unless the user specifies another markup.
8. Produce deliverables as requested: HTML report, CSV, XLSX, or short Korean chat-notification copy.

## Pricing rules
- Default markup outputs: 30%, 35%, 40%.
- Default promoted price in cards: 40% markup.
- Round KRW prices to the nearest whole won unless the user asks for rounding to the nearest 100 or 1,000 won.
- If official retail price is far above candidate price, explicitly flag: `공식가 대비 매우 낮은 후보가 — 검증 필요`.

## Access requirement labels
Map access methods into one of these standard labels:
- `이메일만 필요`
- `활성화 키 / 코드 제공`
- `독립 파일 / 코드 전달`
- `공유 계정 + 프로필 + PIN`
- `로그인 자격 증명 제공`
- `별도 확인 필요`

## Required outputs
### A. Pricing matrix table
Use this column structure in Korean:
- 서비스/상품명
- 플랜 또는 기간
- 기준가 USD
- 기준가 KRW
- 판매가 30%
- 판매가 35%
- 판매가 40%
- 접근 방식
- 비고

### B. Korean chat card format
Use this structure:

`[상품명]`
- 이용기간: [기간]
- 안내가: [KRW price]
- 전달 방식: [access method]
- 필요 정보: [what buyer must provide]
- 참고: [stock/policy/verification note]

### C. Checklist block
When relevant, add a short ordering checklist:
- 이메일만 보내면 되는 상품
- 코드만 전달되는 상품
- 공유 계정형 상품
- 주문 전 검증이 필요한 상품

## Tone and language
- Keep product names in official English when recognizable.
- Write surrounding explanation in Korean.
- Sound like an internal operator preparing a resale list, not a marketing brochure.
- Be concise, structured, and practical.

## Risk note policy
Whenever an item involves vouchers, shared profiles, preconfigured files, or credentials from third parties, add a neutral caution note such as:
- `정책 변경 또는 공급 상태에 따라 제공 방식이 달라질 수 있습니다.`
- `공식 정책과 상이할 수 있으므로 사전 확인 권장.`

## Suggested file outputs
When generating files, prefer:
- `pricing-matrix-chat-cards-ko.html`
- `pricing-matrix-korean.csv`
- `sample-product-cards-ko.csv`
- `access-matrix-chat-cards-ko.html`
- `access-pricing-matrix-ko.csv`
- `sample-access-cards-ko.csv`

## Example prompt patterns
- "Clean this subscription list, verify official prices, convert to KRW, and make a 40% markup table."
- "Turn this access-method table into Korean product cards for chat sales."
- "Build a pricing matrix and reseller report from these candidate products."

## Example output blocks
### Example note
`Microsoft 365 12개월 — 후보가가 공식 소매가보다 매우 낮아 검증 필요`

### Example card
`ExpressVPN 12개월`
- 이용기간: 12개월
- 안내가: 12,663원
- 전달 방식: 독립 활성화 키 / 코드 또는 파일
- 필요 정보: 이메일 불필요
- 참고: 공급 상황에 따라 전달 형식이 바뀔 수 있습니다.
