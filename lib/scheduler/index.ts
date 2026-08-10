/**
 * lib/scheduler/index.ts
 *
 * Barrel export for scheduler module.
 */

// Types
export type {
  BotDeps,
  ControlPanelPreset,
  AutoPublisherControls,
  ObserverPacingPatch,
  PresetConfig,
} from './types.js';

// Presets
export {
  PRESET_CONFIG,
  isHourInRange,
  clampFloat,
  normalizeAutoPublisherControls,
} from './presets.js';

// Scheduler loop
export { startScheduler } from './run.js';