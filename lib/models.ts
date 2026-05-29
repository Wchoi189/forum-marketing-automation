export type ActivityStatus = "safe" | "unsafe" | "error";

export interface Post {
  title: string;
  author: string;
  date: string;
  views: number;
  isNotice: boolean;
}

export interface ActivityLog {
  timestamp: string;
  current_gap_count: number;
  /** Effective minimum gap (posts) used for this observer snapshot when present. */
  gap_threshold_min?: number;
  last_post_timestamp: string;
  top_competitor_names: string[];
  view_count_of_last_post: number;
  status: ActivityStatus;
  all_posts: Post[];
  error?: string;
}

export interface BoardStats {
  turnoverRate: number | string;
  shareOfVoice: number;
}

export interface CompetitorStat {
  author: string;
  frequency: number;
  avgViews: number;
}

export interface DraftItem {
  title: string;
  timestamp: string;
  id: string;
}

/** Outcome classification for publisher history / operator triage. */
export type PublisherRunDecision =
  | "gap_policy"
  | "observer_error"
  | "manual_override_disabled"
  | "published_verified"
  | "dry_run"
  | "publisher_error";

/** Append-only log of auto/manual publisher runs (see artifacts/publisher-history/*.jsonl). */
export interface PublisherHistoryEntry {
  at: string;
  success: boolean;
  force: boolean;
  message: string;
  /** Correlates one UI/API invocation with artifacts and logs. */
  runId?: string;
  /** Project-relative artifact directory when browser publisher ran (e.g. artifacts/publisher-runs/<timestamp>). */
  artifactDir?: string | null;
  decision?: PublisherRunDecision;
}

export type TrendConfidenceReason =
  | "insufficient_snapshots"
  | "insufficient_pairs"
  | "empirical_window"
  | "adaptive_disabled";

export type TrendMultiplierBand =
  | "very_active"
  | "active"
  | "balanced"
  | "quiet"
  | "very_quiet"
  | "unknown";

export interface TrendHourlyBucket {
  hour: number;
  avgNewPostsPerHour: number;
}

export type SchedulerSignalCalibrationRecommendation =
  | "hold_bounds"
  | "widen_bounds"
  | "tighten_bounds";

export interface SchedulerSignalCalibration {
  isolatedMultiplierP10: number;
  isolatedMultiplierP50: number;
  isolatedMultiplierP90: number;
  isolatedMultiplierMin: number;
  isolatedMultiplierMax: number;
  isolatedBoundHitRate: number;
  suggestedMinBound: number;
  suggestedMaxBound: number;
  recommendation: SchedulerSignalCalibrationRecommendation;
}

export interface SchedulerSignalDiagnostics {
  sampledAt: string;
  windowDays: number;
  windowSize: number;
  historyLimit: number;
  inputEventCount: number;
  timelineEventCount: number;
  adaptationWindowCount: number;
  summary: {
    totalSignalCount: number;
    adaptationEligibleCount: number;
    gapRecheckCount: number;
    opportunityWindowCount: number;
    publishAttemptCount: number;
    publishSuccessCount: number;
    publishFailureCount: number;
    ignoredSignalCount: number;
    successRate: number;
    opportunityScore: number;
    isolatedMultiplier: number;
    baselineMultiplier: number;
    reason:
      | "insufficient_opportunity_windows"
      | "opportunity_rich"
      | "opportunity_balanced"
      | "opportunity_degraded";
  };
  latestWindow: {
    windowIndex: number;
    startAt: string;
    endAt: string;
    deltaFromBaseline: number;
    isolatedMultiplier: number;
    baselineMultiplier: number;
    opportunityScore: number;
    reason:
      | "insufficient_opportunity_windows"
      | "opportunity_rich"
      | "opportunity_balanced"
      | "opportunity_degraded";
  } | null;
  calibration: SchedulerSignalCalibration;
}

export interface TrendInsights {
  windowDays: number;
  referenceBaseIntervalMinutes: number;
  trendAdaptiveEnabled: boolean;
  recentSnapshotCount: number;
  pairSampleCount: number;
  avgNewPostsPerHour: number;
  volatility: number;
  confidence: number;
  confidenceReason: TrendConfidenceReason;
  trendMultiplier: number;
  multiplierBand: TrendMultiplierBand;
  recommendedIntervalMinutesQuiet: number;
  recommendedIntervalMinutesActive: number;
  hourlyProfile: TrendHourlyBucket[];
  explanation: string;
  precedenceNote: string;
  sovPercent: number;
  sovFactor: number;
  schedulerSignals?: SchedulerSignalDiagnostics | null;
}
