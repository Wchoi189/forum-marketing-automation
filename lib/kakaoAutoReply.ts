/**
 * Kakao Auto-Reply — Phase 5
 *
 * Classifies an incoming customer utterance and generates a Korean-language
 * customer service reply using OpenAI gpt-4o-mini.
 *
 * The Kakao skill endpoint must respond within 3 seconds. This module races
 * the OpenAI call against KAKAO_AUTOREPLY_TIMEOUT_MS (default 2400 ms) and
 * returns null on timeout so the caller can fall back to a neutral ACK.
 *
 * Kill-switch: KAKAO_AUTOREPLY_ENABLED=true (default false).
 * Prerequisite: OPENAI_API_KEY must be set.
 *
 * Dev channel only until operator validates reply quality.
 * Never include customer PII in prompts — only the raw utterance text is sent.
 */

import OpenAI from "openai";
import { ENV } from "../config/env.js";
import { logger } from "./logger.js";

// ── FAQ context ───────────────────────────────────────────────────────────────
// Compact representation of the 20-entry KB (same source as kakao-kb-export.ts).
// Embedded here to avoid file I/O on every request.

const FAQ_CONTEXT = `
1.  [가격] 유튜브 프리미엄 6개월: 25,000원 (계좌이체)
2.  [가격] 유튜브 프리미엄 12개월: 50,000원 (계좌이체)
3.  [가입] 가입 방법: Gmail 주소 + 서비스 종류 + 금액을 채널로 전송 → 구글 패밀리 초대 발송
4.  [가입] 필요 이메일: Gmail(xxxxx@gmail.com). 기존 패밀리 그룹 있으면 먼저 탈퇴 필요
5.  [결제] 결제: IBK기업은행 43414622001010 최웅비. 입금 후 채널에 완료 알림 필요
6.  [결제] 입금 후: 입금 확인 즉시 구글 패밀리 초대장을 Gmail로 발송
7.  [초대] 수락 방법: Gmail에서 수락 버튼 클릭 → 즉시 프리미엄 활성화. 링크: https://myaccount.google.com/family/details
8.  [초대] 초대 미수신: ① 스팸 확인 ② https://myaccount.google.com/family/details 에서 직접 수락
9.  [문제] 프리미엄 미활성화: 로그아웃 후 재로그인, 캐시 삭제, 기존 패밀리 탈퇴 시도
10. [문제] 기존 패밀리 탈퇴: https://families.google/families/ 에서 탈퇴 후 재초대 요청
11. [문제] 갑자기 해제: 패밀리 그룹 자동 탈퇴. 채널 문의 시 재초대 처리
12. [갱신] 연장: 만료 전 채널 문의. 가격 동일 (6개월 25,000원 / 12개월 50,000원)
13. [갱신] 분납 가능: 만료 전까지 잔액 입금 가능
14. [코세라] 코세라 플러스 가격/가입: 정확한 금액은 채널로 문의
15. [취소] 환불: 원칙적으로 어렵지만 귀책 사유 시 개별 협의
16. [변경] 패밀리 그룹 변경: 구글 정책상 12개월에 1회. https://families.google/families/
17. [서비스] 제공 서비스: 유튜브 프리미엄 패밀리 플랜(6개월/12개월), 코세라 플러스
18. [A/S] 이용 중 문제: 채널로 문의 시 신속 해결. 반드시 해결해 드립니다.
19. [채널] 채널 추가: 카카오톡에서 '@shareplan' 검색 또는 https://pf.kakao.com/_shareplan
20. [일반] 기타 문의: 채널 운영자에게 직접 문의해 주세요.
`.trim();

const SYSTEM_PROMPT = `당신은 SharePlan 카카오 채널의 고객상담 AI입니다.
SharePlan은 유튜브 프리미엄 패밀리 플랜과 코세라 플러스 구독 공유 서비스를 제공합니다.
아래 FAQ를 참고해 고객 문의에 간결하고 친절하게 답변하세요.

규칙:
- 반드시 한국어로 답변
- 3문장 이내로 간결하게
- FAQ에 정확한 답이 있으면 그 내용을 사용
- FAQ에 없는 내용은 "채널 운영자에게 문의해 주세요"로 안내
- 금액·계좌 등 민감 정보는 FAQ에 있는 내용만 인용
- 고객의 개인정보(이메일, 이름 등)를 직접 요청하지 말 것 — 필요하다면 "이 채널로 직접 알려주세요"라고 안내

FAQ:
${FAQ_CONTEXT}`;

// ── OpenAI client (lazy singleton) ────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY! });
  }
  return _openai;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a Korean customer service reply for the given utterance, or null if:
 * - KAKAO_AUTOREPLY_ENABLED is false
 * - OPENAI_API_KEY is absent
 * - The call does not complete within KAKAO_AUTOREPLY_TIMEOUT_MS
 * - The OpenAI call throws
 *
 * Callers should fall back to a neutral ACK when null is returned.
 */
export async function getAutoReply(utterance: string): Promise<string | null> {
  if (!ENV.KAKAO_AUTOREPLY_ENABLED || !ENV.OPENAI_API_KEY) return null;

  // Hard deadline so we never breach the Kakao 3-second skill response limit
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), ENV.KAKAO_AUTOREPLY_TIMEOUT_MS)
  );

  const llmPromise = (async (): Promise<string | null> => {
    try {
      const resp = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: utterance },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });

      const text = resp.choices[0]?.message?.content?.trim();
      if (!text) return null;

      logger.info(
        { event: "kakao_autoreply_generated", preview: text.slice(0, 80) },
        "[KakaoAutoReply] Reply generated"
      );
      return text;
    } catch (err) {
      logger.error(
        { event: "kakao_autoreply_error", err },
        "[KakaoAutoReply] OpenAI call failed"
      );
      return null;
    }
  })();

  const result = await Promise.race([llmPromise, timeoutPromise]);

  if (result === null) {
    logger.warn(
      { event: "kakao_autoreply_timeout_or_null", utteranceLen: utterance.length },
      "[KakaoAutoReply] No reply within timeout — falling back to neutral ACK"
    );
  }

  return result;
}
