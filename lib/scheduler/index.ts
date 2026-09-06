/**
 * lib/scheduler/index.ts
 *
 * Barrel export for scheduler module.
 *
 * `./defaults.js` is exported before `./run.js` on purpose: lib/state reads
 * DEFAULT_SCHEDULER_CONTROLS from here while run.ts reads block state back out of
 * lib/state, and evaluating the dependency-free defaults first keeps that cycle
 * harmless.
 */

// Types
export type {
  BotDeps,
  ControlPanelPreset,
  AutoPublisherControls,
  ObserverPacingPatch,
  PresetConfig,
  SchedulerTickOutcome,
} from './types.js';

// Defaults — the single source. Must precede ./run.js.
export { DEFAULT_SCHEDULER_CONTROLS, defaultAutoPublisherControls } from './defaults.js';

// Scheduling decision
export {
  nextAttemptAt,
  ERROR_BACKOFF_MINUTES,
  ALREADY_RUNNING_RETRY_MINUTES,
  BLOCK_BUFFER_MINUTES,
  BLOCK_FIELDS,
} from './nextAttempt.js';
export type { AttemptReason, NextAttempt, NextAttemptInput, BlockField } from './nextAttempt.js';

// Presets
export {
  PRESET_CONFIG,
  isHourInRange,
  clampFloat,
  normalizeAutoPublisherControls,
} from './presets.js';

// Scheduler loop
export { startScheduler } from './run.js';
