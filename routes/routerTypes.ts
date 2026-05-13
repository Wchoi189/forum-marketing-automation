/**
 * routes/routerTypes.ts
 *
 * Shared type aliases for router dependencies so each route module can import
 * the SchedulerController type without a circular dependency on server.ts.
 */

import type { startScheduler } from '../lib/scheduler.js';

export type SchedulerController = ReturnType<typeof startScheduler>;
