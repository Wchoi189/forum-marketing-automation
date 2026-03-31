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
  PORT: number;
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

function resolvePath(value: string, projectRoot: string): string {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
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
    PORT: optionalInt("PORT", 3000, 1, 65535),
  };
}

export const ENV = buildEnv();
