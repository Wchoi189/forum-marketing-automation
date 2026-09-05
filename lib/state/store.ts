/**
 * lib/state/store.ts
 *
 * Unified reactive runtime state store.
 * Single authoritative in-memory store with debounced disk persistence,
 * eliminating optimistic concurrency clobbering across observer, publisher,
 * and scheduler subsystems.
 */

import { ENV } from '../../config/env.js';
import { clampInt } from '../utils.js';
import {
  type ObserverControls,
  type PublisherControls,
  type SchedulerControls,
  type StateMeta,
  StateVersionConflictError
} from './types.js';
import {
  type PersistedStateFile,
  readPersistedState,
  writeFileAtomic,
} from './persistence.js';
import { DEFAULT_SCHEDULER_CONTROLS } from './scheduler.js';

export type StateListener = (state: Readonly<RuntimeState>, patch: Partial<PersistedStateFile>) => void;

export type RuntimeState = {
  stateVersion: number;
  persistedAt: string | null;

  // Observer
  observerEnabled: boolean;
  observerMinPreVisitDelayMs: number;
  observerMaxPreVisitDelayMs: number;
  observerMinIntervalBetweenRunsMs: number;
  observerGapThresholdMin: number | null;
  gapSourcePin?: 'env' | 'spec';

  // Publisher
  publisherDraftItemIndex: number;
  publishBlockedUntil: string | null;
  maintenanceBlockedUntil: string | null;

  // Scheduler
  schedulerEnabled: boolean;
  schedulerBaseIntervalMinutes: number;
  schedulerQuietHoursStart: number;
  schedulerQuietHoursEnd: number;
  schedulerQuietHoursMultiplier: number;
  schedulerActiveHoursStart: number;
  schedulerActiveHoursEnd: number;
  schedulerActiveHoursMultiplier: number;
  schedulerTrendAdaptiveEnabled: boolean;
  schedulerTrendWindowDays: number;
  schedulerTrendRecalibrationDays: number;
  schedulerJitterPercent: number;
  schedulerJitterMode: 'uniform' | 'none';
  schedulerTargetPublishIntervalMinutes: number;
  schedulerGapRecheckIntervalMinutes: number;
  preset: string;

  // NL Webhook & Additional Config
  nlWebhookEnabled: boolean;
  customParserEnabled?: boolean;
  browserRequestLogging?: boolean;
  logLevel?: string;
  parserDetailedLogging?: boolean;
};

export class RuntimeStateStore {
  private state: RuntimeState;
  private listeners: Set<StateListener> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;
  private isPersisting = false;
  private pendingPersistPromise: Promise<StateMeta> | null = null;
  private hasPendingDiskFlush = false;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(debounceMs: number = 50) {
    this.debounceMs = debounceMs;
    this.state = this.createDefaultState();
  }

  private createDefaultState(): RuntimeState {
    return {
      stateVersion: 0,
      persistedAt: null,

      observerEnabled: true,
      observerMinPreVisitDelayMs: 1500,
      observerMaxPreVisitDelayMs: 4000,
      observerMinIntervalBetweenRunsMs: 0,
      observerGapThresholdMin: null,
      gapSourcePin: undefined,

      publisherDraftItemIndex: Math.max(1, Math.min(50, Math.floor(ENV.PUBLISHER_DRAFT_ITEM_INDEX ?? 1))),
      publishBlockedUntil: null,
      maintenanceBlockedUntil: null,

      schedulerEnabled: DEFAULT_SCHEDULER_CONTROLS.enabled,
      schedulerBaseIntervalMinutes: DEFAULT_SCHEDULER_CONTROLS.baseIntervalMinutes,
      schedulerQuietHoursStart: DEFAULT_SCHEDULER_CONTROLS.quietHoursStart,
      schedulerQuietHoursEnd: DEFAULT_SCHEDULER_CONTROLS.quietHoursEnd,
      schedulerQuietHoursMultiplier: DEFAULT_SCHEDULER_CONTROLS.quietHoursMultiplier,
      schedulerActiveHoursStart: DEFAULT_SCHEDULER_CONTROLS.activeHoursStart,
      schedulerActiveHoursEnd: DEFAULT_SCHEDULER_CONTROLS.activeHoursEnd,
      schedulerActiveHoursMultiplier: DEFAULT_SCHEDULER_CONTROLS.activeHoursMultiplier,
      schedulerTrendAdaptiveEnabled: DEFAULT_SCHEDULER_CONTROLS.trendAdaptiveEnabled,
      schedulerTrendWindowDays: DEFAULT_SCHEDULER_CONTROLS.trendWindowDays,
      schedulerTrendRecalibrationDays: DEFAULT_SCHEDULER_CONTROLS.trendRecalibrationDays,
      schedulerJitterPercent: DEFAULT_SCHEDULER_CONTROLS.scheduleJitterPercent,
      schedulerJitterMode: DEFAULT_SCHEDULER_CONTROLS.scheduleJitterMode,
      schedulerTargetPublishIntervalMinutes: DEFAULT_SCHEDULER_CONTROLS.targetPublishIntervalMinutes,
      schedulerGapRecheckIntervalMinutes: DEFAULT_SCHEDULER_CONTROLS.gapRecheckIntervalMinutes,
      preset: DEFAULT_SCHEDULER_CONTROLS.preset,

      nlWebhookEnabled: true,
    };
  }

  /** Load persisted state from disk and hydrate in-memory state. */
  async init(): Promise<void> {
    const persisted = await readPersistedState();
    if (typeof persisted.stateVersion === 'number' && persisted.stateVersion >= 0) {
      this.state.stateVersion = persisted.stateVersion;
    }
    if (typeof persisted.persistedAt === 'string') {
      this.state.persistedAt = persisted.persistedAt;
    }
    this.applyPatchInMemory(persisted);
    this.initialized = true;
  }

  /** Ensure store has loaded from disk if not yet initialized. */
  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
  }

  /** Subscribe to state change notifications. */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Return a snapshot of current in-memory state. */
  getState(): Readonly<RuntimeState> {
    return { ...this.state };
  }

  /** Return state version metadata. */
  getStateMeta(): StateMeta {
    return {
      stateVersion: this.state.stateVersion,
      persistedAt: this.state.persistedAt,
    };
  }

  // ── Subsystem Getters ───────────────────────────────────────────────────────

  getObserverControls(): ObserverControls {
    return {
      enabled: this.state.observerEnabled,
      minPreVisitDelayMs: this.state.observerMinPreVisitDelayMs,
      maxPreVisitDelayMs: this.state.observerMaxPreVisitDelayMs,
      minIntervalBetweenRunsMs: this.state.observerMinIntervalBetweenRunsMs,
    };
  }

  getPublisherControls(): PublisherControls {
    return {
      draftItemIndex: this.state.publisherDraftItemIndex,
      publishBlockedUntil: this.state.publishBlockedUntil,
      maintenanceBlockedUntil: this.state.maintenanceBlockedUntil,
    };
  }

  getSchedulerControls(): SchedulerControls {
    return {
      enabled: this.state.schedulerEnabled,
      baseIntervalMinutes: this.state.schedulerBaseIntervalMinutes,
      quietHoursStart: this.state.schedulerQuietHoursStart,
      quietHoursEnd: this.state.schedulerQuietHoursEnd,
      quietHoursMultiplier: this.state.schedulerQuietHoursMultiplier,
      activeHoursStart: this.state.schedulerActiveHoursStart,
      activeHoursEnd: this.state.schedulerActiveHoursEnd,
      activeHoursMultiplier: this.state.schedulerActiveHoursMultiplier,
      trendAdaptiveEnabled: this.state.schedulerTrendAdaptiveEnabled,
      trendWindowDays: this.state.schedulerTrendWindowDays,
      trendRecalibrationDays: this.state.schedulerTrendRecalibrationDays,
      scheduleJitterPercent: this.state.schedulerJitterPercent,
      scheduleJitterMode: this.state.schedulerJitterMode,
      targetPublishIntervalMinutes: this.state.schedulerTargetPublishIntervalMinutes,
      gapRecheckIntervalMinutes: this.state.schedulerGapRecheckIntervalMinutes,
      preset: this.state.preset,
    };
  }

  getGapPersistedOverride(): number | null {
    return this.state.observerGapThresholdMin;
  }

  getGapSourcePin(): 'env' | 'spec' | null {
    return this.state.gapSourcePin ?? null;
  }

  getNlWebhookEnabled(): boolean {
    return this.state.nlWebhookEnabled;
  }

  // ── In-Memory Fast Setters ──────────────────────────────────────────────────

  setObserverControlsInMemory(next: Partial<ObserverControls>): ObserverControls {
    if (typeof next.enabled === 'boolean') {
      this.state.observerEnabled = next.enabled;
    }
    const minDelay = clampInt(next.minPreVisitDelayMs, this.state.observerMinPreVisitDelayMs, 0, 120000);
    const maxDelay = clampInt(next.maxPreVisitDelayMs, this.state.observerMaxPreVisitDelayMs, 0, 120000);
    this.state.observerMinPreVisitDelayMs = Math.min(minDelay, maxDelay);
    this.state.observerMaxPreVisitDelayMs = Math.max(minDelay, maxDelay);
    this.state.observerMinIntervalBetweenRunsMs = clampInt(
      next.minIntervalBetweenRunsMs,
      this.state.observerMinIntervalBetweenRunsMs,
      0,
      3600000
    );
    return this.getObserverControls();
  }

  setPublisherControlsInMemory(next: Partial<PublisherControls>): PublisherControls {
    this.state.publisherDraftItemIndex = clampInt(
      next.draftItemIndex,
      this.state.publisherDraftItemIndex,
      1,
      50
    );
    if (typeof next.publishBlockedUntil === 'string' || next.publishBlockedUntil === null) {
      this.state.publishBlockedUntil = next.publishBlockedUntil;
    }
    if (typeof next.maintenanceBlockedUntil === 'string' || next.maintenanceBlockedUntil === null) {
      this.state.maintenanceBlockedUntil = next.maintenanceBlockedUntil;
    }
    return this.getPublisherControls();
  }

  // ── Mutators with Optimistic Concurrency ───────────────────────────────────

  patch(patch: Partial<PersistedStateFile>, expectedVersion?: number): StateMeta {
    if (expectedVersion !== undefined && expectedVersion !== this.state.stateVersion) {
      throw new StateVersionConflictError(expectedVersion, this.state.stateVersion);
    }

    this.applyPatchInMemory(patch);
    this.state.stateVersion += 1;
    this.state.persistedAt = new Date().toISOString();

    const meta: StateMeta = {
      stateVersion: this.state.stateVersion,
      persistedAt: this.state.persistedAt,
    };

    for (const listener of this.listeners) {
      try {
        listener(this.getState(), patch);
      } catch {
        // Suppress listener errors
      }
    }

    this.schedulePersistence();
    return meta;
  }

  private applyPatchInMemory(patch: Partial<PersistedStateFile>): void {
    if (typeof patch.observerEnabled === 'boolean') {
      this.state.observerEnabled = patch.observerEnabled;
    }
    if (patch.observerMinPreVisitDelayMs !== undefined || patch.observerMaxPreVisitDelayMs !== undefined) {
      const minDelay = clampInt(patch.observerMinPreVisitDelayMs, this.state.observerMinPreVisitDelayMs, 0, 120000);
      const maxDelay = clampInt(patch.observerMaxPreVisitDelayMs, this.state.observerMaxPreVisitDelayMs, 0, 120000);
      this.state.observerMinPreVisitDelayMs = Math.min(minDelay, maxDelay);
      this.state.observerMaxPreVisitDelayMs = Math.max(minDelay, maxDelay);
    }
    if (patch.observerMinIntervalBetweenRunsMs !== undefined) {
      this.state.observerMinIntervalBetweenRunsMs = clampInt(
        patch.observerMinIntervalBetweenRunsMs,
        this.state.observerMinIntervalBetweenRunsMs,
        0,
        3600000
      );
    }
    if ('observerGapThresholdMin' in patch) {
      const v = patch.observerGapThresholdMin;
      this.state.observerGapThresholdMin = (typeof v === 'number' && Number.isFinite(v))
        ? Math.max(1, Math.min(50, Math.round(v)))
        : null;
    }
    if ('gapSourcePin' in patch) {
      this.state.gapSourcePin = patch.gapSourcePin ?? undefined;
    }
    if (patch.publisherDraftItemIndex !== undefined) {
      this.state.publisherDraftItemIndex = clampInt(patch.publisherDraftItemIndex, this.state.publisherDraftItemIndex, 1, 50);
    }
    if ('publishBlockedUntil' in patch) {
      this.state.publishBlockedUntil = patch.publishBlockedUntil ?? null;
    }
    if ('maintenanceBlockedUntil' in patch) {
      this.state.maintenanceBlockedUntil = patch.maintenanceBlockedUntil ?? null;
    }
    if (typeof patch.schedulerEnabled === 'boolean') {
      this.state.schedulerEnabled = patch.schedulerEnabled;
    }
    if (typeof patch.schedulerBaseIntervalMinutes === 'number') {
      this.state.schedulerBaseIntervalMinutes = Math.max(1, Math.min(1440, patch.schedulerBaseIntervalMinutes));
    }
    if (typeof patch.schedulerQuietHoursStart === 'number') {
      this.state.schedulerQuietHoursStart = Math.max(0, Math.min(23, patch.schedulerQuietHoursStart));
    }
    if (typeof patch.schedulerQuietHoursEnd === 'number') {
      this.state.schedulerQuietHoursEnd = Math.max(0, Math.min(23, patch.schedulerQuietHoursEnd));
    }
    if (typeof patch.schedulerQuietHoursMultiplier === 'number') {
      this.state.schedulerQuietHoursMultiplier = Math.max(0.2, Math.min(5, patch.schedulerQuietHoursMultiplier));
    }
    if (typeof patch.schedulerActiveHoursStart === 'number') {
      this.state.schedulerActiveHoursStart = Math.max(0, Math.min(23, patch.schedulerActiveHoursStart));
    }
    if (typeof patch.schedulerActiveHoursEnd === 'number') {
      this.state.schedulerActiveHoursEnd = Math.max(0, Math.min(23, patch.schedulerActiveHoursEnd));
    }
    if (typeof patch.schedulerActiveHoursMultiplier === 'number') {
      this.state.schedulerActiveHoursMultiplier = Math.max(0.2, Math.min(5, patch.schedulerActiveHoursMultiplier));
    }
    if (typeof patch.schedulerTrendAdaptiveEnabled === 'boolean') {
      this.state.schedulerTrendAdaptiveEnabled = patch.schedulerTrendAdaptiveEnabled;
    }
    if (typeof patch.schedulerTrendWindowDays === 'number') {
      this.state.schedulerTrendWindowDays = Math.max(1, Math.min(60, patch.schedulerTrendWindowDays));
    }
    if (typeof patch.schedulerTrendRecalibrationDays === 'number') {
      this.state.schedulerTrendRecalibrationDays = Math.max(1, Math.min(30, patch.schedulerTrendRecalibrationDays));
    }
    if (typeof patch.schedulerJitterPercent === 'number') {
      this.state.schedulerJitterPercent = Math.max(0, Math.min(50, patch.schedulerJitterPercent));
    }
    if (typeof patch.schedulerJitterMode === 'string') {
      this.state.schedulerJitterMode = patch.schedulerJitterMode === 'none' ? 'none' : 'uniform';
    }
    if (typeof patch.schedulerTargetPublishIntervalMinutes === 'number') {
      this.state.schedulerTargetPublishIntervalMinutes = Math.max(0, Math.min(1440, patch.schedulerTargetPublishIntervalMinutes));
    }
    if (typeof patch.schedulerGapRecheckIntervalMinutes === 'number') {
      this.state.schedulerGapRecheckIntervalMinutes = Math.max(1, Math.min(60, patch.schedulerGapRecheckIntervalMinutes));
    }
    if (typeof patch.preset === 'string') {
      this.state.preset = patch.preset;
    }
    if (typeof patch.nlWebhookEnabled === 'boolean') {
      this.state.nlWebhookEnabled = patch.nlWebhookEnabled;
    }
    if ('customParserEnabled' in patch) this.state.customParserEnabled = patch.customParserEnabled;
    if ('browserRequestLogging' in patch) this.state.browserRequestLogging = patch.browserRequestLogging;
    if ('logLevel' in patch) this.state.logLevel = patch.logLevel;
    if ('parserDetailedLogging' in patch) this.state.parserDetailedLogging = patch.parserDetailedLogging;
  }

  // ── Persistence & Debounce ─────────────────────────────────────────────────

  private schedulePersistence(): void {
    this.hasPendingDiskFlush = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushToDisk();
    }, this.debounceMs);
  }

  /** Flush in-memory state to disk immediately. */
  async flush(): Promise<StateMeta> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.flushToDisk();
  }

  private async flushToDisk(): Promise<StateMeta> {
    if (this.isPersisting && this.pendingPersistPromise) {
      return this.pendingPersistPromise;
    }

    this.isPersisting = true;
    this.hasPendingDiskFlush = false;

    const filePayload: PersistedStateFile = {
      ...this.state,
      observerGapThresholdMin: this.state.observerGapThresholdMin ?? undefined,
      gapSourcePin: this.state.gapSourcePin,
      publishBlockedUntil: this.state.publishBlockedUntil,
      maintenanceBlockedUntil: this.state.maintenanceBlockedUntil,
    };

    this.pendingPersistPromise = writeFileAtomic(filePayload)
      .then(() => {
        this.isPersisting = false;
        this.pendingPersistPromise = null;
        if (this.hasPendingDiskFlush) {
          return this.flushToDisk();
        }
        return {
          stateVersion: this.state.stateVersion,
          persistedAt: this.state.persistedAt,
        };
      })
      .catch((err) => {
        this.isPersisting = false;
        this.pendingPersistPromise = null;
        throw err;
      });

    return this.pendingPersistPromise;
  }
}

// ── Global Singleton ──────────────────────────────────────────────────────────

let sharedStore: RuntimeStateStore | null = null;

export function getRuntimeStateStore(): RuntimeStateStore {
  if (!sharedStore) {
    sharedStore = new RuntimeStateStore();
  }
  return sharedStore;
}

export async function initRuntimeStateStore(): Promise<RuntimeStateStore> {
  const store = getRuntimeStateStore();
  await store.init();
  return store;
}
