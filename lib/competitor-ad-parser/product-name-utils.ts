/**
 * Shared product name normalization utilities.
 *
 * Cleans up raw extracted product names by stripping navigation text,
 * boilerplate, decorative markers, and enforcing length limits.
 */

// Navigation / site-header patterns that should never appear in a product name
const NOISE_PATTERNS = [
  // PPOMPPU navigation / header text
  /PPOMPPU\s*장터/,
  /뽐뿌\s*정보\s*커뮤니티/,
  /오픈포럼/,
  /갤러리\s*창터/,
  /뉴스\s*상담실/,
  /회원가입/,
  /아이디\s*비번/,
  /로그인/,
  // "Go to homepage" style links
  /홈페이지\s*바로가기/,
  // Verification / trust boilerplate
  /검증된\s*뽐뿌인/,
  /뽐뿌\s*가입\s*\d{4}년/,
  /먹튀하는\s*신생업체/,
  // Marketing / pricing comparison boilerplate
  /공식\s*가격/,
  /압도적인\s*가격/,
  /BEST\s*CHOICE/,
  /BEST\s*VALUE/,
  // "New subscription" marketing
  /새로운\s*구독의\s*방식/,
  // Instructional / contact text
  /이메일\s*제출/,
  /문자\/?카톡/,
  /초대\s*수락/,
  /상품\s*결제/,
  /쪽지\s*주세요/,
  /카톡\s*아이디/,
];

// Decorative / non-product text patterns
const DECORATIVE_PATTERNS = [
  /💎/,
  /🔥/,
  /⭐/,
  /💰/,
  /HOT\s*/i,
  /Best\s*\)/i,
  /런칭기념/,
  // "이용권" (subscription/ticket) — not part of product name
  /이용권\s*/g,
  // Month/year duration — stripped when already captured separately
  /\d{1,2}\s*개월/g,
  /\d{1,2}\s*년/g,
  // Price strings — must have ₩ or 원 to avoid stripping plain numbers
  /₩\s*\d{1,3}(?:,\d{3})*/g,
  /₩\s*\d+/g,
  /\d{1,3}(?:,\d{3})+\s*원/g,
  /\d+\s*원/g,
];

// Known product name keywords — if none of these appear, we use a generic fallback
const PRODUCT_KEYWORDS = [
  "유튜브", "YouTube", "넷플릭스", "Netflix", "디즈니", "Disney",
  "웨이브", "WAVVE", "티빙", "TVING", "멜론", "Melon",
  "지니", "Genie", "쿠팡", "Coupang", "애플", "Apple",
  "제미나이", "Gemini", "퍼플렉시티", "Perplexity", "챗지피티", "ChatGPT",
  "서프샤크", "Surfshark", "티빙", "왓챠", "Watcha", "코세라", "Coursera",
  "듀오링고", "Duolingo", "밀리", "밀리의서재",
  "OTT", "프리미엄", "Premium", "프로", "Pro", "울트라", "Ultra",
  "공유", "가족", "파티",
];

/**
 * Clean a raw product name extracted from HTML/text.
 *
 * Steps:
 * 1. Strip decorative patterns (emojis, marketing badges)
 * 2. Strip navigation / boilerplate patterns
 * 3. Collapse whitespace
 * 4. If nothing recognizable remains, return a generic fallback
 * 5. Enforce max length
 */
export function cleanProductName(raw: string, maxLength: number = 50): string {
  let name = raw;

  // Step 1: Remove decorative patterns
  for (const pattern of DECORATIVE_PATTERNS) {
    name = name.replace(pattern, "");
  }

  // Strip vendor-ID-like prefixes: "구독플레이스793-08-03288" → ""
  name = name.replace(/[가-힣]+\d{2,4}-\d{2}-\d{4,5}\s*/g, "");

  // Step 2: Remove noise patterns
  for (const pattern of NOISE_PATTERNS) {
    name = name.replace(pattern, "");
  }

  // Step 3: Collapse whitespace and trim
  name = name.replace(/\s+/g, " ").trim();

  // Remove trailing / leading punctuation that got orphaned
  name = name.replace(/^[\s:/,]+|[\s:/,]+$/g, "").trim();

  // Step 4: If nothing meaningful remains, return a generic fallback
  if (!name || name.length < 2) {
    return "OTT 구독";
  }

  // Step 5: Check if any product keyword exists
  const hasProductKeyword = PRODUCT_KEYWORDS.some((kw) => name.includes(kw));
  if (!hasProductKeyword) {
    // Try to extract just the product-relevant portion
    // Look for Korean subscription keywords
    const kwMatch = name.match(/(유튜브[^\n]{0,30}|넷플릭스[^\n]{0,30}|제미나이[^\n]{0,30}|퍼플렉시티[^\n]{0,30}|티빙[^\n]{0,30}|디즈니[^\n]{0,30}|왓챠[^\n]{0,30}|OTT[^\n]{0,30})/);
    if (kwMatch) {
      name = kwMatch[1].trim();
    }
    // If still no keyword, use the first meaningful words (up to 3 tokens)
    const tokens = name.split(/\s+/);
    if (tokens.length > 3) {
      name = tokens.slice(0, 3).join(" ");
    }
  }

  // Final cleanup
  name = name.replace(/\s+/g, " ").trim();

  // Enforce max length
  if (name.length > maxLength) {
    // Try to cut at a word boundary
    const truncated = name.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");
    name = lastSpace > maxLength / 2 ? truncated.slice(0, lastSpace) : truncated;
  }

  return name || "OTT 구독";
}

/**
 * Deduplicate an array of products by (name, price, duration) signature.
 * Keeps the first occurrence (which typically has the most complete data).
 * Also removes products whose name is fully contained in another (after lowercasing).
 */
export function deduplicateProducts<T extends { name: string; price_krw?: number; duration_months?: number }>(
  products: T[]
): T[] {
  // First pass: signature-based dedup
  const seen = new Set<string>();
  const unique = products.filter((p) => {
    const sig = `${p.name}|${p.price_krw ?? ""}|${p.duration_months ?? ""}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  // Second pass: remove shorter names fully contained in longer ones
  const result: T[] = [];
  for (const p of unique) {
    const lower = p.name.toLowerCase();
    const contained = unique.some(
      (other) => other !== p && other.name.toLowerCase().includes(lower) && other.name.length > p.name.length
    );
    if (!contained) result.push(p);
  }
  return result;
}
