import path from "path";
import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  PROJECT_ROOT: string;
  FORUM_PRIMARY_ID: "ppomppu";
  PPOMPPU_USER_ID: string;
  PPOMPPU_USER_PW: string;
  BOT_PROFILE_DIR: string;
  ACTIVITY_LOG_PATH: string;
  OBSERVER_GAP_THRESHOLD: number;
  RUN_INTERVAL_MINUTES: number;
  MANUAL_OVERRIDE_ENABLED: boolean;
  DRY_RUN_MODE: boolean;
  BROWSER_HEADLESS: boolean;
  /** Desktop Chrome UA; reduces naive bot fingerprinting (override if the site still returns 403). */
  BROWSER_USER_AGENT: string;
  PORT: number;
  MCP_PARSER_HOST: string;
  MCP_PARSER_PORT: number;
  MCP_PARSER_HEADLESS: boolean;
  MCP_PARSER_NAV_TIMEOUT_MS: number;
  MCP_PARSER_MAX_STORED_SNAPSHOTS: number;
  /** Full-page PNGs under artifacts/publisher-runs/<timestamp>/ during runPublisher. */
  PUBLISHER_DEBUG_SCREENSHOTS: boolean;
  /** Playwright trace.zip (open with `npx playwright show-trace <path>`). */
  PUBLISHER_DEBUG_TRACE: boolean;
  /**
   * When tracing is enabled, percent of successful publisher runs that persist `trace.zip` (0–100).
   * Failures always persist the trace when `PUBLISHER_DEBUG_TRACE=true`. Use 100 to match legacy "trace every run" behavior.
   */
  PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT: number;
  /** Max wait after submit for redirect to board list/view URL (separate from generic bot waits). */
  PUBLISHER_POST_SUBMIT_WAIT_MS: number;
  /** Default ±% jitter for auto-publisher schedule interval (0–50). */
  SCHEDULER_JITTER_PERCENT: number;
  /** Default schedule jitter mode: none | uniform around effective interval. */
  SCHEDULER_JITTER_MODE: "none" | "uniform";
  /** Substring used to identify our posts in board snapshots (case-insensitive includes match). */
  OUR_AUTHOR_SUBSTRING: string;
  /** xAI API key for Grok 4 advisor. Null when absent — advisor silently disabled. */
  XAI_API_KEY: string | null;
  /** Kill-switch for AI advisor without removing the API key. */
  AI_ADVISOR_ENABLED: boolean;
  /** Per-call timeout in ms for Grok advisor. Advisor skips on timeout. */
  AI_ADVISOR_TIMEOUT_MS: number;
  /** Kill-switch for /api/nl-command endpoint. Returns 503 when false. */
  NL_WEBHOOK_ENABLED: boolean;
  /** If set, requests to /api/nl-command must include Authorization: Bearer <secret>. */
  NL_WEBHOOK_SECRET: string | null;
  /** Slack Webhook URL for outgoing notifications. Null when absent. */
  SLACK_WEBHOOK_URL: string | null;
  /** Kill-switch for /kakao-webhook endpoint. Returns 503 when false. */
  KAKAO_WEBHOOK_ENABLED: boolean;
  /** Kakao Open Builder bot ID. Used to validate incoming skill payloads. Null = no validation. */
  KAKAO_OPENBUILDER_BOT_ID: string | null;
  /** Kakao app Admin Key. Used for outbound channel API calls. */
  KAKAO_ADMIN_KEY: string | null;
  /** Kakao Open Builder skill secret. Reserved for future HMAC verification of inbound requests. */
  KAKAO_SKILL_SECRET: string | null;
  /** OpenAI API key for Kakao auto-reply (Phase 5). Null when absent — auto-reply silently disabled. */
  OPENAI_API_KEY: string | null;
  /** Kill-switch for LLM auto-reply on the Kakao webhook. Must be explicitly enabled by operator. */
  KAKAO_AUTOREPLY_ENABLED: boolean;
  /** Per-call timeout in ms for Kakao auto-reply. Falls back to neutral ACK on timeout. */
  KAKAO_AUTOREPLY_TIMEOUT_MS: number;
};

function requiredString(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[ENV] Missing required variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`[ENV] ${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`[ENV] ${name} must be "true" or "false"`);
}

/** Headed Chromium on Linux requires an X server ($DISPLAY). Otherwise Playwright exits with a confusing error. */
function coerceHeadlessForLinux(requestedHeadless: boolean, envVarName: string): boolean {
  if (requestedHeadless) return true;
  if (process.platform !== "linux") return false;
  if (process.env.DISPLAY?.trim()) return false;
  console.warn(
    `[ENV] ${envVarName}=false ignored on Linux with no DISPLAY; using headless Chromium. For headed mode use a display, set DISPLAY, or run the app under xvfb-run.`
  );
  return true;
}

function resolvePath(value: string, projectRoot: string): string {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
}

const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function optionalString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

function optionalStringOrNull(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function optionalJitterMode(name: string, fallback: "none" | "uniform"): "none" | "uniform" {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "none" || raw === "uniform") return raw;
  throw new Error(`[ENV] ${name} must be "none" or "uniform"`);
}

function buildEnv(): EnvConfig {
  const projectRoot = requiredString("PROJECT_ROOT");
  if (!path.isAbsolute(projectRoot)) {
    throw new Error("[ENV] PROJECT_ROOT must be an absolute path");
  }

  const forumPrimaryId = requiredString("FORUM_PRIMARY_ID");
  if (forumPrimaryId !== "ppomppu") {
    throw new Error('[ENV] FORUM_PRIMARY_ID currently supports only "ppomppu"');
  }

  const ppomppuUserId = requiredString("PPOMPPU_USER_ID");
  const ppomppuUserPw = requiredString("PPOMPPU_USER_PW");

  const botProfileDirRaw = requiredString("BOT_PROFILE_DIR");
  const activityLogPathRaw = requiredString("ACTIVITY_LOG_PATH");

  return {
    PROJECT_ROOT: projectRoot,
    FORUM_PRIMARY_ID: "ppomppu",
    PPOMPPU_USER_ID: ppomppuUserId,
    PPOMPPU_USER_PW: ppomppuUserPw,
    BOT_PROFILE_DIR: resolvePath(botProfileDirRaw, projectRoot),
    ACTIVITY_LOG_PATH: resolvePath(activityLogPathRaw, projectRoot),
    OBSERVER_GAP_THRESHOLD: optionalInt("OBSERVER_GAP_THRESHOLD", 5, 1, 50),
    RUN_INTERVAL_MINUTES: optionalInt("RUN_INTERVAL_MINUTES", 60, 5, 1440),
    MANUAL_OVERRIDE_ENABLED: optionalBool("MANUAL_OVERRIDE_ENABLED", true),
    DRY_RUN_MODE: optionalBool("DRY_RUN_MODE", true),
    BROWSER_HEADLESS: coerceHeadlessForLinux(optionalBool("BROWSER_HEADLESS", true), "BROWSER_HEADLESS"),
    BROWSER_USER_AGENT: optionalString("BROWSER_USER_AGENT", DEFAULT_BROWSER_USER_AGENT),
    PORT: optionalInt("PORT", 3000, 1, 65535),
    MCP_PARSER_HOST: process.env.MCP_PARSER_HOST?.trim() || "127.0.0.1",
    MCP_PARSER_PORT: optionalInt("MCP_PARSER_PORT", 3333, 1, 65535),
    MCP_PARSER_HEADLESS: coerceHeadlessForLinux(optionalBool("MCP_PARSER_HEADLESS", true), "MCP_PARSER_HEADLESS"),
    MCP_PARSER_NAV_TIMEOUT_MS: optionalInt("MCP_PARSER_NAV_TIMEOUT_MS", 45000, 5000, 120000),
    MCP_PARSER_MAX_STORED_SNAPSHOTS: optionalInt("MCP_PARSER_MAX_STORED_SNAPSHOTS", 200, 10, 1000),
    PUBLISHER_DEBUG_SCREENSHOTS: optionalBool("PUBLISHER_DEBUG_SCREENSHOTS", false),
    PUBLISHER_DEBUG_TRACE: optionalBool("PUBLISHER_DEBUG_TRACE", false),
    PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT: optionalInt("PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT", 0, 0, 100),
    PUBLISHER_POST_SUBMIT_WAIT_MS: optionalInt("PUBLISHER_POST_SUBMIT_WAIT_MS", 20000, 5000, 120000),
    SCHEDULER_JITTER_PERCENT: optionalInt("SCHEDULER_JITTER_PERCENT", 15, 0, 50),
    SCHEDULER_JITTER_MODE: optionalJitterMode("SCHEDULER_JITTER_MODE", "uniform"),
    OUR_AUTHOR_SUBSTRING: optionalString("OUR_AUTHOR_SUBSTRING", "shareplan"),
    XAI_API_KEY: optionalStringOrNull("XAI_API_KEY"),
    AI_ADVISOR_ENABLED: optionalBool("AI_ADVISOR_ENABLED", true),
    AI_ADVISOR_TIMEOUT_MS: optionalInt("AI_ADVISOR_TIMEOUT_MS", 8000, 1000, 30000),
    NL_WEBHOOK_ENABLED: optionalBool("NL_WEBHOOK_ENABLED", true),
    NL_WEBHOOK_SECRET: optionalStringOrNull("NL_WEBHOOK_SECRET"),
    SLACK_WEBHOOK_URL: optionalStringOrNull("SLACK_WEBHOOK_URL"),
    KAKAO_WEBHOOK_ENABLED: optionalBool("KAKAO_WEBHOOK_ENABLED", false),
    KAKAO_OPENBUILDER_BOT_ID: optionalStringOrNull("KAKAO_OPENBUILDER_BOT_ID"),
    KAKAO_ADMIN_KEY: optionalStringOrNull("KAKAO_ADMIN_KEY"),
    KAKAO_SKILL_SECRET: optionalStringOrNull("KAKAO_SKILL_SECRET"),
    OPENAI_API_KEY: optionalStringOrNull("OPENAI_API_KEY"),
    KAKAO_AUTOREPLY_ENABLED: optionalBool("KAKAO_AUTOREPLY_ENABLED", false),
    KAKAO_AUTOREPLY_TIMEOUT_MS: optionalInt("KAKAO_AUTOREPLY_TIMEOUT_MS", 2400, 500, 5000),
  };
}

export const ENV = buildEnv();
