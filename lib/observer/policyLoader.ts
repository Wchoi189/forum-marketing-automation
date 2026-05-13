/**
 * lib/observer/policyLoader.ts
 *
 * Loads and validates the observer policy from the spec-kit JSON contracts.
 *
 * Precedence for gap threshold (default, no pin):
 *   file override → explicit env var → spec baseline
 * With pin 'env': always use env var (skip file override).
 * With pin 'spec': always use spec baseline (skip both).
 */

import fs from 'fs/promises';
import path from 'path';
import { ENV } from '../../config/env.js';
import { readRuntimeGapPersistedOverride, readPersistedGapSourcePin } from '../runtimeControls.js';
import type { ObserverControls, ObserverControlsWithGap } from '../controls.js';
import { getObserverControls } from '../controls.js';

// ---------------------------------------------------------------------------
// Internal types — not exported; consumers get the public ObserverPolicy shape
// ---------------------------------------------------------------------------

type WorkflowManifest = {
  entry_url?: unknown;
  observer_rules?: {
    author_match?: unknown;
    gap_threshold_min?: unknown;
    parse_confidence_min?: unknown;
    exclude_notice_rows?: unknown;
  };
};

type DecisionRules = {
  observer_rules?: {
    author_match_value?: unknown;
    gap_threshold_min?: unknown;
    parse_confidence_min?: unknown;
    notice_rows_excluded?: unknown;
  };
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ObserverPolicy = {
  boardUrl: string;
  authorMatch: string;
  gapThresholdMin: number;
  parseConfidenceMin: number;
  excludeNoticeRows: boolean;
};

export type ObserverPolicyBase = {
  boardUrl: string;
  authorMatch: string;
  specGapThresholdMin: number;
  parseConfidenceMin: number;
  excludeNoticeRows: boolean;
};

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

let observerPolicyBasePromise: Promise<ObserverPolicyBase> | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readPlanningJson<T>(relativePath: string): Promise<T> {
  const filePath = path.join(ENV.PROJECT_ROOT, '.planning', 'spec-kit', relativePath);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

function assertPolicy(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[OBSERVER_POLICY] ${message}`);
  }
}

function toInt(value: unknown, label: string): number {
  assertPolicy(typeof value === 'number' && Number.isInteger(value), `${label} must be an integer`);
  return value;
}

function toNumber(value: unknown, label: string): number {
  assertPolicy(typeof value === 'number' && Number.isFinite(value), `${label} must be a number`);
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadObserverPolicyBase(): Promise<ObserverPolicyBase> {
  if (!observerPolicyBasePromise) {
    observerPolicyBasePromise = (async () => {
      const [workflow, decisionRules] = await Promise.all([
        readPlanningJson<WorkflowManifest>('manifest/workflow.ppomppu-gonggu-v1.json'),
        readPlanningJson<DecisionRules>('specs/decision-rules.json')
      ]);

      const workflowRules = workflow.observer_rules;
      const decisionObserverRules = decisionRules.observer_rules;
      assertPolicy(Boolean(workflowRules), 'workflow observer_rules are missing');
      assertPolicy(Boolean(decisionObserverRules), 'decision-rules observer_rules are missing');

      const boardUrl = workflow.entry_url;
      assertPolicy(typeof boardUrl === 'string' && boardUrl.length > 0, 'workflow.entry_url must be a non-empty string');

      const workflowAuthorMatch = workflowRules?.author_match;
      const decisionAuthorMatch = decisionObserverRules?.author_match_value;
      assertPolicy(typeof workflowAuthorMatch === 'string' && workflowAuthorMatch.length > 0, 'workflow observer_rules.author_match must be a non-empty string');
      assertPolicy(typeof decisionAuthorMatch === 'string' && decisionAuthorMatch.length > 0, 'decision-rules observer_rules.author_match_value must be a non-empty string');
      assertPolicy(
        workflowAuthorMatch.trim().toLowerCase() === decisionAuthorMatch.trim().toLowerCase(),
        'author_match values differ between workflow and decision-rules contracts'
      );

      const workflowGapThreshold = toInt(workflowRules?.gap_threshold_min, 'workflow observer_rules.gap_threshold_min');
      const decisionGapThreshold = toInt(decisionObserverRules?.gap_threshold_min, 'decision-rules observer_rules.gap_threshold_min');
      assertPolicy(
        workflowGapThreshold === decisionGapThreshold,
        'gap_threshold_min differs between workflow and decision-rules contracts'
      );

      const workflowParseConfidence = toNumber(workflowRules?.parse_confidence_min, 'workflow observer_rules.parse_confidence_min');
      const decisionParseConfidence = toNumber(decisionObserverRules?.parse_confidence_min, 'decision-rules observer_rules.parse_confidence_min');
      assertPolicy(
        workflowParseConfidence === decisionParseConfidence,
        'parse_confidence_min differs between workflow and decision-rules contracts'
      );

      const workflowExcludeNotice = workflowRules?.exclude_notice_rows;
      const decisionExcludeNotice = decisionObserverRules?.notice_rows_excluded;
      assertPolicy(typeof workflowExcludeNotice === 'boolean', 'workflow observer_rules.exclude_notice_rows must be boolean');
      assertPolicy(typeof decisionExcludeNotice === 'boolean', 'decision-rules observer_rules.notice_rows_excluded must be boolean');
      assertPolicy(
        workflowExcludeNotice === decisionExcludeNotice,
        'notice-row exclusion policy differs between workflow and decision-rules contracts'
      );

      return {
        boardUrl,
        authorMatch: workflowAuthorMatch,
        specGapThresholdMin: workflowGapThreshold,
        parseConfidenceMin: workflowParseConfidence,
        excludeNoticeRows: workflowExcludeNotice
      };
    })();
  }
  return observerPolicyBasePromise;
}

export async function resolveEffectiveGapThresholdMin(specGap: number): Promise<{ value: number; source: 'file' | 'env' | 'spec' }> {
  const pin = await readPersistedGapSourcePin();
  if (pin === 'spec') {
    return { value: specGap, source: 'spec' };
  }
  const raw = process.env.OBSERVER_GAP_THRESHOLD;
  const envVal = typeof raw === 'string' && raw.trim() !== '' ? ENV.OBSERVER_GAP_THRESHOLD : null;
  if (pin === 'env') {
    return { value: envVal ?? specGap, source: envVal !== null ? 'env' : 'spec' };
  }
  // Default precedence: file → env → spec
  const persisted = await readRuntimeGapPersistedOverride();
  if (persisted !== null) return { value: persisted, source: 'file' };
  if (envVal !== null) return { value: envVal, source: 'env' };
  return { value: specGap, source: 'spec' };
}

export async function loadObserverPolicy(): Promise<ObserverPolicy> {
  const base = await loadObserverPolicyBase();
  const { value: gapThresholdMin } = await resolveEffectiveGapThresholdMin(base.specGapThresholdMin);
  return {
    boardUrl: base.boardUrl,
    authorMatch: base.authorMatch,
    gapThresholdMin,
    parseConfidenceMin: base.parseConfidenceMin,
    excludeNoticeRows: base.excludeNoticeRows
  };
}

export async function getObserverControlsWithGap(): Promise<ObserverControlsWithGap> {
  const base = await loadObserverPolicyBase();
  const [persisted, pin, resolved] = await Promise.all([
    readRuntimeGapPersistedOverride(),
    readPersistedGapSourcePin(),
    resolveEffectiveGapThresholdMin(base.specGapThresholdMin).then(r => r),
  ]);
  const raw = process.env.OBSERVER_GAP_THRESHOLD;
  return {
    ...getObserverControls(),
    gapThresholdMin: resolved.value,
    gapPersistedOverride: persisted,
    gapThresholdSpecBaseline: base.specGapThresholdMin,
    gapUsesEnvOverride: typeof raw === 'string' && raw.trim() !== '',
    gapSource: resolved.source,
    gapSourcePin: pin,
  };
}
