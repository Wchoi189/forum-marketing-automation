import { ENV } from "../config/env.js";
import { logger } from "./logger.js";
import type { ActivityLog, PublisherHistoryEntry } from "../contracts/models.js";
import type { TrendInsightsPayload } from "./trendInsights.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiAdvisorInput = {
  trend: Pick<
    TrendInsightsPayload,
    | "avgNewPostsPerHour"
    | "volatility"
    | "multiplierBand"
    | "sovPercent"
    | "sovFactor"
    | "trendMultiplier"
    | "confidence"
    | "hourlyProfile"
  >;
  recentRuns: {
    entries: Array<Pick<PublisherHistoryEntry, "at" | "success" | "decision">>;
    successRate: number;
    gapPolicyRate: number;
    errorRate: number;
  };
  currentBoard: {
    current_gap_count: number;
    gap_threshold_min: number | undefined;
    status: string;
  } | null;
  controls: {
    intervalMinutes: number;
    schedulerJitterPercent: number;
    schedulerEnabled: boolean;
    trendAdaptiveEnabled: boolean;
  };
  meta: {
    currentHour: number;
    contextBuiltAt: string;
  };
};

export type AiAdvisorOutput = {
  recommendedIntervalMinutes: number;
  recommendedGapThreshold: number;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  signalsUsed: string[];
  generatedAt: string;
};

export type AiAdvisorResult =
  | { ok: true; recommendation: AiAdvisorOutput; contextBuiltAt: string }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let advisorCache: { result: AiAdvisorResult; cachedAt: string; appliedAt?: string } | null = null;

export function getAdvisorCache(): typeof advisorCache {
  return advisorCache;
}

export function setAdvisorCache(r: AiAdvisorResult): void {
  advisorCache = { result: r, cachedAt: new Date().toISOString() };
}

export function markAdvisorCacheApplied(): void {
  if (advisorCache) {
    advisorCache = { ...advisorCache, appliedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildAdvisorContext(
  trend: TrendInsightsPayload,
  history: PublisherHistoryEntry[],
  latestLog: ActivityLog | null,
  controls: {
    baseIntervalMinutes: number;
    scheduleJitterPercent: number;
    enabled: boolean;
    trendAdaptiveEnabled: boolean;
  }
): AiAdvisorInput {
  const recent = history.slice(0, 10);
  const total = recent.length;
  const successes = recent.filter((e) => e.success).length;
  const gapPolicies = recent.filter((e) => e.decision === "gap_policy").length;
  const errors = recent.filter(
    (e) => e.decision === "publisher_error" || e.decision === "observer_error"
  ).length;

  return {
    trend: {
      avgNewPostsPerHour: trend.avgNewPostsPerHour,
      volatility: trend.volatility,
      multiplierBand: trend.multiplierBand,
      sovPercent: trend.sovPercent,
      sovFactor: trend.sovFactor,
      trendMultiplier: trend.trendMultiplier,
      confidence: trend.confidence,
      hourlyProfile: trend.hourlyProfile,
    },
    recentRuns: {
      entries: recent.map((e) => ({ at: e.at, success: e.success, decision: e.decision })),
      successRate: total > 0 ? Number((successes / total).toFixed(3)) : 0,
      gapPolicyRate: total > 0 ? Number((gapPolicies / total).toFixed(3)) : 0,
      errorRate: total > 0 ? Number((errors / total).toFixed(3)) : 0,
    },
    currentBoard: latestLog
      ? {
          current_gap_count: latestLog.current_gap_count,
          gap_threshold_min: latestLog.gap_threshold_min,
          status: latestLog.status,
        }
      : null,
    controls: {
      intervalMinutes: controls.baseIntervalMinutes,
      schedulerJitterPercent: controls.scheduleJitterPercent,
      schedulerEnabled: controls.enabled,
      trendAdaptiveEnabled: controls.trendAdaptiveEnabled,
    },
    meta: {
      currentHour: new Date().getHours(),
      contextBuiltAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Grok 4 call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a scheduling optimizer for a forum auto-publisher bot. You receive real-time board activity and performance KPIs. Return a JSON object with your recommendation.

Constraints:
- Never recommend stopping the scheduler entirely — that is an operator decision.
- Respect the clamping bounds: intervalMinutes 5–480, gapThreshold 1–50.
- If data is insufficient (confidence < 0.3), prefer conservative recommendations close to current settings.
- Do not hallucinate data not present in the context packet.`;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function validateOutput(raw: unknown): AiAdvisorOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const intervalMinutes = r["recommendedIntervalMinutes"];
  const gapThreshold = r["recommendedGapThreshold"];
  const reasoning = r["reasoning"];
  const confidence = r["confidence"];
  const signalsUsed = r["signalsUsed"];

  if (
    typeof intervalMinutes !== "number" ||
    typeof gapThreshold !== "number" ||
    typeof reasoning !== "string" ||
    !["high", "medium", "low"].includes(confidence as string) ||
    !Array.isArray(signalsUsed) ||
    !signalsUsed.every((s) => typeof s === "string")
  ) {
    return null;
  }

  return {
    recommendedIntervalMinutes: clampInt(intervalMinutes, 5, 480),
    recommendedGapThreshold: clampInt(gapThreshold, 1, 50),
    reasoning: String(reasoning).slice(0, 300),
    confidence: confidence as "high" | "medium" | "low",
    signalsUsed: signalsUsed as string[],
    generatedAt: new Date().toISOString(),
  };
}

export async function callGrokAdvisor(context: AiAdvisorInput): Promise<AiAdvisorResult> {
  if (!ENV.XAI_API_KEY) {
    return { ok: false, reason: "XAI_API_KEY not configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENV.AI_ADVISOR_TIMEOUT_MS);

  try {
    const body = JSON.stringify({
      model: "grok-4-1-fast-non-reasoning",
      temperature: 0,
      max_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Context packet:\n${JSON.stringify(context, null, 2)}\n\nReturn your scheduling recommendation as a JSON object.`,
        },
      ],
    });

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.XAI_API_KEY}`,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, reason: `xAI API error ${response.status}: ${text.slice(0, 200)}` };
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, reason: "Empty response content from xAI" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: "Failed to parse JSON from xAI response" };
    }

    const output = validateOutput(parsed);
    if (!output) {
      return { ok: false, reason: "xAI response failed schema validation" };
    }

    return {
      ok: true,
      recommendation: output,
      contextBuiltAt: context.meta.contextBuiltAt,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: `xAI call timed out after ${ENV.AI_ADVISOR_TIMEOUT_MS}ms` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `xAI call failed: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
