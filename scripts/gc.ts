#!/usr/bin/env tsx
/**
 * Standalone GC runner — no server required.
 * Usage: npm run gc
 *        PROJECT_ROOT=. tsx scripts/gc.ts
 */
import { runGarbageCollection, getResourceMetrics } from '../lib/resourceMonitor.js';

const before = getResourceMetrics();
console.log('--- Before GC ---');
console.log(`  publisher-runs:    ${before.artifacts.totalSizeMb}MB (${before.artifacts.directoryCount} dirs)`);
console.log(`  activity-log:      ${before.activityLog.entryCount} entries`);

const result = runGarbageCollection();

console.log('\n--- GC Results ---');
console.log(`  publisher-runs:    ${result.artifacts.deletedCount} dirs deleted (${(result.artifacts.deletedBytes / 1024 / 1024).toFixed(1)}MB)`);
console.log(`  crawlee datasets:  ${result.crawleeDatasets.deletedCount} files deleted (${(result.crawleeDatasets.deletedBytes / 1024).toFixed(0)}KB)`);
console.log(`  market-data:       ${result.marketDataSnapshots.deletedCount} dirs deleted (${(result.marketDataSnapshots.deletedBytes / 1024 / 1024).toFixed(1)}MB)`);
console.log(`  activity-log:      ${result.logRotated} entries rotated`);
console.log(`  browser cache:     ${result.browserProfile.deletedDirs} dirs deleted (${(result.browserProfile.freedBytes / 1024 / 1024).toFixed(1)}MB)`);
console.log(`  session handovers: ${result.sessionHandovers.archivedCount} archived`);
console.log(`  browser recycled:  ${result.browserRecycled}`);
