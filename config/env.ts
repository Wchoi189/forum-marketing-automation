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
  };
}

export const ENV = buildEnv();
