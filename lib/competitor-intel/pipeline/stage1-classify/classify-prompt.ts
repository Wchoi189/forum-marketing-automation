const BODY_TRUNCATE = 1500;

export function buildClassifyPrompt(titleText: string, bodyText: string): string {
  const body = bodyText.length > BODY_TRUNCATE
    ? bodyText.slice(0, BODY_TRUNCATE) + "...(truncated)"
    : bodyText;

  return `You are classifying a Korean e-commerce forum post about subscription services (OTT, software).

Classify into exactly one type:
- direct_offer: vendor selling subscription directly with pricing (e.g. "유튜브 프리미엄 1달 4000원")
- affiliate: post refers to external vendor site (GamsGo, AllKeyShop, Kinguin, etc.)
- promo_code: post advertises a discount/coupon code, no direct product pricing
- comparison: explicitly compares official/retail price vs vendor price (e.g. "공식 14,900원 vs 우리 9,900원")
- unknown: cannot determine post intent

Title: ${titleText}
Body: ${body}

Respond with valid JSON only, no markdown, no extra text:
{
  "postType": "<direct_offer|affiliate|promo_code|comparison|unknown>",
  "confidence": <0.0-1.0>,
  "evidence": {
    "excerpt": "<key phrase copied verbatim from title or body>",
    "reasoning": "<one sentence explaining classification>"
  },
  "affiliateTarget": "<vendor name only if postType=affiliate, else omit>",
  "promoCode": "<code string only if postType=promo_code, else omit>",
  "referencePrice": <integer won amount only if postType=comparison, else omit>
}`;
}
