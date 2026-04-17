import type { PublisherHistoryEntry, PublisherRunDecision } from "../contracts/models.js";

export type SchedulerSignalClass =
  | "gap_recheck"
  | "publish_attempt"
  | "publish_success"
  | "opportunity_window"
  | "non_adaptive";

export const ADAPTATION_ELIGIBLE_SIGNAL_CLASSES = [
  "publish_attempt",
  "publish_success",
  "opportunity_window",
] as const;

export const OPPORTUNITY_MULTIPLIER_MIN = 0.83;
export const OPPORTUNITY_MULTIPLIER_MAX = 1.15;

export type SchedulerSignalEvent = {
  at: string;
  timestampMs: number;
  success: boolean;
  decision: PublisherRunDecision | "unknown";
  primaryClass: SchedulerSignalClass;
  classes: SchedulerSignalClass[];
  adaptationEligible: boolean;
};

export type SchedulerSignalSummary = {
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

export type SchedulerSignalSummaryOptions = {
  windowDays: number;
  nowMs?: number;
};

export type SchedulerAdaptationWindowSummary = SchedulerSignalSummary & {
  windowIndex: number;
  startAt: string;
  endAt: string;
  deltaFromBaseline: number;
};

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Number(value.toFixed(3))));
}

function asDecision(value: PublisherHistoryEntry["decision"]): PublisherRunDecision | "unknown" {
  return value ?? "unknown";
}

function buildRateDrivenMultiplier(successRate: number, sampleSize: number): number {
  if (sampleSize <= 0) {
    return 1;
  }
  const centered = (successRate - 0.5) * 2;
  const volumeStrength = Math.min(1, sampleSize / 8);
  return clampFloat(1 - centered * 0.15 * volumeStrength, OPPORTUNITY_MULTIPLIER_MIN, OPPORTUNITY_MULTIPLIER_MAX);
}

function hasClass(event: SchedulerSignalEvent, cls: SchedulerSignalClass): boolean {
  return event.classes.includes(cls);
}

function summarizeTimeline(timeline: SchedulerSignalEvent[]): SchedulerSignalSummary {
  const totalSignalCount = timeline.length;
  const gapRecheckCount = timeline.filter((event) => hasClass(event, "gap_recheck")).length;
  const opportunityWindowCount = timeline.filter((event) => hasClass(event, "opportunity_window")).length;
  const publishAttemptCount = timeline.filter((event) => hasClass(event, "publish_attempt")).length;
  const publishSuccessCount = timeline.filter((event) => hasClass(event, "publish_success")).length;
  const publishFailureCount = Math.max(0, publishAttemptCount - publishSuccessCount);
  const adaptationEligibleCount = timeline.filter((event) => event.adaptationEligible).length;
  const ignoredSignalCount = Math.max(0, totalSignalCount - adaptationEligibleCount);

  const successRate = publishAttemptCount > 0 ? publishSuccessCount / publishAttemptCount : 0.5;
  const attemptDensity = totalSignalCount > 0 ? publishAttemptCount / totalSignalCount : 0;
  const opportunityScore = Number((0.7 * successRate + 0.3 * attemptDensity).toFixed(3));

  const isolatedMultiplier = buildRateDrivenMultiplier(successRate, publishAttemptCount);
  const baselineSuccessRate = totalSignalCount > 0 ? publishSuccessCount / totalSignalCount : 0.5;
  const baselineMultiplier = buildRateDrivenMultiplier(baselineSuccessRate, totalSignalCount);

  let reason: SchedulerSignalSummary["reason"] = "opportunity_balanced";
  if (publishAttemptCount < 3 || opportunityWindowCount < 3) {
    reason = "insufficient_opportunity_windows";
  } else if (successRate >= 0.7) {
    reason = "opportunity_rich";
  } else if (successRate <= 0.3) {
    reason = "opportunity_degraded";
  }

  return {
    totalSignalCount,
    adaptationEligibleCount,
    gapRecheckCount,
    opportunityWindowCount,
    publishAttemptCount,
    publishSuccessCount,
    publishFailureCount,
    ignoredSignalCount,
    successRate: Number(successRate.toFixed(3)),
    opportunityScore,
    isolatedMultiplier,
    baselineMultiplier,
    reason,
  };
}

export function classifySchedulerSignal(
  entry: Pick<PublisherHistoryEntry, "at" | "success" | "decision">
): SchedulerSignalEvent | null {
  const timestampMs = Date.parse(entry.at);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  const decision = asDecision(entry.decision);
  const base = {
    at: entry.at,
    timestampMs,
    success: entry.success,
    decision,
  };

  if (decision === "gap_policy") {
    return {
      ...base,
      primaryClass: "gap_recheck",
      classes: ["gap_recheck"],
      adaptationEligible: false,
    };
  }

  if (decision === "published_verified" || decision === "dry_run") {
    return {
      ...base,
      primaryClass: "publish_success",
      classes: ["publish_success", "publish_attempt", "opportunity_window"],
      adaptationEligible: true,
    };
  }

  if (decision === "publisher_error") {
    return {
      ...base,
      primaryClass: "publish_attempt",
      classes: ["publish_attempt", "opportunity_window"],
      adaptationEligible: true,
    };
  }

  if (decision === "observer_error" || decision === "manual_override_disabled") {
    return {
      ...base,
      primaryClass: "non_adaptive",
      classes: ["non_adaptive"],
      adaptationEligible: false,
    };
  }

  // Legacy records may lack explicit decision. Infer conservative opportunity signals.
  if (entry.success) {
    return {
      ...base,
      primaryClass: "publish_success",
      classes: ["publish_success", "publish_attempt", "opportunity_window"],
      adaptationEligible: true,
    };
  }

  return {
    ...base,
    primaryClass: "publish_attempt",
    classes: ["publish_attempt", "opportunity_window"],
    adaptationEligible: true,
  };
}

export function buildSchedulerSignalTimeline(
  entries: Array<Pick<PublisherHistoryEntry, "at" | "success" | "decision">>,
  options: SchedulerSignalSummaryOptions
): SchedulerSignalEvent[] {
  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs = nowMs - options.windowDays * 24 * 60 * 60 * 1000;

  return entries
    .map((entry) => classifySchedulerSignal(entry))
    .filter((entry): entry is SchedulerSignalEvent => entry !== null)
    .filter((entry) => entry.timestampMs >= cutoffMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function summarizeSchedulerSignals(
  entries: Array<Pick<PublisherHistoryEntry, "at" | "success" | "decision">>,
  options: SchedulerSignalSummaryOptions
): SchedulerSignalSummary {
  const timeline = buildSchedulerSignalTimeline(entries, options);
  return summarizeTimeline(timeline);
}

export function buildSchedulerAdaptationWindows(
  timeline: SchedulerSignalEvent[],
  windowSize = 8
): SchedulerAdaptationWindowSummary[] {
  const chunkSize = Math.max(1, Math.round(windowSize));
  const eligible = timeline.filter((event) => event.adaptationEligible);

  const windows: SchedulerAdaptationWindowSummary[] = [];
  const chunks = eligible.length > 0 ? eligible : timeline;

  for (let i = 0; i < chunks.length; i += chunkSize) {
    const chunk = chunks.slice(i, i + chunkSize);
    if (chunk.length === 0) {
      continue;
    }

    const startMs = chunk[0].timestampMs;
    const endMs = chunk[chunk.length - 1].timestampMs;
    const windowTimeline = timeline.filter((event) => event.timestampMs >= startMs && event.timestampMs <= endMs);
    const summary = summarizeTimeline(windowTimeline);

    windows.push({
      windowIndex: windows.length + 1,
      startAt: chunk[0].at,
      endAt: chunk[chunk.length - 1].at,
      deltaFromBaseline: Number((summary.isolatedMultiplier - summary.baselineMultiplier).toFixed(3)),
      ...summary,
    });
  }

  return windows;
}
