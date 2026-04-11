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

export type AiAdvisorTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AiAdvisorResult =
  | { ok: true; recommendation: AiAdvisorOutput; contextBuiltAt: string; usage?: AiAdvisorTokenUsage; durationMs?: number }
  | { ok: false; reason: string; usage?: AiAdvisorTokenUsage; durationMs?: number };

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
// Lifetime token accounting (process-scoped, reset on server restart)
// ---------------------------------------------------------------------------

export type AdvisorTokenStats = {
  callCount: number;
  successCount: number;
  failureCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  avgPromptTokens: number | null;
  avgCompletionTokens: number | null;
  avgTotalTokens: number | null;
  lastCallAt: string | null;
  lastDurationMs: number | null;
};

const tokenTotals = {
  callCount: 0,
  successCount: 0,
  failureCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  lastCallAt: null as string | null,
  lastDurationMs: null as number | null,
};

function recordTokenUsage(usage: AiAdvisorTokenUsage | undefined, success: boolean, durationMs: number): void {
  tokenTotals.callCount += 1;
  if (success) tokenTotals.successCount += 1;
  else tokenTotals.failureCount += 1;
  tokenTotals.lastCallAt = new Date().toISOString();
  tokenTotals.lastDurationMs = durationMs;
  if (usage) {
    tokenTotals.totalPromptTokens += usage.promptTokens;
    tokenTotals.totalCompletionTokens += usage.completionTokens;
    tokenTotals.totalTokens += usage.totalTokens;
  }
}

export function getAdvisorTokenStats(): AdvisorTokenStats {
  const n = tokenTotals.callCount;
  return {
    ...tokenTotals,
    avgPromptTokens: n > 0 ? Math.round(tokenTotals.totalPromptTokens / n) : null,
    avgCompletionTokens: n > 0 ? Math.round(tokenTotals.totalCompletionTokens / n) : null,
    avgTotalTokens: n > 0 ? Math.round(tokenTotals.totalTokens / n) : null,
  };
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

const SYSTEM_PROMPT = `You are a scheduling optimizer for a forum auto-publisher bot. You receive real-time board activity and performance KPIs.

Return ONLY a flat JSON object with EXACTLY these keys — no wrapper, no extra keys:
{
  "recommendedIntervalMinutes": <integer 5–480>,
  "recommendedGapThreshold": <integer 1–50>,
  "reasoning": "<one sentence, ≤ 200 chars>",
  "confidence": "<high|medium|low>",
  "signalsUsed": ["<signal1>", "<signal2>", ...]
}

Constraints:
- Output the JSON object directly — do NOT nest it inside a "recommendation" or any other key.
- Never recommend stopping the scheduler entirely — that is an operator decision.
- Respect the clamping bounds: intervalMinutes 5–480, gapThreshold 1–50.
- If data is insufficient (confidence < 0.3), prefer conservative recommendations close to current settings.
- Do not hallucinate data not present in the context packet.`;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function validateFlat(raw: unknown): AiAdvisorOutput | null {
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

/**
 * Validates and normalises the raw JSON from xAI. Tries the flat structure first,
 * then unwraps common nesting keys the model sometimes adds despite instructions.
 */
function validateOutput(raw: unknown): AiAdvisorOutput | null {
  const direct = validateFlat(raw);
  if (direct) return direct;

  // Model sometimes wraps the output — try common wrapper keys
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["recommendation", "result", "output", "data", "response"]) {
      const nested = validateFlat(obj[key]);
      if (nested) return nested;
    }
  }
  return null;
}

const MODEL_ID = "grok-4-1-fast-non-reasoning";

export async function callGrokAdvisor(context: AiAdvisorInput): Promise<AiAdvisorResult> {
  if (!ENV.XAI_API_KEY) {
    return { ok: false, reason: "XAI_API_KEY not configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENV.AI_ADVISOR_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const requestBody = JSON.stringify({
      model: MODEL_ID,
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
      body: requestBody,
      signal: controller.signal,
    });

    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const result: AiAdvisorResult = { ok: false, reason: `xAI API error ${response.status}: ${text.slice(0, 200)}`, durationMs };
      recordTokenUsage(undefined, false, durationMs);
      logger.warn({ event: "ai_advisor_call", ok: false, status: response.status, durationMs, model: MODEL_ID }, "[AI Advisor] API error");
      return result;
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const usage: AiAdvisorTokenUsage | undefined = json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : undefined;

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      recordTokenUsage(usage, false, durationMs);
      logger.warn({ event: "ai_advisor_call", ok: false, reason: "empty_content", durationMs, model: MODEL_ID, ...usage && { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } }, "[AI Advisor] Empty response content");
      return { ok: false, reason: "Empty response content from xAI", usage, durationMs };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      recordTokenUsage(usage, false, durationMs);
      logger.warn({ event: "ai_advisor_call", ok: false, reason: "json_parse_failed", durationMs, model: MODEL_ID, ...usage && { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } }, "[AI Advisor] Failed to parse JSON from response");
      return { ok: false, reason: "Failed to parse JSON from xAI response", usage, durationMs };
    }

    const output = validateOutput(parsed);
    if (!output) {
      recordTokenUsage(usage, false, durationMs);
      logger.warn(
        { event: "ai_advisor_schema_mismatch", rawContent: content.slice(0, 600), durationMs, model: MODEL_ID, ...usage && { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } },
        "[AI Advisor] Response failed schema validation — raw content logged for diagnosis"
      );
      return { ok: false, reason: "xAI response failed schema validation", usage, durationMs };
    }

    recordTokenUsage(usage, true, durationMs);
    logger.info(
      {
        event: "ai_advisor_call",
        ok: true,
        durationMs,
        model: MODEL_ID,
        confidence: output.confidence,
        recommendedIntervalMinutes: output.recommendedIntervalMinutes,
        recommendedGapThreshold: output.recommendedGapThreshold,
        ...usage && { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens },
        lifetimeTotals: getAdvisorTokenStats(),
      },
      "[AI Advisor] Call succeeded"
    );

    return {
      ok: true,
      recommendation: output,
      contextBuiltAt: context.meta.contextBuiltAt,
      usage,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startMs;
    if (err instanceof Error && err.name === "AbortError") {
      recordTokenUsage(undefined, false, durationMs);
      logger.warn({ event: "ai_advisor_call", ok: false, reason: "timeout", durationMs, model: MODEL_ID }, "[AI Advisor] Call timed out");
      return { ok: false, reason: `xAI call timed out after ${ENV.AI_ADVISOR_TIMEOUT_MS}ms`, durationMs };
    }
    const msg = err instanceof Error ? err.message : String(err);
    recordTokenUsage(undefined, false, durationMs);
    logger.error({ event: "ai_advisor_call", ok: false, reason: msg, durationMs, model: MODEL_ID }, "[AI Advisor] Call failed with unexpected error");
    return { ok: false, reason: `xAI call failed: ${msg}`, durationMs };
  } finally {
    clearTimeout(timeoutId);
  }
}
