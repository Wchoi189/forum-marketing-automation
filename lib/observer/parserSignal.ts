/**
 * lib/observer/parserSignal.ts
 *
 * Parser signal collection — runs the custom DOM subtree parser on a live page
 * and computes diff and confidence metrics.
 *
 * `previousBoardSnapshot` is module-level state: it persists between observer
 * runs so snapshotDiff can detect board changes. Do not extract this state
 * out of this module without verifying diff semantics are preserved.
 */

import path from 'path';
import fs from 'fs/promises';
import { ENV } from '../../config/env.js';
import { logger } from '../logger.js';
import { pageOutline, snapshotDiff, subtree, type ProjectedNode, type ProjectedSnapshot } from '../parser/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParserSignal = {
  projectedRowCount: number;
  parserConfidence: number;
  warnings: string[];
  diffSummary: { added: number; removed: number; changed: number };
};

export const PARSER_OPTIONS = {
  maxDepth: 6,
  maxSiblingsPerNode: 80,
  maxTotalNodes: 750,
  maxTextLengthPerNode: 200
} as const;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let previousBoardSnapshot: ProjectedSnapshot | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function flattenProjectedNodes(nodes: ProjectedNode[]): ProjectedNode[] {
  const output: ProjectedNode[] = [];
  const visit = (node: ProjectedNode) => {
    output.push(node);
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return output;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createManualReviewMessage(parseConfidence: number, parseConfidenceMin: number): string {
  return `MANUAL_REVIEW_REQUIRED: parse confidence ${parseConfidence.toFixed(2)} is below ${parseConfidenceMin.toFixed(2)}`;
}

export function combinedConfidence(legacyConfidence: number, parserConfidence: number): number {
  return Number(Math.min(legacyConfidence, parserConfidence).toFixed(2));
}

export type ParserBundle = {
  signal: ParserSignal;
  snapshot: ProjectedSnapshot;
  outline: Awaited<ReturnType<typeof pageOutline>>;
};

export async function collectParserSignal(page: import('playwright').Page): Promise<ParserBundle> {
  if (!ENV.CUSTOM_PARSER_ENABLED) {
    // Return minimal data when parser is disabled
    logger.debug({ event: 'parser_disabled' }, '[Parser] Parser is disabled via environment variable');
    return {
      signal: {
        projectedRowCount: 0,
        parserConfidence: 0,
        warnings: ['parser_disabled'],
        diffSummary: { added: 0, removed: 0, changed: 0 }
      },
      snapshot: {
        capturedAt: new Date().toISOString(),
        url: page.url(),
        title: await page.title().catch(() => 'N/A'),
        rootSelector: null,
        nodes: [],
        stats: {
          nodesScanned: 0,
          nodesEmitted: 0,
          truncatedDepth: false,
          truncatedNodes: false,
          truncatedSiblings: false
        },
        confidence: 0,
        warnings: ['parser_disabled']
      },
      outline: {
        url: page.url(),
        title: await page.title().catch(() => 'N/A'),
        landmarks: [],
        headings: [],
        forms: [],
        interactives: [],
        stats: {
          nodesScanned: 0,
          nodesEmitted: 0,
          truncatedDepth: false,
          truncatedNodes: false,
          truncatedSiblings: false
        },
        confidence: 0,
        warnings: ['parser_disabled']
      }
    };
  }

  const startTime = Date.now();
  if (ENV.LOG_LEVEL === 'debug' || ENV.PARSER_DETAILED_LOGGING) {
    logger.debug({ event: 'parser_start' }, '[Parser] Starting subtree projection');
  }

  const snapshot = await subtree(page, 'table#revolution_main_table, form[name="bbs_list"], body', PARSER_OPTIONS);
  const outline = await pageOutline(page, { ...PARSER_OPTIONS, maxDepth: 4, maxTotalNodes: 260 });
  const rowLikeCount = flattenProjectedNodes(snapshot.nodes).filter((node) => node.tag === 'tr').length;
  const diff = snapshotDiff(previousBoardSnapshot, snapshot);
  previousBoardSnapshot = snapshot;

  const duration = Date.now() - startTime;

  if (ENV.LOG_LEVEL === 'debug' || ENV.PARSER_DETAILED_LOGGING) {
    logger.debug({
      event: 'parser_complete',
      durationMs: duration,
      nodeCount: snapshot.stats.nodesEmitted,
      nodeScanCount: snapshot.stats.nodesScanned,
      confidence: snapshot.confidence,
      warnings: snapshot.warnings,
      rowLikeCount,
      diffSummary: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length },
      truncated: {
        depth: snapshot.stats.truncatedDepth,
        nodes: snapshot.stats.truncatedNodes,
        siblings: snapshot.stats.truncatedSiblings
      }
    }, `[Parser] Subtree projection completed in ${duration}ms`);
  }

  return {
    signal: {
      projectedRowCount: rowLikeCount,
      parserConfidence: snapshot.confidence,
      warnings: snapshot.warnings,
      diffSummary: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }
    },
    snapshot,
    outline
  };
}

export async function captureBoardRowRegionArtifact(
  page: import('playwright').Page,
  reason: string,
  parserBundle?: ParserBundle
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.join(ENV.PROJECT_ROOT, 'artifacts', 'board-diagnostics');
  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `board-row-region-${timestamp}.json`);

  const diagnostic = await page.evaluate(() => {
    const selectorCounts = {
      rowLegacy: document.querySelectorAll('tr.list0, tr.list1').length,
      rowCurrent: document.querySelectorAll('tr.common-list0, tr.common-list1').length,
      rowAlt: document.querySelectorAll('tr[class*="list"]').length,
      boardTables: document.querySelectorAll('table').length,
      boardLinks: document.querySelectorAll('a[href*="no="], a[href*="zboard.php?id="]').length
    };

    return {
      selectorCounts,
      bodyExcerpt: document.body?.innerText?.slice(0, 4000) ?? ''
    };
  });

  const parserResult =
    parserBundle ??
    (await collectParserSignal(page).catch(() => ({
      signal: {
        projectedRowCount: 0,
        parserConfidence: 0,
        warnings: ['parser_collection_failed'],
        diffSummary: { added: 0, removed: 0, changed: 0 }
      },
      snapshot: null,
      outline: null
    })));

  const payload = {
    capturedAt: new Date().toISOString(),
    reason,
    url: page.url(),
    title: await page.title().catch(() => 'N/A'),
    ...diagnostic,
    parserSignal: parserResult.signal,
    projectionSnapshot: (parserResult as ParserBundle).snapshot ?? null,
    projectionOutline: (parserResult as ParserBundle).outline ?? null
  };

  await fs.writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf-8');
  return artifactPath;
}
