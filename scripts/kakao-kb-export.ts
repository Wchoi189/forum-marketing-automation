/**
 * Kakao Knowledge Base Export — Phase 4
 *
 * Generates data/kakao-kb/knowledge-base-import.xlsx in Kakao's 11-column
 * FAQ format, ready for manual import via Channel Partner Center dashboard.
 *
 * FAQ entries are derived from annotated conversation patterns in
 * data/kakao-annotated/conversations.jsonl. The Category hierarchy mirrors
 * the intent/topic taxonomy from kakao-chatbot-v1.json.
 *
 * KB schema columns (in order):
 *   FAQ_No | Category1 | Category2 | Category3 | Category4 | Category5 |
 *   Question | Answer | Landing URL | Landing URL Button Name | Image Info (URL)
 *
 * Idempotent: re-running overwrites output.
 * Entry point: npx tsx scripts/kakao-kb-export.ts
 *              npm run kakao:kb-export
 */

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

// ── KB row type ───────────────────────────────────────────────────────────────

interface KbRow {
  FAQ_No: number;
  Category1: string;
  Category2: string;
  Category3: string;
  Category4: string;
  Category5: string;
  Question: string;
  Answer: string;
  "Landing URL": string;
  "Landing URL Button Name": string;
  "Image Info (URL)": string;
}

// ── FAQ entries ───────────────────────────────────────────────────────────────
// Derived from high-frequency Q&A patterns in the annotated corpus.
// Category hierarchy: Category1 = 대분류, Category2 = 서비스, Category3 = 주제
// Prices as of spec date 2026-04-18 — verify before re-import if prices change.

const FAQ_ENTRIES: Omit<KbRow, "FAQ_No">[] = [
  // ── 서비스 안내 > 유튜브 프리미엄 > 가격 문의 ─────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "가격 문의",
    Category4: "",
    Category5: "",
    Question: "유튜브 프리미엄 6개월 가격이 얼마인가요?",
    Answer:
      "유튜브 프리미엄 패밀리 플랜 6개월 이용권은 25,000원입니다.\n결제는 계좌이체로 진행됩니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "가격 문의",
    Category4: "",
    Category5: "",
    Question: "유튜브 프리미엄 12개월 가격이 얼마인가요?",
    Answer:
      "유튜브 프리미엄 패밀리 플랜 12개월 이용권은 50,000원입니다.\n결제는 계좌이체로 진행됩니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 유튜브 프리미엄 > 가입 방법 ─────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "가입 방법",
    Category4: "",
    Category5: "",
    Question: "유튜브 프리미엄 가입은 어떻게 하나요?",
    Answer:
      "① Gmail 주소, ② 서비스 종류(유튜브 6개월/12개월), ③ 금액을 이 채널로 보내주세요.\n확인 후 구글 패밀리 초대장을 이메일로 발송해 드립니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "가입 방법",
    Category4: "",
    Category5: "",
    Question: "어떤 이메일 주소가 필요한가요?",
    Answer:
      "Gmail 계정(xxxxx@gmail.com)이 필요합니다. 구글 패밀리 그룹 초대에 사용됩니다.\n기존에 다른 구글 패밀리 그룹에 가입되어 있다면 먼저 탈퇴해 주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 유튜브 프리미엄 > 결제 안내 ─────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "결제 안내",
    Category4: "",
    Category5: "",
    Question: "결제 방법이 어떻게 되나요?",
    Answer:
      "계좌이체로 진행됩니다.\n\n은행: IBK기업은행\n계좌: 43414622001010\n예금주: 최웅비\n\n입금 후 이 채널로 완료 알림을 보내주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "결제 안내",
    Category4: "",
    Category5: "",
    Question: "입금 후 어떻게 해야 하나요?",
    Answer:
      "입금 완료 후 이 채널로 '입금 완료'라고 알려주세요.\n확인 즉시 구글 패밀리 초대장을 이메일로 발송해 드립니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 유튜브 프리미엄 > 초대 수락 ─────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "초대 수락",
    Category4: "",
    Category5: "",
    Question: "입금 후 어떻게 프리미엄을 사용하나요?",
    Answer:
      "입금 확인 후 Gmail로 구글 패밀리 그룹 초대장을 보내드립니다.\n이메일에서 수락 버튼을 클릭하시면 즉시 유튜브 프리미엄이 활성화됩니다.",
    "Landing URL": "https://myaccount.google.com/family/details",
    "Landing URL Button Name": "패밀리 그룹 확인",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "초대 수락",
    Category4: "",
    Category5: "",
    Question: "초대 이메일이 오지 않아요",
    Answer:
      "① 스팸 메일함을 확인해 주세요.\n② 아래 링크에서 직접 수락도 가능합니다.\n③ 그래도 안 되면 채널로 다시 알려주세요.",
    "Landing URL": "https://myaccount.google.com/family/details",
    "Landing URL Button Name": "패밀리 그룹 확인",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 유튜브 프리미엄 > 문제 해결 ─────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "문제 해결",
    Category4: "",
    Category5: "",
    Question: "초대를 수락했는데 프리미엄이 활성화되지 않아요",
    Answer:
      "다음 순서로 시도해 보세요:\n① 유튜브 앱에서 로그아웃 후 재로그인\n② 캐시 삭제 후 재시도\n③ 기존 구글 패밀리 그룹에 가입되어 있다면 먼저 탈퇴\n\n해결이 안 되면 채널로 문의해 주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "문제 해결",
    Category4: "",
    Category5: "",
    Question: "기존 구글 패밀리 그룹 탈퇴는 어떻게 하나요?",
    Answer:
      "아래 링크에서 패밀리 그룹 현황을 확인하고 탈퇴할 수 있습니다.\n탈퇴 후 초대장 재발송을 요청해 주세요.",
    "Landing URL": "https://families.google/families/",
    "Landing URL Button Name": "패밀리 그룹 관리",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "문제 해결",
    Category4: "",
    Category5: "",
    Question: "가입 후 갑자기 프리미엄이 해제됐어요",
    Answer:
      "구글 패밀리 그룹에서 자동 탈퇴되었을 수 있습니다.\n채널로 문의해 주시면 재초대해 드립니다. 반드시 해결해 드립니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 유튜브 프리미엄 > 갱신 ────────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "갱신",
    Category4: "",
    Category5: "",
    Question: "만료 후 연장은 어떻게 하나요?",
    Answer:
      "만료 전에 이 채널로 문의해 주시면 신규 가입과 동일한 방법으로 연장해 드립니다.\n가격도 동일합니다(6개월 25,000원 / 12개월 50,000원).",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "유튜브 프리미엄",
    Category3: "갱신",
    Category4: "",
    Category5: "",
    Question: "분납이 가능한가요?",
    Answer:
      "네, 가능합니다. 만료 전까지 잔액을 입금하시면 됩니다.\n일정 조율은 채널로 문의해 주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 코세라 플러스 > 가격 문의 ──────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "코세라 플러스",
    Category3: "가격 문의",
    Category4: "",
    Category5: "",
    Question: "코세라 플러스 가격이 얼마인가요?",
    Answer:
      "코세라 플러스 이용권도 제공하고 있습니다. 정확한 가격은 채널로 문의해 주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "코세라 플러스",
    Category3: "가입 방법",
    Category4: "",
    Category5: "",
    Question: "코세라 플러스 가입은 어떻게 하나요?",
    Answer:
      "코세라 플러스 가입 방법은 채널로 문의해 주시면 안내해 드립니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },

  // ── 서비스 안내 > 취소·변경 ────────────────────────────────────────────
  {
    Category1: "서비스 안내",
    Category2: "취소·변경",
    Category3: "서비스 취소",
    Category4: "",
    Category5: "",
    Question: "서비스 취소나 환불이 가능한가요?",
    Answer:
      "서비스 특성상 원칙적으로 환불이 어렵습니다.\n단, 서비스 제공 불가 등 귀책 사유가 있을 경우 개별 협의합니다. 채널로 문의해 주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "서비스 안내",
    Category2: "취소·변경",
    Category3: "그룹 변경",
    Category4: "",
    Category5: "",
    Question: "구글 패밀리 그룹 변경이 가능한가요?",
    Answer:
      "구글 정책상 패밀리 그룹 변경은 12개월에 1회만 가능합니다.\n변경이 필요하시면 채널로 문의해 주세요.",
    "Landing URL": "https://families.google/families/",
    "Landing URL Button Name": "패밀리 그룹 관리",
    "Image Info (URL)": "",
  },

  // ── 이용 안내 > 공통 ───────────────────────────────────────────────────
  {
    Category1: "이용 안내",
    Category2: "공통",
    Category3: "서비스 종류",
    Category4: "",
    Category5: "",
    Question: "어떤 서비스를 제공하나요?",
    Answer:
      "SharePlan은 구독 공유 서비스를 제공합니다.\n• 유튜브 프리미엄 패밀리 플랜 (6개월 / 12개월)\n• 코세라 플러스\n\n자세한 내용은 채널로 문의해 주세요.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "이용 안내",
    Category2: "공통",
    Category3: "A/S 신청",
    Category4: "",
    Category5: "",
    Question: "이용 중 문제가 생기면 어떻게 하나요?",
    Answer:
      "이 채널로 문의해 주시면 신속히 해결해 드립니다.\n문자/전화로도 연락 가능합니다. 반드시 해결해 드립니다.",
    "Landing URL": "",
    "Landing URL Button Name": "",
    "Image Info (URL)": "",
  },
  {
    Category1: "이용 안내",
    Category2: "공통",
    Category3: "채널 추가 안내",
    Category4: "",
    Category5: "",
    Question: "카카오 채널은 어디서 추가할 수 있나요?",
    Answer:
      "카카오톡에서 '@shareplan'을 검색하거나 아래 채널 추가 버튼을 이용해 주세요.\n채널 추가 후 메시지로 서비스 소식과 혜택을 받으실 수 있습니다.",
    "Landing URL": "https://pf.kakao.com/_shareplan",
    "Landing URL Button Name": "채널 추가",
    "Image Info (URL)": "",
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const OUT_DIR = path.join("data", "kakao-kb");
  const OUT_FILE = path.join(OUT_DIR, "knowledge-base-import.xlsx");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Assign sequential FAQ_No
  const rows: KbRow[] = FAQ_ENTRIES.map((entry, i) => ({
    FAQ_No: i + 1,
    ...entry,
  }));

  // Build worksheet — column order must match Kakao's import schema exactly
  const COL_ORDER: (keyof KbRow)[] = [
    "FAQ_No",
    "Category1",
    "Category2",
    "Category3",
    "Category4",
    "Category5",
    "Question",
    "Answer",
    "Landing URL",
    "Landing URL Button Name",
    "Image Info (URL)",
  ];

  const wsData: (string | number)[][] = [
    COL_ORDER as string[], // header row
    ...rows.map((r) => COL_ORDER.map((col) => r[col])),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths for readability
  ws["!cols"] = [
    { wch: 8 },  // FAQ_No
    { wch: 14 }, // Category1
    { wch: 18 }, // Category2
    { wch: 14 }, // Category3
    { wch: 10 }, // Category4
    { wch: 10 }, // Category5
    { wch: 40 }, // Question
    { wch: 60 }, // Answer
    { wch: 45 }, // Landing URL
    { wch: 20 }, // Landing URL Button Name
    { wch: 25 }, // Image Info (URL)
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "FAQ");

  XLSX.writeFile(wb, OUT_FILE);

  // ── Report ─────────────────────────────────────────────────────────────────

  // Count by Category2
  const byCat2: Record<string, number> = {};
  for (const r of rows) {
    byCat2[r.Category2] = (byCat2[r.Category2] ?? 0) + 1;
  }

  const entriesWithUrl = rows.filter((r) => r["Landing URL"]).length;

  console.log(`
Kakao KB export complete:
  Entries    : ${rows.length}
  Output     : ${OUT_FILE}
  With URL   : ${entriesWithUrl}

By Category2:
${Object.entries(byCat2)
  .map(([cat, n]) => `  ${cat.padEnd(20)} ${n}`)
  .join("\n")}

Next step: Import ${OUT_FILE} via Kakao Channel Partner Center dashboard.
  (Channel Partner Center → Knowledge Base → knowledge-base-test → 가져오기)
`);
}

main();
