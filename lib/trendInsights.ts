import type { ActivityLog } from "../contracts/models.js";

/** Mirrors `.planning/spec-kit/specs/scheduler-adaptation.policy.json` trend_multiplier_bounds */
export const TREND_MULTIPLIER_MIN = 0.65;
export const TREND_MULTIPLIER_MAX = 1.6;

/** Clamp bounds for the combined trendFactor × sovFactor product. */
export const COMBINED_MULTIPLIER_MIN = 0.5;
export const COMBINED_MULTIPLIER_MAX = 2.0;

const QUIET_HOURS_REF_MULTIPLIER = 1.8;
const ACTIVE_HOURS_REF_MULTIPLIER = 0.8;

export type TrendConfidenceReason =
  | "insufficient_snapshots"
  | "insufficient_pairs"
  | "empirical_window"
  | "adaptive_disabled";

export type TrendMultiplierBand = "very_active" | "active" | "balanced" | "quiet" | "very_quiet" | "unknown";

export type TrendHourlyBucket = { hour: number; avgNewPostsPerHour: number };

export type TrendInsightsPayload = {
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
};

export type TurnoverAnalysis = {
  recentSnapshotCount: number;
  pairSampleCount: number;
  avgNewPostsPerHour: number;
  volatility: number;
  hourlyProfile: TrendHourlyBucket[];
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Maps mean pairwise turnover (new posts per hour) to scheduler trend multiplier. Order matches server legacy logic. */
export function trendMultiplierFromAvgRate(avgRate: number): number {
  if (!Number.isFinite(avgRate) || avgRate < 0) {
    return 1;
  }
  let m: number;
  if (avgRate >= 16) m = 0.65;
  else if (avgRate >= 10) m = 0.8;
  else if (avgRate <= 3) m = 1.6;
  else if (avgRate <= 5) m = 1.25;
  else m = 1;
  return Math.max(TREND_MULTIPLIER_MIN, Math.min(TREND_MULTIPLIER_MAX, m));
}

export function multiplierBandFromAvgRate(avgRate: number): TrendMultiplierBand {
  if (!Number.isFinite(avgRate) || avgRate < 0) return "unknown";
  if (avgRate >= 16) return "very_active";
  if (avgRate >= 10) return "active";
  if (avgRate <= 3) return "very_quiet";
  if (avgRate <= 5) return "quiet";
  return "balanced";
}

function computeConfidenceValue(pairSampleCount: number, volatility: number): number {
  if (pairSampleCount < 3) return 0;
  const sampleStrength = Math.min(1, pairSampleCount / 18);
  const volPenalty = 1 - Math.min(0.7, volatility);
  return Number((sampleStrength * volPenalty).toFixed(2));
}

/**
 * Pairwise turnover analysis over snapshots in the rolling window (server local time for hourly buckets).
 */
export function computeTurnoverAnalysis(logs: ActivityLog[], windowDays: number): TurnoverAnalysis {
  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const recent = logs
    .filter((log) => Date.parse(log.timestamp) >= cutoff && Array.isArray(log.all_posts) && log.all_posts.length > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const hourlySums = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  const rates: number[] = [];

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const prevKeys = new Set((prev.all_posts ?? []).map((p) => `${p.title}::${p.author}`));
    const newPosts = (curr.all_posts ?? []).filter((p) => !prevKeys.has(`${p.title}::${p.author}`)).length;
    const dtHours = (Date.parse(curr.timestamp) - Date.parse(prev.timestamp)) / (1000 * 60 * 60);
    if (dtHours <= 0) continue;
    const rate = newPosts / dtHours;
    rates.push(rate);
    const hour = new Date(curr.timestamp).getHours();
    hourlySums[hour].sum += rate;
    hourlySums[hour].count += 1;
  }

  const avg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  let volatility = 0;
  if (rates.length >= 2) {
    const mean = avg;
    const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
    const std = Math.sqrt(variance);
    volatility = mean > 0.01 ? Math.min(1, std / mean) : 1;
  }

  const hourlyProfile: TrendHourlyBucket[] = hourlySums.map((cell, hour) => ({
    hour,
    avgNewPostsPerHour: cell.count > 0 ? Number((cell.sum / cell.count).toFixed(3)) : 0
  }));

  return {
    recentSnapshotCount: recent.length,
    pairSampleCount: rates.length,
    avgNewPostsPerHour: Number(avg.toFixed(2)),
    volatility: Number(volatility.toFixed(3)),
    hourlyProfile
  };
}

/** Maps share-of-voice percentage to a scheduler interval multiplier. */
export function shareOfVoiceMultiplierFromSoV(sovPercent: number): number {
  if (sovPercent <= 5) return 0.75;
  if (sovPercent >= 20) return 1.20;
  return 1.00;
}

/**
 * Computes mean share-of-voice (%) across snapshots in the rolling window.
 * Returns 0 when no valid snapshots exist.
 */
export function computeShareOfVoice(logs: ActivityLog[], windowDays: number, ourAuthorSubstring: string): number {
  const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
  const sub = ourAuthorSubstring.toLowerCase();
  const snapshots = logs.filter(
    (log) => Date.parse(log.timestamp) >= cutoff && Array.isArray(log.all_posts) && log.all_posts.length > 0
  );
  if (snapshots.length === 0) return 0;
  const sovValues = snapshots.map((log) => {
    const total = log.all_posts.length;
    const ours = log.all_posts.filter((p) => p.author.toLowerCase().includes(sub)).length;
    return (ours / total) * 100;
  });
  const mean = sovValues.reduce((a, b) => a + b, 0) / sovValues.length;
  return Number(mean.toFixed(1));
}

export function buildTrendInsightsPayload(
  logs: ActivityLog[],
  options: {
    windowDays: number;
    referenceBaseIntervalMinutes: number;
    trendAdaptiveEnabled: boolean;
    ourAuthorSubstring?: string;
  }
): TrendInsightsPayload {
  const { windowDays, referenceBaseIntervalMinutes, trendAdaptiveEnabled, ourAuthorSubstring = "shareplan" } = options;
  const analysis = computeTurnoverAnalysis(logs, windowDays);

  const precedenceNote =
    "manual_override_force_on_publish > operator_control_panel_preset_and_controls > trend_adaptive_multiplier_on_effective_interval";

  let confidenceReason: TrendConfidenceReason;
  let confidence: number;

  if (!trendAdaptiveEnabled) {
    confidenceReason = "adaptive_disabled";
    confidence = computeConfidenceValue(analysis.pairSampleCount, analysis.volatility);
  } else if (analysis.recentSnapshotCount < 3) {
    confidenceReason = "insufficient_snapshots";
    confidence = 0;
  } else if (analysis.pairSampleCount < 3) {
    confidenceReason = "insufficient_pairs";
    confidence = 0;
  } else {
    confidenceReason = "empirical_window";
    confidence = computeConfidenceValue(analysis.pairSampleCount, analysis.volatility);
  }

  const sufficientForAdaptive =
    trendAdaptiveEnabled && analysis.recentSnapshotCount >= 3 && analysis.pairSampleCount >= 3;

  const rawMult = trendMultiplierFromAvgRate(analysis.avgNewPostsPerHour);
  const trendMultiplier = sufficientForAdaptive ? rawMult : 1;

  const multiplierBand: TrendMultiplierBand = sufficientForAdaptive
    ? multiplierBandFromAvgRate(analysis.avgNewPostsPerHour)
    : "unknown";

  const recommendedIntervalMinutesQuiet = clampInt(
    (referenceBaseIntervalMinutes * QUIET_HOURS_REF_MULTIPLIER) / trendMultiplier,
    1,
    1440
  );
  const recommendedIntervalMinutesActive = clampInt(
    (referenceBaseIntervalMinutes * ACTIVE_HOURS_REF_MULTIPLIER) / trendMultiplier,
    1,
    1440
  );

  let explanation: string;
  if (!trendAdaptiveEnabled) {
    explanation =
      "Trend adaptation is off; multiplier is fixed at 1. Turn on trend adaptation in the control panel to apply turnover-based pacing.";
  } else if (analysis.recentSnapshotCount < 3) {
    explanation = "Not enough recent snapshots with board data in the selected window; need at least 3 to estimate turnover.";
  } else if (analysis.pairSampleCount < 3) {
    explanation = "Not enough valid snapshot pairs with positive time deltas; cannot estimate a stable turnover rate.";
  } else {
    explanation = `Mean new-post rate ~${analysis.avgNewPostsPerHour} posts/hour (${multiplierBand.replace(/_/g, " ")}). Trend multiplier ${trendMultiplier} scales the effective scheduler interval (bounded ${TREND_MULTIPLIER_MIN}–${TREND_MULTIPLIER_MAX}). Volatility ${analysis.volatility} affects confidence.`;
  }

  const sovPercent = computeShareOfVoice(logs, windowDays, ourAuthorSubstring);
  const sovFactor = shareOfVoiceMultiplierFromSoV(sovPercent);

  return {
    windowDays,
    referenceBaseIntervalMinutes,
    trendAdaptiveEnabled,
    recentSnapshotCount: analysis.recentSnapshotCount,
    pairSampleCount: analysis.pairSampleCount,
    avgNewPostsPerHour: analysis.avgNewPostsPerHour,
    volatility: analysis.volatility,
    confidence,
    confidenceReason,
    trendMultiplier,
    multiplierBand,
    recommendedIntervalMinutesQuiet,
    recommendedIntervalMinutesActive,
    hourlyProfile: analysis.hourlyProfile,
    explanation,
    precedenceNote,
    sovPercent,
    sovFactor
  };
}
