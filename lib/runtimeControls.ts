import fs from "fs/promises";
import path from "path";
import { ENV } from "../config/env.js";

const REL_PATH = path.join("artifacts", "runtime-controls.json");
let runtimeControlsWriteQueue: Promise<void> = Promise.resolve();

export type RuntimeControlsStateMeta = {
  stateVersion: number;
  persistedAt: string | null;
};

export class RuntimeControlsVersionConflictError extends Error {
  readonly code = "RUNTIME_CONTROLS_VERSION_CONFLICT";
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(expectedVersion: number, currentVersion: number) {
    super(`Expected runtime controls version ${expectedVersion}, found ${currentVersion}`);
    this.name = "RuntimeControlsVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

function filePath(): string {
  return path.join(ENV.PROJECT_ROOT, REL_PATH);
}

function enqueueRuntimeControlsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = runtimeControlsWriteQueue.then(operation, operation);
  runtimeControlsWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function writeRuntimeControlsFileAtomic(next: RuntimeControlsFile): Promise<void> {
  const fp = filePath();
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(next, null, 2);
  await fs.writeFile(tmp, serialized, "utf-8");
  const handle = await fs.open(tmp, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, fp);
}

function normalizeStateVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

function normalizePersistedAt(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

async function mutateRuntimeControls(
  mutator: (existing: RuntimeControlsFile) => RuntimeControlsFile,
  opts: { expectedVersion?: number } = {}
): Promise<RuntimeControlsStateMeta> {
  return enqueueRuntimeControlsWrite(async () => {
    const existing = await readRuntimeControls();
    const currentVersion = normalizeStateVersion(existing.stateVersion);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
      throw new RuntimeControlsVersionConflictError(opts.expectedVersion, currentVersion);
    }
    const mutated = mutator(existing);
    const nextMeta: RuntimeControlsStateMeta = {
      stateVersion: currentVersion + 1,
      persistedAt: new Date().toISOString(),
    };
    const next: RuntimeControlsFile = {
      ...mutated,
      stateVersion: nextMeta.stateVersion,
      persistedAt: nextMeta.persistedAt,
    };
    await writeRuntimeControlsFileAtomic(next);
    return nextMeta;
  });
}

export type RuntimeControlsFile = {
  /** Monotonic state version for optimistic concurrency on control mutations. */
  stateVersion?: number;
  /** Last successful atomic persistence timestamp (UTC ISO string). */
  persistedAt?: string | null;

  /** Persisted minimum gap (posts). Omitted or null = no runtime file override (use env/spec chain). */
  observerGapThresholdMin?: number | null;
  /**
   * Explicit source pin for gap threshold resolution.
   * 'env'  = always use env var (skip file override even if set).
   * 'spec' = always use spec baseline (skip both file override and env var).
   * Absent/undefined = default precedence: file → env → spec.
   */
  gapSourcePin?: 'env' | 'spec';

  // NL Webhook kill-switch (persisted so it survives server restarts)
  nlWebhookEnabled?: boolean;

  // Scheduler
  schedulerEnabled?: boolean;
  schedulerBaseIntervalMinutes?: number;
  schedulerQuietHoursStart?: number;
  schedulerQuietHoursEnd?: number;
  schedulerQuietHoursMultiplier?: number;
  schedulerActiveHoursStart?: number;
  schedulerActiveHoursEnd?: number;
  schedulerActiveHoursMultiplier?: number;
  schedulerTrendAdaptiveEnabled?: boolean;
  schedulerTrendWindowDays?: number;
  schedulerTrendRecalibrationDays?: number;
  schedulerJitterPercent?: number;
  schedulerJitterMode?: string;
  schedulerTargetPublishIntervalMinutes?: number;
  schedulerGapRecheckIntervalMinutes?: number;
  preset?: string;

  // Observer pacing
  observerEnabled?: boolean;
  observerMinPreVisitDelayMs?: number;
  observerMaxPreVisitDelayMs?: number;
  observerMinIntervalBetweenRunsMs?: number;

  // Publisher
  publisherDraftItemIndex?: number;

  // Additional runtime configuration overrides
  customParserEnabled?: boolean;
  browserRequestLogging?: boolean;
  logLevel?: string;
  parserDetailedLogging?: boolean;
};

function clampGap(n: number): number {
  return Math.max(1, Math.min(50, Math.round(n)));
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Number(n.toFixed(2))));
}

/**
 * Read the full runtime controls file. Returns an empty object if missing or invalid.
 */
export async function readRuntimeControls(): Promise<RuntimeControlsFile> {
  try {
    const raw = await fs.readFile(filePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as RuntimeControlsFile;
  } catch {
    return {};
  }
}

export async function readRuntimeControlsStateMeta(): Promise<RuntimeControlsStateMeta> {
  const data = await readRuntimeControls();
  return {
    stateVersion: normalizeStateVersion(data.stateVersion),
    persistedAt: normalizePersistedAt(data.persistedAt),
  };
}

/**
 * Write (merge) fields into the runtime controls file, preserving existing keys.
 */
export async function writeRuntimeControls(patch: Partial<RuntimeControlsFile>): Promise<RuntimeControlsStateMeta> {
  return mutateRuntimeControls((existing) => ({ ...existing, ...patch }));
}

/**
 * Returns persisted gap override from disk, or null if none / invalid.
 */
export async function readRuntimeGapPersistedOverride(): Promise<number | null> {
  const data = await readRuntimeControls();
  const v = data.observerGapThresholdMin;
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return clampGap(v);
}

/**
 * Persist or clear gap override. null removes the key so env/spec chain applies.
 */
export async function writeRuntimeGapPersistedOverride(value: number | null): Promise<RuntimeControlsStateMeta> {
  return mutateRuntimeControls((existing) => {
    const next: RuntimeControlsFile = { ...existing };
    if (value === null) {
      delete next.observerGapThresholdMin;
    } else {
      next.observerGapThresholdMin = clampGap(value);
    }
    return next;
  });
}

export type PersistedSchedulerControls = {
  enabled: boolean;
  baseIntervalMinutes: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  quietHoursMultiplier: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  activeHoursMultiplier: number;
  trendAdaptiveEnabled: boolean;
  trendWindowDays: number;
  trendRecalibrationDays: number;
  scheduleJitterPercent: number;
  scheduleJitterMode: "uniform" | "none";
  targetPublishIntervalMinutes: number;
  gapRecheckIntervalMinutes: number;
  preset: string;
};

export type PersistedObserverControls = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
};

export type PersistedPublisherControls = {
  draftItemIndex: number;
};

/**
 * Read persisted scheduler controls. Returns null if nothing is persisted.
 */
export async function readPersistedSchedulerControls(): Promise<Partial<PersistedSchedulerControls>> {
  const data = await readRuntimeControls();
  const result: Partial<PersistedSchedulerControls> = {};
  if (typeof data.schedulerEnabled === "boolean") result.enabled = data.schedulerEnabled;
  if (typeof data.schedulerBaseIntervalMinutes === "number") result.baseIntervalMinutes = clampInt(data.schedulerBaseIntervalMinutes, 1, 1440);
  if (typeof data.schedulerQuietHoursStart === "number") result.quietHoursStart = clampInt(data.schedulerQuietHoursStart, 0, 23);
  if (typeof data.schedulerQuietHoursEnd === "number") result.quietHoursEnd = clampInt(data.schedulerQuietHoursEnd, 0, 23);
  if (typeof data.schedulerQuietHoursMultiplier === "number") result.quietHoursMultiplier = clampFloat(data.schedulerQuietHoursMultiplier, 0.2, 5);
  if (typeof data.schedulerActiveHoursStart === "number") result.activeHoursStart = clampInt(data.schedulerActiveHoursStart, 0, 23);
  if (typeof data.schedulerActiveHoursEnd === "number") result.activeHoursEnd = clampInt(data.schedulerActiveHoursEnd, 0, 23);
  if (typeof data.schedulerActiveHoursMultiplier === "number") result.activeHoursMultiplier = clampFloat(data.schedulerActiveHoursMultiplier, 0.2, 5);
  if (typeof data.schedulerTrendAdaptiveEnabled === "boolean") result.trendAdaptiveEnabled = data.schedulerTrendAdaptiveEnabled;
  if (typeof data.schedulerTrendWindowDays === "number") result.trendWindowDays = clampInt(data.schedulerTrendWindowDays, 1, 60);
  if (typeof data.schedulerTrendRecalibrationDays === "number") result.trendRecalibrationDays = clampInt(data.schedulerTrendRecalibrationDays, 1, 30);
  if (typeof data.schedulerJitterPercent === "number") result.scheduleJitterPercent = clampInt(data.schedulerJitterPercent, 0, 50);
  if (typeof data.schedulerJitterMode === "string") result.scheduleJitterMode = data.schedulerJitterMode === "none" ? "none" : "uniform";
  if (typeof data.schedulerTargetPublishIntervalMinutes === "number") result.targetPublishIntervalMinutes = clampInt(data.schedulerTargetPublishIntervalMinutes, 0, 1440);
  if (typeof data.schedulerGapRecheckIntervalMinutes === "number") result.gapRecheckIntervalMinutes = clampInt(data.schedulerGapRecheckIntervalMinutes, 1, 60);
  if (typeof data.preset === "string") result.preset = data.preset;
  return result;
}

/**
 * Read persisted observer controls. Returns empty object if nothing is persisted.
 */
export async function readPersistedObserverControls(): Promise<Partial<PersistedObserverControls>> {
  const data = await readRuntimeControls();
  const result: Partial<PersistedObserverControls> = {};
  if (typeof data.observerEnabled === "boolean") result.enabled = data.observerEnabled;
  if (typeof data.observerMinPreVisitDelayMs === "number") result.minPreVisitDelayMs = clampInt(data.observerMinPreVisitDelayMs, 0, 120000);
  if (typeof data.observerMaxPreVisitDelayMs === "number") result.maxPreVisitDelayMs = clampInt(data.observerMaxPreVisitDelayMs, 0, 120000);
  if (typeof data.observerMinIntervalBetweenRunsMs === "number") result.minIntervalBetweenRunsMs = clampInt(data.observerMinIntervalBetweenRunsMs, 0, 3600000);
  return result;
}

/**
 * Read persisted publisher controls. Returns empty object if nothing is persisted.
 */
export async function readPersistedPublisherControls(): Promise<Partial<PersistedPublisherControls>> {
  const data = await readRuntimeControls();
  const result: Partial<PersistedPublisherControls> = {};
  if (typeof data.publisherDraftItemIndex === "number") result.draftItemIndex = clampInt(data.publisherDraftItemIndex, 1, 50);
  return result;
}

/**
 * Read persisted NL webhook enabled flag. Returns null if not set (caller uses env var default).
 */
export async function readPersistedNlWebhookEnabled(): Promise<boolean | null> {
  const data = await readRuntimeControls();
  if (typeof data.nlWebhookEnabled === 'boolean') return data.nlWebhookEnabled;
  return null;
}

/**
 * Read persisted gap source pin. Returns null if not set (default precedence applies).
 */
export async function readPersistedGapSourcePin(): Promise<'env' | 'spec' | null> {
  const data = await readRuntimeControls();
  if (data.gapSourcePin === 'env' || data.gapSourcePin === 'spec') return data.gapSourcePin;
  return null;
}

/**
 * Persist all control panel settings to disk atomically.
 */
export async function persistAllControlPanelSettings(opts: {
  expectedVersion?: number;

  // Explicit override updates from API payload.
  // undefined = preserve existing value.
  gapPersistedOverride?: number | null;
  gapSourcePin?: 'env' | 'spec' | null;
  nlWebhookEnabled?: boolean;

  // Additional runtime configuration overrides
  customParserEnabled?: boolean;
  browserRequestLogging?: boolean;
  logLevel?: string;
  parserDetailedLogging?: boolean;

  schedulerEnabled: boolean;
  schedulerControls: {
    baseIntervalMinutes: number;
    quietHoursStart: number;
    quietHoursEnd: number;
    quietHoursMultiplier: number;
    activeHoursStart: number;
    activeHoursEnd: number;
    activeHoursMultiplier: number;
    trendAdaptiveEnabled: boolean;
    trendWindowDays: number;
    trendRecalibrationDays: number;
    scheduleJitterPercent: number;
    scheduleJitterMode: string;
    targetPublishIntervalMinutes: number;
    gapRecheckIntervalMinutes: number;
  };
  preset: string;
  observerControls: {
    enabled: boolean;
    minPreVisitDelayMs: number;
    maxPreVisitDelayMs: number;
    minIntervalBetweenRunsMs: number;
  };
  publisherControls: {
    draftItemIndex: number;
  };
}): Promise<RuntimeControlsStateMeta> {
  return mutateRuntimeControls(
    (existing) => {
      const next: RuntimeControlsFile = {
        ...existing,

        schedulerEnabled: opts.schedulerEnabled,
        schedulerBaseIntervalMinutes: opts.schedulerControls.baseIntervalMinutes,
        schedulerQuietHoursStart: opts.schedulerControls.quietHoursStart,
        schedulerQuietHoursEnd: opts.schedulerControls.quietHoursEnd,
        schedulerQuietHoursMultiplier: opts.schedulerControls.quietHoursMultiplier,
        schedulerActiveHoursStart: opts.schedulerControls.activeHoursStart,
        schedulerActiveHoursEnd: opts.schedulerControls.activeHoursEnd,
        schedulerActiveHoursMultiplier: opts.schedulerControls.activeHoursMultiplier,
        schedulerTrendAdaptiveEnabled: opts.schedulerControls.trendAdaptiveEnabled,
        schedulerTrendWindowDays: opts.schedulerControls.trendWindowDays,
        schedulerTrendRecalibrationDays: opts.schedulerControls.trendRecalibrationDays,
        schedulerJitterPercent: opts.schedulerControls.scheduleJitterPercent,
        schedulerJitterMode: opts.schedulerControls.scheduleJitterMode,
        schedulerTargetPublishIntervalMinutes: opts.schedulerControls.targetPublishIntervalMinutes,
        schedulerGapRecheckIntervalMinutes: opts.schedulerControls.gapRecheckIntervalMinutes,
        preset: opts.preset,

        observerEnabled: opts.observerControls.enabled,
        observerMinPreVisitDelayMs: opts.observerControls.minPreVisitDelayMs,
        observerMaxPreVisitDelayMs: opts.observerControls.maxPreVisitDelayMs,
        observerMinIntervalBetweenRunsMs: opts.observerControls.minIntervalBetweenRunsMs,

        publisherDraftItemIndex: opts.publisherControls.draftItemIndex,

        // Additional runtime configuration overrides
        customParserEnabled: opts.customParserEnabled,
        browserRequestLogging: opts.browserRequestLogging,
        logLevel: opts.logLevel,
        parserDetailedLogging: opts.parserDetailedLogging,
      };

      if (opts.gapPersistedOverride !== undefined) {
        if (opts.gapPersistedOverride === null) {
          delete next.observerGapThresholdMin;
        } else {
          next.observerGapThresholdMin = clampGap(opts.gapPersistedOverride);
        }
      }

      if (opts.gapSourcePin !== undefined) {
        if (opts.gapSourcePin === null) {
          delete next.gapSourcePin;
        } else {
          next.gapSourcePin = opts.gapSourcePin;
        }
      }

      if (opts.nlWebhookEnabled !== undefined) {
        next.nlWebhookEnabled = opts.nlWebhookEnabled;
      }

      return next;
    },
    { expectedVersion: opts.expectedVersion }
  );
}
