import { ENV } from "../config/env.js";
import type { AiAdvisorOutput } from "./aiAdvisor.js";
import type { PublisherHistoryEntry } from "../contracts/models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NlIntent =
  | "pause_scheduler"
  | "resume_scheduler"
  | "force_publish"
  | "set_interval"
  | "set_gap_threshold"
  | "apply_ai_recommendation"
  | "status_query"
  | "unknown";

export type NlClassification = {
  intent: NlIntent;
  extractedParams: Record<string, number | string | boolean>;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type NlCommandResult = {
  intent: NlIntent;
  dispatchedTo: string;
  result: unknown;
  dryRun: boolean;
};

export type NlStatusSummary = {
  schedulerEnabled: boolean;
  intervalMinutes: number;
  multiplierBand: string;
  sovPercent: number;
  lastRunAt: string | null;
  lastRunDecision: string | null;
  recommendation: AiAdvisorOutput | null;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `You are a command parser for a forum automation bot. Classify the user's instruction into one of the supported intents and extract any numeric parameters. Return a JSON object only.

Supported intents:
- pause_scheduler: stop/pause/halt the scheduler or auto-publishing
- resume_scheduler: start/resume/enable the scheduler or auto-publishing
- force_publish: post now, force publish, publish immediately
- set_interval: set the publish interval to N minutes or hours
- set_gap_threshold: set the gap threshold or minimum gap to N posts
- apply_ai_recommendation: apply, use, or activate the AI recommendation/suggestion
- status_query: ask about current status, what is happening, how things are going
- unknown: anything that does not match the above

Output schema:
{
  "intent": "<one of the intent codes or unknown>",
  "extracted_params": { "<param name>": <numeric value> },
  "confidence": "high | medium | low",
  "reason": "<one sentence — why this classification>"
}`;

function parseClassificationResponse(content: string): NlClassification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Record<string, unknown>;

  const intent = r["intent"];
  const confidence = r["confidence"];
  const reason = r["reason"];
  const rawParams = r["extracted_params"];

  const validIntents: NlIntent[] = [
    "pause_scheduler",
    "resume_scheduler",
    "force_publish",
    "set_interval",
    "set_gap_threshold",
    "apply_ai_recommendation",
    "status_query",
    "unknown",
  ];

  if (
    typeof intent !== "string" ||
    !validIntents.includes(intent as NlIntent) ||
    !["high", "medium", "low"].includes(confidence as string) ||
    typeof reason !== "string"
  ) {
    return null;
  }

  const extractedParams: Record<string, number | string | boolean> = {};
  if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
    for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        extractedParams[k] = v;
      }
    }
  }

  return {
    intent: intent as NlIntent,
    extractedParams,
    confidence: confidence as "high" | "medium" | "low",
    reason: String(reason).slice(0, 200),
  };
}

/**
 * Calls Grok 4 to classify a natural language command into a known intent.
 * On any error or timeout, returns unknown intent with low confidence.
 */
export async function classifyIntent(message: string): Promise<NlClassification> {
  const fallback = (reason: string): NlClassification => ({
    intent: "unknown",
    extractedParams: {},
    confidence: "low",
    reason: `classification failed: ${reason}`,
  });

  if (!ENV.XAI_API_KEY) {
    return fallback("XAI_API_KEY not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENV.AI_ADVISOR_TIMEOUT_MS);

  try {
    const body = JSON.stringify({
      model: "grok-4-1-fast-non-reasoning",
      temperature: 0,
      max_tokens: 256,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: "user", content: `Classify this command: "${message.slice(0, 500)}"` },
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
      return fallback(`xAI API error ${response.status}: ${text.slice(0, 100)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return fallback("empty response from xAI");

    const classification = parseClassificationResponse(content);
    if (!classification) return fallback("response failed schema validation");

    return classification;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return fallback(`xAI call timed out after ${ENV.AI_ADVISOR_TIMEOUT_MS}ms`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return fallback(msg);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Status summary (read-only — no AI call)
// ---------------------------------------------------------------------------

export function buildStatusSummary(
  controlPanel: {
    schedulerEnabled: boolean;
    baseIntervalMinutes: number;
  },
  multiplierBand: string,
  sovPercent: number,
  recentHistory: Pick<PublisherHistoryEntry, "at" | "decision">[],
  recommendation: AiAdvisorOutput | null
): NlStatusSummary {
  const last = recentHistory[0] ?? null;
  return {
    schedulerEnabled: controlPanel.schedulerEnabled,
    intervalMinutes: controlPanel.baseIntervalMinutes,
    multiplierBand,
    sovPercent,
    lastRunAt: last?.at ?? null,
    lastRunDecision: last?.decision ?? null,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Param validation helpers (reused by server.ts handler)
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Extracts and validates intervalMinutes from classification params.
 * Returns null if missing or out of bounds.
 */
export function extractIntervalMinutes(params: Record<string, number | string | boolean>): number | null {
  const raw = params["intervalMinutes"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const clamped = clampInt(raw, 5, 480);
  return clamped;
}

/**
 * Extracts and validates observerGapThresholdMin from classification params.
 * Returns null if missing or out of bounds.
 */
export function extractGapThreshold(params: Record<string, number | string | boolean>): number | null {
  const raw = params["observerGapThresholdMin"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const clamped = clampInt(raw, 1, 50);
  return clamped;
}
