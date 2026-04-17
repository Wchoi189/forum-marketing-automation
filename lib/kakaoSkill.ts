import fs from "fs";
import path from "path";
import { ENV } from "../config/env.js";
import { logger } from "./logger.js";

// ── Kakao Open Builder 2.0 payload types ──────────────────────────────────────

export type KakaoUser = {
  id: string;
  type: string;
  properties: Record<string, unknown>;
};

export type KakaoBlock = {
  id: string;
  name: string;
};

export type KakaoUserRequest = {
  timezone: string;
  params: Record<string, unknown>;
  block: KakaoBlock;
  utterance: string;
  lang: string | null;
  user: KakaoUser;
};

export type KakaoIntent = {
  id: string;
  name: string;
};

export type KakaoBot = {
  id: string;
  name: string;
};

export type KakaoAction = {
  name: string;
  clientExtra: unknown;
  params: Record<string, unknown>;
  id: string;
  detailParams: Record<string, unknown>;
};

export type KakaoSkillPayload = {
  intent: KakaoIntent;
  userRequest: KakaoUserRequest;
  bot: KakaoBot;
  action: KakaoAction;
};

// ── JSONL history entry ────────────────────────────────────────────────────────

export type KakaoMessageEntry = {
  id: string;
  ts: string;
  source: "live";
  speaker: "user";
  user_id: string;
  text: string;
  block_id: string;
  block_name: string;
  intent_id: string;
  intent_name: string;
  bot_id: string;
  raw: KakaoSkillPayload;
};

// ── JSONL logger ───────────────────────────────────────────────────────────────

const HISTORY_REL_DIR = path.join("artifacts", "kakao-history");

function todayLogPath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = path.join(ENV.PROJECT_ROOT, HISTORY_REL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${date}.jsonl`);
}

export function logKakaoMessage(payload: KakaoSkillPayload): KakaoMessageEntry {
  const entry: KakaoMessageEntry = {
    id: `${payload.userRequest.user.id}-${Date.now()}`,
    ts: new Date().toISOString(),
    source: "live",
    speaker: "user",
    user_id: payload.userRequest.user.id,
    text: payload.userRequest.utterance,
    block_id: payload.userRequest.block.id,
    block_name: payload.userRequest.block.name,
    intent_id: payload.intent.id,
    intent_name: payload.intent.name,
    bot_id: payload.bot.id,
    raw: payload,
  };

  try {
    fs.appendFileSync(todayLogPath(), JSON.stringify(entry) + "\n", "utf-8");
    logger.info(
      { event: "kakao_message_logged", user_id: entry.user_id, text: entry.text },
      "[Kakao] Message logged"
    );
  } catch (err) {
    logger.error({ event: "kakao_message_log_failed", err }, "[Kakao] Failed to write message log");
  }

  return entry;
}

// ── Response builder ───────────────────────────────────────────────────────────

export type KakaoResponse = {
  version: "2.0";
  template: { outputs: Array<{ simpleText: { text: string } }> };
};

export function simpleTextResponse(text: string): KakaoResponse {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text } }] },
  };
}

// ── Payload validator ──────────────────────────────────────────────────────────

export function isValidKakaoPayload(body: unknown): body is KakaoSkillPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const ur = b.userRequest as Record<string, unknown> | undefined;
  const bot = b.bot as Record<string, unknown> | undefined;
  const intent = b.intent as Record<string, unknown> | undefined;
  return (
    typeof ur?.utterance === "string" &&
    typeof ur?.user === "object" && ur.user !== null &&
    typeof (ur.user as Record<string, unknown>).id === "string" &&
    typeof ur?.block === "object" && ur.block !== null &&
    typeof bot?.id === "string" &&
    typeof intent?.id === "string"
  );
}
