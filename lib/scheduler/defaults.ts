/**
 * lib/scheduler/defaults.ts
 *
 * The single source of default scheduler controls.
 *
 * Four divergent literals used to exist (lib/scheduler/run.ts, lib/state/scheduler.ts,
 * the `balanced` preset, and an inline fallback in routes/api/control.ts). The
 * reconciliation - which value each conflicting field took, and why - is recorded in
 * .planning/initiatives/publisher-modernization/specs/active/r2-resolution-log.md.
 *
 * A second literal default set is a regression: tests/unit/schedulerDefaults.test.ts
 * asserts every consumer reads this object.
 */

import { ENV } from '../../config/env.js';
import type { AutoPublisherControls, ControlPanelPreset } from './types.js';

/**
 * Defaults applied to any scheduler control the persisted state does not supply.
 *
 * Env-derived fields stay env-derived: baking a literal here would silently ignore
 * RUN_INTERVAL_MINUTES / SCHEDULER_JITTER_* on a first boot.
 */
export const DEFAULT_SCHEDULER_CONTROLS: AutoPublisherControls & { preset: ControlPanelPreset } = {
  enabled: true,
  baseIntervalMinutes: ENV.RUN_INTERVAL_MINUTES,
  quietHoursStart: 3,
  quietHoursEnd: 5,
  quietHoursMultiplier: 1.8,
  activeHoursStart: 8,
  activeHoursEnd: 23,
  activeHoursMultiplier: 0.8,
  trendAdaptiveEnabled: true,
  trendWindowDays: 7,
  trendRecalibrationDays: 7,
  scheduleJitterPercent: ENV.SCHEDULER_JITTER_PERCENT,
  scheduleJitterMode: ENV.SCHEDULER_JITTER_MODE,
  targetPublishIntervalMinutes: 0,
  gapRecheckIntervalMinutes: 3,
  preset: 'balanced',
};

/**
 * The control fields alone, without the preset name. `AutoPublisherControls` is the
 * scheduler's own shape; `preset` belongs to the persisted state record.
 */
export function defaultAutoPublisherControls(): AutoPublisherControls {
  const { preset: _preset, ...controls } = DEFAULT_SCHEDULER_CONTROLS;
  return { ...controls };
}
