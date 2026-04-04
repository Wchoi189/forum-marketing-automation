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

/** Append-only log of auto/manual publisher runs (see artifacts/publisher-history.json). */
export interface PublisherHistoryEntry {
  at: string;
  success: boolean;
  force: boolean;
  message: string;
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
}
