/**
 * lib/state/index.ts
 *
 * Barrel export for unified state management.
 * Single source of truth for runtime state types and operations.
 */

// Types
export type {
  ObserverControls,
  ObserverControlsWithGap,
  PublisherControls,
  SchedulerControls,
  StateMeta,
} from './types.js';

export { StateVersionConflictError } from './types.js';

// Observer state
export {
  getObserverControls,
  setObserverControls,
  getDefaultObserverControls,
  loadPersistedObserverControls,
  readPersistedObserverControls,
  persistObserverControls,
  readGapPersistedOverride,
  persistGapOverride,
  readGapSourcePin,
  persistGapSourcePin,
} from './observer.js';

// Publisher state
export {
  getPublisherControls,
  setPublisherControls,
  getDefaultPublisherControls,
  loadPersistedPublisherControls,
  readPersistedPublisherControls,
  persistPublisherControls,
  persistPublishBlockedUntil,
  persistMaintenanceBlockedUntil,
} from './publisher.js';

// NL webhook state
export {
  readPersistedNlWebhookEnabled,
  persistNlWebhookEnabled,
} from './nlWebhook.js';

// Whole-panel persistence
export { persistAllControlPanelSettings } from './controlPanel.js';
export type { ControlPanelPersistInput } from './controlPanel.js';

// Scheduler state
export {
  DEFAULT_SCHEDULER_CONTROLS,
  readPersistedSchedulerControls,
  persistSchedulerControls,
} from './scheduler.js';

// Persistence primitives
export {
  readPersistedState,
  readStateMeta,
  persistState,
} from './persistence.js';
export type { PersistedStateFile } from './persistence.js';