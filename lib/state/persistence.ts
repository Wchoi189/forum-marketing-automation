/**
 * lib/state/persistence.ts
 *
 * Core persistence layer for runtime state.
 * Handles atomic file writes and optimistic concurrency control.
 */

import fs from 'fs/promises';
import path from 'path';
import { ENV } from '../../config/env.js';
import { StateVersionConflictError } from './types.js';
import { getRuntimeStateStore } from './store.js';

const REL_PATH = 'runtime-controls.json';
let writeQueue: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw file format for persisted state.
 * All fields optional - only written when set.
 */
export type PersistedStateFile = {
  stateVersion?: number;
  persistedAt?: string | null;

  // Gap threshold
  observerGapThresholdMin?: number | null;
  gapSourcePin?: 'env' | 'spec';

  // NL Webhook
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

  // Observer
  observerEnabled?: boolean;
  observerMinPreVisitDelayMs?: number;
  observerMaxPreVisitDelayMs?: number;
  observerMinIntervalBetweenRunsMs?: number;

  // Publisher
  publisherDraftItemIndex?: number;
  publishBlockedUntil?: string | null;
  maintenanceBlockedUntil?: string | null;

  // Additional config
  customParserEnabled?: boolean;
  browserRequestLogging?: boolean;
  logLevel?: string;
  parserDetailedLogging?: boolean;
};

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

function filePath(): string {
  return path.join(ENV.ARTIFACTS_DIR, REL_PATH);
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(operation, operation);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function writeFileAtomic(next: PersistedStateFile): Promise<void> {
  return enqueueWrite(async () => {
    const fp = filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(next, null, 2);
    try {
      await fs.writeFile(tmp, serialized, 'utf-8');
      const handle = await fs.open(tmp, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, fp);
    } catch (err) {
      // Never leave the temp file behind — a failed write used to leak one per
      // attempt, and nothing cleaned them up.
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  });
}

function normalizeStateVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

function normalizePersistedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the full persisted state file.
 * Returns empty object if missing or invalid.
 */
export async function readPersistedState(): Promise<PersistedStateFile> {
  try {
    const raw = await fs.readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PersistedStateFile;
  } catch {
    return {};
  }
}

/**
 * Read state version metadata from store authority.
 */
export async function readStateMeta(): Promise<{ stateVersion: number; persistedAt: string | null }> {
  const store = getRuntimeStateStore();
  await store.ensureInitialized();
  return store.getStateMeta();
}

/**
 * Persist state patch atomically with optimistic concurrency via the authoritative store.
 */
export async function persistState(
  patch: Partial<PersistedStateFile>,
  expectedVersion?: number
): Promise<{ stateVersion: number; persistedAt: string | null }> {
  const store = getRuntimeStateStore();
  await store.ensureInitialized();
  const meta = store.patch(patch, expectedVersion);
  await store.flush();
  return meta;
}

// Re-export for convenience
export { StateVersionConflictError };