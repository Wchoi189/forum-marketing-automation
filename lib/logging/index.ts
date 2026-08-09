/**
 * lib/logging/index.ts
 *
 * Barrel export for application logging: the pino instance and the structured
 * event-name vocabulary that goes in its `event` field.
 *
 * lib/logCache.ts is deliberately NOT part of this module. It caches
 * activity_log.json — domain records, not application diagnostics — and it
 * imports lib/resourceMonitor.ts, which imports this barrel. Folding it in
 * would make lib/logging and lib/resourceMonitor mutually importing.
 */

export { logger } from './logger.js';
export { LOG_EVENT, type LogEventName } from './events.js';
