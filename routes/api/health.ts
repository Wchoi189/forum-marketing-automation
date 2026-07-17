/**
 * routes/api/health.ts
 *
 * Health and resource management routes:
 *   GET  /api/health
 *   GET  /api/health/resources
 *   POST /api/resource/gc
 */

import { Router } from 'express';
import { getResourceMetrics, checkResourceThresholds, runGarbageCollection } from '../../lib/resourceMonitor.js';

export type HealthRouterDeps = {
  invalidatePollingCaches: () => void;
};

export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'marketing-automation',
      timestamp: new Date().toISOString()
    });
  });

  router.get('/api/health/resources', async (_req, res) => {
    try {
      const metrics = await getResourceMetrics();
      const warnings = await checkResourceThresholds();
      res.json({ ...metrics, warnings });
    } catch (error) {
      res.status(500).json({ error: "Failed to get resource metrics" });
    }
  });

  router.post('/api/resource/gc', async (_req, res) => {
    try {
      const result = await runGarbageCollection();
      if (result.logRotated) deps.invalidatePollingCaches();
      res.json({
        artifacts: result.artifacts,
        logRotated: result.logRotated,
        browserProfile: result.browserProfile,
        triggeredAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to run garbage collection" });
    }
  });

  return router;
}
