/**
 * Kakao Annotation — Phase 3
 *
 * Reads  data/kakao-processed/conversations.jsonl
 * Writes data/kakao-annotated/conversations.jsonl  (labels[] populated)
 *
 * Each message receives exactly one intent, one or more topics, and exactly
 * one sentiment label in the labels[] array, e.g.:
 *   ["provide_email", "youtube_premium", "payment", "neutral"]
 *
 * Annotation is rule-based keyword heuristics — no LLM required.
 * Idempotent: re-running overwrites output deterministically.
 *
 * Entry point: npx tsx scripts/kakao-annotate.ts
 *              npm run kakao:annotate
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

type IntentLabel =
  | "inquiry_price"
  | "inquiry_service"
  | "inquiry_process"
  | "provide_email"
  | "confirm_payment"
  | "request_as"
  | "renewal"
  | "cancel"
  | "complaint"
  | "greeting"
  | "other";

type TopicLabel =
  | "youtube_premium"
  | "coursera"
  | "pricing"
  | "payment"
  | "google_family"
  | "activation"
  | "as_support"
  | "renewal"
  | "general";

type SentimentLabel = "positive" | "neutral" | "negative";

interface KakaoMessage {
  id: string;
  conv_id: string;
  ts: string;
  source: "historical" | "live";
  speaker: "operator" | "menu" | "customer";
  user_id: string;
  text: string;
  labels: string[];
  meta: Record<string, unknown>;
}

// ── Known menu button presets ────────────────────────────────────────────────
// speaker=menu messages are automated responses to tapping a button.
// Map known button texts to deterministic labels.

const MENU_PRESETS: Record<string, { intent: IntentLabel; topics: TopicLabel[] }> = {
  서비스목록: { intent: "inquiry_service", topics: ["general"] },
  서비스: { intent: "inquiry_service", topics: ["general"] },
  결제안내: { intent: "inquiry_process", topics: ["payment"] },
  결제: { intent: "inquiry_process", topics: ["payment"] },
  자주묻는질문: { intent: "inquiry_service", topics: ["general"] },
  "a/s신청": { intent: "request_as", topics: ["as_support"] },
  as신청: { intent: "request_as", topics: ["as_support"] },
};

function lookupMenuPreset(
  text: string,
): { intent: IntentLabel; topics: TopicLabel[] } | null {
  // Normalise: remove spaces, lowercase
  const key = text.trim().toLowerCase().replace(/\s+/g, "");
  return MENU_PRESETS[key] ?? null;
}

// ── Email detection ──────────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

// ── Intent detection ─────────────────────────────────────────────────────────

function detectIntent(text: string, speaker: string): IntentLabel {
  const t = text.toLowerCase();

  // Email present → provide_email (highest priority for customer turns)
  if (speaker !== "operator" && EMAIL_RE.test(text)) return "provide_email";

  // Payment confirmation — customer has sent money
  if (/입금|결제\s*완료|보냈습니다|보냈어요|송금|이체\s*완료|입금했|결제했|했습니다|했어요/.test(t))
    return "confirm_payment";

  // A/S and technical issues
  if (/a\/s|as\s*신청|오류|에러|안\s*돼|안돼|안되|작동|안\s*함|문제|고장|접속/.test(t))
    return "request_as";

  // Cancellation / refund
  if (/취소|환불|중단|해지/.test(t)) return "cancel";

  // Renewal
  if (/재가입|재\s*신청|연장|갱신|만료|다시\s*가입/.test(t)) return "renewal";

  // Complaint / frustration
  if (/ㅠㅠ|ㅜㅜ|짜증|불만|화가|왜\s*이렇|이상해|너무|힘들/.test(t)) return "complaint";

  // Price inquiry
  // Require a digit before 원 to avoid "회원입니다", "담당원입니다" false matches
  if (/가격|비용|얼마|요금|[0-9,]+\s*원|가격표|price|cost/.test(t)) return "inquiry_price";

  // Process / how-to inquiry
  if (/어떻게|방법|절차|어떻게\s*하|가입.*방법|신청.*방법|과정|순서/.test(t))
    return "inquiry_process";

  // Service / product inquiry
  if (/서비스|어떤|무엇|뭔가|뭐가|궁금|알고\s*싶|구독|상품/.test(t))
    return "inquiry_service";

  // Greeting (short messages with greeting keywords)
  if (/안녕|감사합니다|감사해요|고맙|감사드|hello|hi/.test(t) && text.trim().length < 40)
    return "greeting";

  return "other";
}

// ── Topic detection ───────────────────────────────────────────────────────────

function detectTopics(text: string): TopicLabel[] {
  const t = text.toLowerCase();
  const topics: Set<TopicLabel> = new Set();

  if (/유튜브|youtube|프리미엄|premium|yt premium/.test(t)) topics.add("youtube_premium");
  if (/코세라|coursera/.test(t)) topics.add("coursera");
  if (/가격|비용|얼마|요금|원[이을을]|₩|할인/.test(t)) topics.add("pricing");
  if (/입금|결제|계좌|이체|송금|계좌번호|거래/.test(t)) topics.add("payment");
  if (/구글|google|가족|family|패밀리|패밀리그룹|초대/.test(t)) topics.add("google_family");
  if (/초대|링크|활성화|이메일.*보내|invite|초대장/.test(t)) topics.add("activation");
  if (/a\/s|as\s*신청|오류|에러|안\s*돼|안돼|안되|문제|고장/.test(t)) topics.add("as_support");
  if (/재가입|연장|갱신|만료/.test(t)) topics.add("renewal");

  // Email itself implies gmail/google family setup context
  if (EMAIL_RE.test(text)) {
    if (/@gmail\.com/.test(text)) topics.add("google_family");
  }

  return topics.size > 0 ? Array.from(topics) : ["general"];
}

// ── Sentiment detection ───────────────────────────────────────────────────────

function detectSentiment(text: string): SentimentLabel {
  const t = text.toLowerCase();

  // Negative: frustration, errors, complaints
  if (/ㅠ+|ㅜ+|안되|안 돼|오류|에러|문제|왜|힘들|이상|짜증|불만|못|고장/.test(t))
    return "negative";

  // Positive: thanks, confirmations, success
  if (
    /감사|고맙|받았|완료|확인했|잘됩니다|잘됐|좋아|고마워|넵|ok|thanks|잘\s*받았|감사드/.test(t)
  )
    return "positive";

  return "neutral";
}

// ── Annotate single message ───────────────────────────────────────────────────

function annotate(msg: KakaoMessage): KakaoMessage {
  // Menu messages: use preset labels when available
  if (msg.speaker === "menu") {
    const preset = lookupMenuPreset(msg.text);
    if (preset) {
      return { ...msg, labels: [preset.intent, ...preset.topics, "neutral"] };
    }
    // Unknown menu text — fall through to heuristics
  }

  const intent = detectIntent(msg.text, msg.speaker);
  const topics = detectTopics(msg.text);
  const sentiment = detectSentiment(msg.text);

  return { ...msg, labels: [intent, ...topics, sentiment] };
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_INTENTS = new Set<string>([
  "inquiry_price", "inquiry_service", "inquiry_process", "provide_email",
  "confirm_payment", "request_as", "renewal", "cancel", "complaint",
  "greeting", "other",
]);
const VALID_TOPICS = new Set<string>([
  "youtube_premium", "coursera", "pricing", "payment", "google_family",
  "activation", "as_support", "renewal", "general",
]);
const VALID_SENTIMENTS = new Set<string>(["positive", "neutral", "negative"]);

function validateLabels(msg: KakaoMessage): string | null {
  if (msg.labels.length < 3) return `too few labels (${msg.labels.length})`;

  const [intent, ...rest] = msg.labels;
  const sentiment = rest[rest.length - 1];
  const topics = rest.slice(0, -1);

  if (!VALID_INTENTS.has(intent)) return `unknown intent: ${intent}`;
  for (const t of topics) {
    if (!VALID_TOPICS.has(t)) return `unknown topic: ${t}`;
  }
  if (!VALID_SENTIMENTS.has(sentiment)) return `unknown sentiment: ${sentiment}`;

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const IN_FILE = path.join("data", "kakao-processed", "conversations.jsonl");
  const OUT_DIR = path.join("data", "kakao-annotated");
  const OUT_FILE = path.join(OUT_DIR, "conversations.jsonl");

  if (!fs.existsSync(IN_FILE)) {
    console.error(`Input not found: ${IN_FILE}`);
    console.error("Run 'npm run kakao:ingest' first.");
    process.exit(1);
  }

  const lines = fs.readFileSync(IN_FILE, "utf-8").trim().split("\n");
  const messages: KakaoMessage[] = lines.map((l) => JSON.parse(l));
  console.log(`Read ${messages.length} messages from ${IN_FILE}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const annotated = messages.map(annotate);

  // Validate
  const errors: string[] = [];
  for (const msg of annotated) {
    const err = validateLabels(msg);
    if (err) errors.push(`${msg.id}: ${err}`);
  }
  if (errors.length > 0) {
    console.error(`\nValidation errors (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
    process.exit(1);
  }

  const out = fs.createWriteStream(OUT_FILE, { encoding: "utf-8", flags: "w" });
  for (const msg of annotated) {
    out.write(JSON.stringify(msg) + "\n");
  }
  out.end();

  // ── Report ─────────────────────────────────────────────────────────────────

  const annotatedConvIds = new Set(annotated.map((m) => m.conv_id));

  const intentCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const sentimentCounts: Record<string, number> = {};

  for (const msg of annotated) {
    const [intent, ...rest] = msg.labels;
    const sentiment = rest[rest.length - 1];
    const topics = rest.slice(0, -1);

    intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
    for (const t of topics) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    sentimentCounts[sentiment] = (sentimentCounts[sentiment] ?? 0) + 1;
  }

  const fmt = (obj: Record<string, number>) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k.padEnd(22)} ${v}`)
      .join("\n");

  console.log(`
Annotation complete:
  Messages annotated : ${annotated.length} / ${messages.length}
  Conversations      : ${annotatedConvIds.size} / 156
  Output             : ${OUT_FILE}

Intents:
${fmt(intentCounts)}

Topics:
${fmt(topicCounts)}

Sentiments:
${fmt(sentimentCounts)}
`);
}

main();
