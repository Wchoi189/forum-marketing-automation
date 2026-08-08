/**
 * Observer module barrel export.
 *
 * Main exports for board observation and parsing.
 */

// Core run function
export { runObserver } from './observerRun.js';

// Board parsing
export type { ParsedBoardRow } from './boardParser.js';
export { parseBoardRows } from './boardParser.js';

// Policy loading
export type { ObserverPolicy, ObserverPolicyBase } from './policyLoader.js';
export { loadObserverPolicyBase, loadObserverPolicy, resolveEffectiveGapThresholdMin, getObserverControlsWithGap } from './policyLoader.js';

// Diagnostics
export type { BoardDiagnostics } from './boardDiagnostics.js';
export { getBoardDiagnostics, attemptPpomppuLoginFromBoard } from './boardDiagnostics.js';

// Parser signal
export type { ParserSignal, ParserBundle } from './parserSignal.js';
export { PARSER_OPTIONS, createManualReviewMessage, combinedConfidence, collectParserSignal, captureBoardRowRegionArtifact } from './parserSignal.js';