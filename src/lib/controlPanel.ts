import type {
  ActivityLog,
  BoardStats,
  CompetitorStat,
  DraftItem,
  PublisherHistoryEntry,
  TrendInsights
} from '../../contracts/models';

export type {
  ActivityLog,
  BoardStats,
  CompetitorStat,
  DraftItem,
  PublisherHistoryEntry,
  TrendInsights
};

export type AiAdvisorOutput = {
  recommendedIntervalMinutes: number;
  recommendedGapThreshold: number;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
  signalsUsed: string[];
  generatedAt: string;
};

/** API errors may already include `[Observer]` / `[Publisher]`; strip one leading tag for readable banner text. */
export function stripTaggedErrorPrefix(text: string) {
  return text.replace(/^\[(Observer|Publisher)\]\s*/, '').trim();
}

export type ObserverControlState = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
  /** Effective minimum gap (posts) after persisted → env → spec precedence. */
  gapThresholdMin: number;
  /** File-persisted override; null = use env (if set) then spec baseline. */
  gapPersistedOverride: number | null;
  gapThresholdSpecBaseline: number;
  gapUsesEnvOverride: boolean;
  /** Which source is currently supplying the effective gap threshold. */
  gapSource: 'file' | 'env' | 'spec';
  /**
   * Explicit source pin chosen by the user.
   * 'env'  = always use env var.
   * 'spec' = always use spec baseline.
   * null   = default precedence (file → env → spec).
   */
  gapSourcePin: 'env' | 'spec' | null;
};

export type AutoPublisherControlState = {
  enabled: boolean;
  baseIntervalMinutes: number;
  effectiveIntervalMinutes: number;
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
  scheduleJitterMode: 'none' | 'uniform';
  /** 0 = disabled; blended with trend-based interval when > 0. */
  targetPublishIntervalMinutes: number;
  running: boolean;
  nextTickEta?: string | null;
};

export type PublisherControlState = {
  /** 1-based item in the saved-drafts table (preview rows between items are skipped automatically). */
  draftItemIndex: number;
};

export type ControlPanelState = {
  preset: 'balanced' | 'night-safe' | 'day-aggressive';
  observer: ObserverControlState;
  publisher: PublisherControlState;
  autoPublisher: AutoPublisherControlState;
  nlWebhookEnabled: boolean;
};

export function gapPolicySourceLabel(o: ObserverControlState): string {
  if (o.gapSource === 'file') return 'persisted file';
  if (o.gapSource === 'env') return 'env';
  return 'spec';
}

/** Keep pacing/scheduler numbers aligned with `server.ts` PRESET_CONFIG (observer + baseInterval math). */
export function applyRuntimePreset(preset: ControlPanelState['preset'], current: ControlPanelState): ControlPanelState {
  const base = current.autoPublisher.baseIntervalMinutes;
  const pacing =
    preset === 'balanced'
      ? { enabled: true, minPreVisitDelayMs: 2000, maxPreVisitDelayMs: 7000, minIntervalBetweenRunsMs: 30000 }
      : preset === 'night-safe'
        ? { enabled: true, minPreVisitDelayMs: 5000, maxPreVisitDelayMs: 12000, minIntervalBetweenRunsMs: 60000 }
        : { enabled: true, minPreVisitDelayMs: 1000, maxPreVisitDelayMs: 4000, minIntervalBetweenRunsMs: 15000 };

  const autoPatch =
    preset === 'balanced'
      ? {
          baseIntervalMinutes: base,
          quietHoursStart: 3,
          quietHoursEnd: 5,
          quietHoursMultiplier: 1.8,
          activeHoursStart: 8,
          activeHoursEnd: 23,
          activeHoursMultiplier: 0.8,
          trendAdaptiveEnabled: true,
          trendWindowDays: 7,
          trendRecalibrationDays: 7
        }
      : preset === 'night-safe'
        ? {
            baseIntervalMinutes: Math.max(45, base),
            quietHoursStart: 2,
            quietHoursEnd: 6,
            quietHoursMultiplier: 2.2,
            activeHoursStart: 9,
            activeHoursEnd: 22,
            activeHoursMultiplier: 0.9,
            trendAdaptiveEnabled: true,
            trendWindowDays: 14,
            trendRecalibrationDays: 14
          }
        : {
            baseIntervalMinutes: Math.max(20, Math.round(base * 0.7)),
            quietHoursStart: 3,
            quietHoursEnd: 5,
            quietHoursMultiplier: 1.6,
            activeHoursStart: 9,
            activeHoursEnd: 23,
            activeHoursMultiplier: 0.6,
            trendAdaptiveEnabled: true,
            trendWindowDays: 7,
            trendRecalibrationDays: 7
          };

  return {
    ...current,
    preset,
    observer: {
      ...pacing,
      gapThresholdMin: current.observer.gapThresholdMin,
      gapPersistedOverride: current.observer.gapPersistedOverride,
      gapThresholdSpecBaseline: current.observer.gapThresholdSpecBaseline,
      gapUsesEnvOverride: current.observer.gapUsesEnvOverride,
      gapSource: current.observer.gapSource,
      gapSourcePin: current.observer.gapSourcePin,
    },
    autoPublisher: { ...current.autoPublisher, ...autoPatch }
  };
}

export const DEFAULT_CONTROL_PANEL: ControlPanelState = {
  preset: 'balanced',
  nlWebhookEnabled: true,
  observer: {
    enabled: true,
    minPreVisitDelayMs: 0,
    maxPreVisitDelayMs: 0,
    minIntervalBetweenRunsMs: 0,
    gapThresholdMin: 5,
    gapPersistedOverride: null,
    gapThresholdSpecBaseline: 5,
    gapUsesEnvOverride: false,
    gapSource: 'spec' as const,
    gapSourcePin: null
  },
  publisher: {
    draftItemIndex: 1
  },
  autoPublisher: {
    enabled: true,
    baseIntervalMinutes: 60,
    effectiveIntervalMinutes: 60,
    quietHoursStart: 3,
    quietHoursEnd: 5,
    quietHoursMultiplier: 1.8,
    activeHoursStart: 8,
    activeHoursEnd: 23,
    activeHoursMultiplier: 0.8,
    trendAdaptiveEnabled: true,
    trendWindowDays: 7,
    trendRecalibrationDays: 7,
    scheduleJitterPercent: 15,
    scheduleJitterMode: 'uniform',
    targetPublishIntervalMinutes: 0,
    running: false
  }
};
