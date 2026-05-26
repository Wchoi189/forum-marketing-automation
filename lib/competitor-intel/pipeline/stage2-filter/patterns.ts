export const NOISE_PATTERNS: { pattern: RegExp; category: string }[] = [
  // license / copyright footer
  { pattern: /본 게시물의 저작권은/, category: "license_footer" },
  { pattern: /원본 식별자:/, category: "license_footer" },
  { pattern: /무단 복제.*저작권법/, category: "license_footer" },
  { pattern: /All Rights Reserved/i, category: "license_footer" },
  { pattern: /SP-\d{14}-[A-F0-9]+/, category: "license_footer" },
  { pattern: /793-08-03288/, category: "license_footer" },

  // payment instructions
  { pattern: /^입금자\s*알려/i, category: "payment_instructions" },
  { pattern: /^계좌번호/i, category: "payment_instructions" },
  { pattern: /^쪽지\s*주세요/i, category: "payment_instructions" },
  { pattern: /^문자\/?카톡/i, category: "payment_instructions" },

  // FAQ / QA
  { pattern: /^Q[.：]\s/i, category: "faq_qa" },
  { pattern: /^A[.：]\s/i, category: "faq_qa" },
  { pattern: /^질문/i, category: "faq_qa" },
  { pattern: /^답변/i, category: "faq_qa" },

  // generic boilerplate
  { pattern: /^공식\s*가격/i, category: "generic_boilerplate" },
  { pattern: /^원가/i, category: "generic_boilerplate" },
  { pattern: /www\.ppomppu\.co\.kr/i, category: "generic_boilerplate" },
];

export const PRICE_PATTERN = /[₩￦]?\d{1,3}(,\d{3})*원?|[\d,]+원/;

export const DURATION_PATTERN = /\d+\s*(개월|년|달|주|일|month|year)/i;

export const PRODUCT_KEYWORDS = [
  /프리미엄/i,
  /구독/i,
  /Netflix|넷플릭스|넷플/i,
  /YouTube|유튜브/i,
  /Disney|디즈니/i,
  /Spotify|스포티파이/i,
  /Apple.*TV|애플.*TV/i,
  /Tving|티빙/i,
  /Watcha|왓챠/i,
  /WAVVE|웨이브/i,
  /Coupang.*Play|쿠팡.*플레이/i,
  /Naver.*Plus|네이버.*플러스/i,
  /카카오.*TV/i,
  /ChatGPT|GPT/i,
  /Claude/i,
  /Gemini/i,
  /Office.*365|Microsoft.*365/i,
  /Adobe/i,
  /계정/i,
  /가족계정/i,
  /개인계정/i,
];
