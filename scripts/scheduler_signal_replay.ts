import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PublisherHistoryEntry } from "../contracts/models.js";
import {
  OPPORTUNITY_MULTIPLIER_MAX,
  OPPORTUNITY_MULTIPLIER_MIN,
  buildSchedulerAdaptationWindows,
  buildSchedulerSignalTimeline,
  summarizeSchedulerSignals,
} from "../lib/schedulerSignals.js";

type CliOptions = {
  historyDir: string;
  activityLogPath: string;
  outputDir: string;
  fixturePath: string | null;
  windowDays: number;
  windowSize: number;
  historyLimit: number;
  nowIso: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [k, inlineVal] = token.slice(2).split("=", 2);
    const next = argv[i + 1];
    const val = inlineVal ?? (next && !next.startsWith("--") ? next : "true");
    if (inlineVal === undefined && next && !next.startsWith("--")) {
      i += 1;
    }
    map.set(k, val);
  }

  return {
    historyDir: map.get("history-dir") ?? path.join("artifacts", "publisher-history"),
    activityLogPath: map.get("activity-log") ?? "activity_log.json",
    outputDir: map.get("output-dir") ?? path.join("artifacts", "scheduler-replay", "latest"),
    fixturePath: map.get("fixture") ?? null,
    windowDays: Math.max(1, Number.parseInt(map.get("window-days") ?? "7", 10) || 7),
    windowSize: Math.max(1, Number.parseInt(map.get("window-size") ?? "8", 10) || 8),
    historyLimit: Math.max(0, Number.parseInt(map.get("history-limit") ?? "0", 10) || 0),
    nowIso: map.get("now") ?? null,
  };
}

function parseHistoryEntry(raw: unknown): PublisherHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<PublisherHistoryEntry>;
  if (typeof item.at !== "string") return null;
  if (typeof item.success !== "boolean") return null;
  if (typeof item.force !== "boolean") return null;
  if (typeof item.message !== "string") return null;
  return {
    at: item.at,
    success: item.success,
    force: item.force,
    message: item.message,
    runId: typeof item.runId === "string" ? item.runId : undefined,
    artifactDir:
      item.artifactDir === null || typeof item.artifactDir === "string" ? item.artifactDir : undefined,
    decision: item.decision,
  };
}

async function readFixtureEntries(filePath: string): Promise<PublisherHistoryEntry[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.map(parseHistoryEntry).filter((row): row is PublisherHistoryEntry => row !== null);
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return (parsed as { entries: unknown[] }).entries
      .map(parseHistoryEntry)
      .filter((row): row is PublisherHistoryEntry => row !== null);
  }
  throw new Error(`Fixture must be an array or an object with an entries array: ${filePath}`);
}

async function readJsonlHistoryEntries(historyDir: string): Promise<PublisherHistoryEntry[]> {
  const files = (await fs.readdir(historyDir))
    .filter((name) => name.endsWith(".jsonl"))
    .sort((a, b) => a.localeCompare(b));

  const out: PublisherHistoryEntry[] = [];
  for (const fileName of files) {
    const filePath = path.join(historyDir, fileName);
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const entry = parseHistoryEntry(parsed);
        if (entry) {
          out.push(entry);
        }
      } catch {
        // Ignore malformed lines in replay mode.
      }
    }
  }
  return out;
}

async function readActivityLogCount(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((row) => row && typeof row === "object").length;
  } catch {
    return 0;
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedP = Math.max(0, Math.min(1, p));
  const idx = (sorted.length - 1) * clampedP;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return Number(sorted[lower].toFixed(3));
  const blended = sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  return Number(blended.toFixed(3));
}

function sortEntriesByTime(entries: PublisherHistoryEntry[]): PublisherHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const aTs = Date.parse(a.at);
    const bTs = Date.parse(b.at);
    const safeA = Number.isFinite(aTs) ? aTs : 0;
    const safeB = Number.isFinite(bTs) ? bTs : 0;
    return safeA - safeB;
  });
}

function normalizeEntriesForHash(entries: PublisherHistoryEntry[]): Array<Pick<PublisherHistoryEntry, "at" | "success" | "decision">> {
  return entries
    .map((entry) => ({ at: entry.at, success: entry.success, decision: entry.decision }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const entries = opts.fixturePath
    ? await readFixtureEntries(opts.fixturePath)
    : await readJsonlHistoryEntries(opts.historyDir);
  const normalizedEntries = sortEntriesByTime(entries);
  const replayEntries =
    opts.historyLimit > 0 && normalizedEntries.length > opts.historyLimit
      ? normalizedEntries.slice(normalizedEntries.length - opts.historyLimit)
      : normalizedEntries;

  const inferredNowMs = replayEntries
    .map((entry) => Date.parse(entry.at))
    .filter((ts) => Number.isFinite(ts))
    .reduce((max, ts) => Math.max(max, ts), Date.now());

  const nowMs = opts.nowIso ? Date.parse(opts.nowIso) : inferredNowMs;
  if (!Number.isFinite(nowMs)) {
    throw new Error(`Invalid --now value: ${opts.nowIso}`);
  }

  const timeline = buildSchedulerSignalTimeline(replayEntries, {
    windowDays: opts.windowDays,
    nowMs,
  });
  const windows = buildSchedulerAdaptationWindows(timeline, opts.windowSize);
  const globalSummary = summarizeSchedulerSignals(replayEntries, {
    windowDays: opts.windowDays,
    nowMs,
  });

  const isolatedMultipliers = windows.map((window) => window.isolatedMultiplier);
  const baselineMultipliers = windows.map((window) => window.baselineMultiplier);

  const skipHeavyWindows = windows.filter(
    (window) => window.totalSignalCount > 0 && window.gapRecheckCount / window.totalSignalCount >= 0.6
  );

  const boundsViolations = windows.filter(
    (window) =>
      window.isolatedMultiplier < OPPORTUNITY_MULTIPLIER_MIN ||
      window.isolatedMultiplier > OPPORTUNITY_MULTIPLIER_MAX
  );

  const skipHeavyInflationViolations = skipHeavyWindows.filter(
    (window) => window.reason !== "opportunity_degraded" && window.isolatedMultiplier > 1
  );

  const replayFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        nowMs,
        windowDays: opts.windowDays,
        windowSize: opts.windowSize,
        entries: normalizeEntriesForHash(replayEntries),
      })
    )
    .digest("hex");

  const activityLogCount = await readActivityLogCount(opts.activityLogPath);
  const isolatedSeries = windows.length > 0 ? windows.map((window) => window.isolatedMultiplier) : [globalSummary.isolatedMultiplier];

  const isolatedMin = Number(Math.min(...isolatedSeries).toFixed(3));
  const isolatedMax = Number(Math.max(...isolatedSeries).toFixed(3));
  const isolatedP10 = percentile(isolatedSeries, 0.1);
  const isolatedP50 = percentile(isolatedSeries, 0.5);
  const isolatedP90 = percentile(isolatedSeries, 0.9);
  const lowerBoundHits = isolatedSeries.filter((value) => value <= OPPORTUNITY_MULTIPLIER_MIN + Number.EPSILON).length;
  const upperBoundHits = isolatedSeries.filter((value) => value >= OPPORTUNITY_MULTIPLIER_MAX - Number.EPSILON).length;
  const boundHits = lowerBoundHits + upperBoundHits;
  const isolatedBoundHitRate = Number((boundHits / isolatedSeries.length).toFixed(3));
  const lowerBoundHitRate = Number((lowerBoundHits / isolatedSeries.length).toFixed(3));
  const upperBoundHitRate = Number((upperBoundHits / isolatedSeries.length).toFixed(3));
  const candidateMinBound = Number(Math.max(0.75, isolatedP10 - 0.02).toFixed(2));
  const candidateMaxBound = Number(Math.min(1.25, isolatedP90 + 0.02).toFixed(2));

  let suggestedMinBound = OPPORTUNITY_MULTIPLIER_MIN;
  let suggestedMaxBound = OPPORTUNITY_MULTIPLIER_MAX;

  if (lowerBoundHitRate >= 0.12 || upperBoundHitRate >= 0.12) {
    suggestedMinBound = lowerBoundHitRate >= 0.12 ? candidateMinBound : OPPORTUNITY_MULTIPLIER_MIN;
    suggestedMaxBound = upperBoundHitRate >= 0.12 ? candidateMaxBound : OPPORTUNITY_MULTIPLIER_MAX;
  } else if (
    isolatedBoundHitRate === 0 &&
    candidateMinBound > OPPORTUNITY_MULTIPLIER_MIN &&
    candidateMaxBound < OPPORTUNITY_MULTIPLIER_MAX
  ) {
    suggestedMinBound = candidateMinBound;
    suggestedMaxBound = candidateMaxBound;
  }
  const calibrationRecommendation =
    lowerBoundHitRate >= 0.12 || upperBoundHitRate >= 0.12
      ? "widen_bounds"
      : isolatedBoundHitRate === 0 && candidateMinBound > OPPORTUNITY_MULTIPLIER_MIN && candidateMaxBound < OPPORTUNITY_MULTIPLIER_MAX
        ? "tighten_bounds"
        : "hold_bounds";

  const windowSummaryPayload = {
    meta: {
      generatedAt: new Date().toISOString(),
      replayFingerprint,
      source: opts.fixturePath ? "fixture" : "jsonl",
      windowDays: opts.windowDays,
      windowSize: opts.windowSize,
      inputEventCount: replayEntries.length,
      historyLimit: opts.historyLimit,
      timelineEventCount: timeline.length,
      nowIso: new Date(nowMs).toISOString(),
    },
    windows,
  };

  const comparisonPayload = {
    meta: {
      generatedAt: new Date().toISOString(),
      replayFingerprint,
    },
    aggregate: {
      isolatedAverageMultiplier: average(isolatedMultipliers),
      baselineAverageMultiplier: average(baselineMultipliers),
      averageDelta: Number((average(isolatedMultipliers) - average(baselineMultipliers)).toFixed(3)),
      globalOpportunityScore: globalSummary.opportunityScore,
      globalReason: globalSummary.reason,
    },
    windows: windows.map((window) => ({
      windowIndex: window.windowIndex,
      startAt: window.startAt,
      endAt: window.endAt,
      isolatedMultiplier: window.isolatedMultiplier,
      baselineMultiplier: window.baselineMultiplier,
      deltaFromBaseline: window.deltaFromBaseline,
      opportunityScore: window.opportunityScore,
      reason: window.reason,
    })),
  };

  const stabilityReportPayload = {
    meta: {
      generatedAt: new Date().toISOString(),
      replayFingerprint,
    },
    inputCoverage: {
      publisherHistoryEvents: replayEntries.length,
      timelineEvents: timeline.length,
      activityLogSnapshots: activityLogCount,
      adaptationEligibleSignals: globalSummary.adaptationEligibleCount,
      gapRechecks: globalSummary.gapRecheckCount,
    },
    qualityGates: {
      multiplierBoundsSatisfied: boundsViolations.length === 0,
      skipHeavyNoInflationWithoutDegradation: skipHeavyInflationViolations.length === 0,
      deterministicReplayFingerprint: replayFingerprint,
    },
    violations: {
      multiplierBounds: boundsViolations.map((window) => ({
        windowIndex: window.windowIndex,
        isolatedMultiplier: window.isolatedMultiplier,
      })),
      skipHeavyInflation: skipHeavyInflationViolations.map((window) => ({
        windowIndex: window.windowIndex,
        reason: window.reason,
        isolatedMultiplier: window.isolatedMultiplier,
      })),
    },
  };

  const calibrationReportPayload = {
    meta: {
      generatedAt: new Date().toISOString(),
      replayFingerprint,
      source: opts.fixturePath ? "fixture" : "jsonl",
      historyLimit: opts.historyLimit,
      windowDays: opts.windowDays,
      windowSize: opts.windowSize,
      inputEventCount: replayEntries.length,
      timelineEventCount: timeline.length,
    },
    calibration: {
      isolatedMultiplierMin: isolatedMin,
      isolatedMultiplierMax: isolatedMax,
      isolatedMultiplierP10: isolatedP10,
      isolatedMultiplierP50: isolatedP50,
      isolatedMultiplierP90: isolatedP90,
      isolatedBoundHitRate,
      suggestedMinBound,
      suggestedMaxBound,
      recommendation: calibrationRecommendation,
      currentBoundMin: OPPORTUNITY_MULTIPLIER_MIN,
      currentBoundMax: OPPORTUNITY_MULTIPLIER_MAX,
    },
    context: {
      globalOpportunityScore: globalSummary.opportunityScore,
      globalReason: globalSummary.reason,
      adaptationWindowCount: windows.length,
      skipHeavyWindowCount: skipHeavyWindows.length,
    },
  };

  await fs.mkdir(opts.outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(opts.outputDir, "window_summary.json"), `${JSON.stringify(windowSummaryPayload, null, 2)}\n`, "utf-8"),
    fs.writeFile(path.join(opts.outputDir, "comparison.json"), `${JSON.stringify(comparisonPayload, null, 2)}\n`, "utf-8"),
    fs.writeFile(path.join(opts.outputDir, "stability_report.json"), `${JSON.stringify(stabilityReportPayload, null, 2)}\n`, "utf-8"),
    fs.writeFile(path.join(opts.outputDir, "calibration_report.json"), `${JSON.stringify(calibrationReportPayload, null, 2)}\n`, "utf-8"),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        outputDir: opts.outputDir,
        replayFingerprint,
        windows: windows.length,
        inputEvents: replayEntries.length,
        timelineEvents: timeline.length,
        calibrationRecommendation,
        suggestedMinBound,
        suggestedMaxBound,
      },
      null,
      2
    )}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`scheduler_signal_replay failed: ${String(err)}\n`);
  process.exitCode = 1;
});
