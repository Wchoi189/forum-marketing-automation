import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNodeExpressEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";
import { ENV } from "../config/env.js";

// ── System prompt ─────────────────────────────────────────────────────────────

export const COACH_SYSTEM_PROMPT = `You are a communications coach for SharePlan, a Korean Google Family subscription service.
You advise the operator on how to respond to Kakao customer messages. You never send messages yourself.
All suggestions are for copy-paste review only — the operator always decides before any message is sent.

Tone guidelines:
- Casual-but-professional Korean business register (해요체 by default, 합쇼체 on request)
- Concise — Kakao bubbles are limited to ~400 characters
- No filler phrases (예를 들어, 그리고 사실은 등 불필요한 표현 제거)
- Empathetic but efficient — acknowledge the issue, then provide the solution

Service rules (non-negotiable — never contradict these):
- No top-offs or extensions on existing slots
- A new Google Family invite is required after expiry
- 6-month plan: ₩25,000 | 12-month plan: ₩50,000
- Payment via IBK bank transfer only
- If a user asks about extending, the only correct path is a new subscription

When context is provided (conversation history, user profile, intent labels), use it to tailor your response.
When context is absent, ask the operator what the customer situation is.`;

// ── PII scrubbing ─────────────────────────────────────────────────────────────

const PASS_1: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /\d{3,6}-\d{2,6}-\d{4,10}/g, replacement: "[ACCOUNT]" },
  { regex: /01[016789]-?\d{3,4}-?\d{4}/g, replacement: "[PHONE]" },
  { regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { regex: /\d{6}-[1-4]\d{6}/g, replacement: "[RRN]" },
];

const PASS_2: Array<{
  triggers: string[];
  regex: RegExp;
  replacement: string;
}> = [
  {
    triggers: ["계좌", "입금", "국민은행", "기업은행", "신한", "카카오뱅크"],
    // 8+ consecutive digits, possibly separated by spaces or dashes
    regex: /\d[\d\s\-]{7,}\d/g,
    replacement: "[ACCOUNT]",
  },
  {
    triggers: ["전화", "연락처", "번호"],
    // 10–11 digit sequence (spaces/dots tolerated by pass 2 intent)
    regex: /\d[\d.\s]{8,10}\d/g,
    replacement: "[PHONE]",
  },
];

export function scrubContext(text: string): string {
  let result = text;
  for (const { regex, replacement } of PASS_1) {
    result = result.replace(regex, replacement);
  }
  for (const { triggers, regex, replacement } of PASS_2) {
    if (triggers.some((t) => result.includes(t))) {
      result = result.replace(regex, replacement);
    }
  }
  return result;
}

// ── Runtime (lazy-initialized) ────────────────────────────────────────────────

type CopilotHandler = (req: any, res: any) => Promise<void>;

let _handler: CopilotHandler | null = null;

export function getCopilotHandler(): CopilotHandler {
  if (_handler) return _handler;

  if (!ENV.OPENAI_API_KEY) {
    throw new Error("[CopilotCoach] OPENAI_API_KEY is required but not set");
  }

  const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
  const serviceAdapter = new OpenAIAdapter({ openai, model: "gpt-4o" });
  const runtime = new CopilotRuntime();

  _handler = copilotRuntimeNodeExpressEndpoint({
    endpoint: "/api/copilotkit",
    runtime,
    serviceAdapter,
  }) as CopilotHandler;

  return _handler;
}
