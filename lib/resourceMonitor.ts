import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ENV } from '../config/env.js';
import { logger } from './logger.js';

const ARTIFACTS_DIR = path.join(ENV.PROJECT_ROOT, 'artifacts', 'publisher-runs');
export const MAX_ARTIFACT_AGE_DAYS = 7;
export const MAX_ACTIVITY_LOG_ENTRIES = 1000;
export const KEEP_ACTIVITY_LOG_ENTRIES = 500;
export const MAX_ARTIFACTS_SIZE_MB = 500;
/** Warn when RSS exceeds this threshold. Set to match the target 512 MB cloud host. */
export const RSS_WARN_MB = 400;

// ── Browser Profile Cache Cleanup ───────────────────────────────────────────

/**
 * Chromium subdirectories that are safe to delete.
 * These are rebuildable caches — no user data, no login sessions.
 */
const BROWSER_CACHE_DIRS = [
  'Default/Cache',
  'Default/Code Cache',
  'GPUCache',
  'Default/DawnWebGPUCache',
  'Default/DawnGraphiteCache',
  'Default/Service Worker',
  'Default/Session Storage',
  'Default/Shared Dictionary',
  'Default/Site Characteristics Database',
  'Default/WebStorage',
  'Default/IndexedDB',
  'Default/GCM Store',
  'Default/Segmentation Platform',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'component_crx_cache',
  'extensions_crx_cache',
  'segmentation_platform',
];

/** Delete rebuildable browser cache directories. Preserves Login Data, Cookies, Preferences. */
export function cleanBrowserProfile(profileDir = ENV.BOT_PROFILE_DIR): { deletedDirs: number; freedBytes: number } {
  const result = { deletedDirs: 0, freedBytes: 0 };

  for (const cacheSubdir of BROWSER_CACHE_DIRS) {
    const fullPath = path.join(profileDir, cacheSubdir);
    if (!fs.existsSync(fullPath)) continue;

    const size = dirSize(fullPath);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      result.deletedDirs++;
      result.freedBytes += size;
    } catch (err) {
      logger.warn({ event: 'resource.browser_profile_cleanup_failed', subdir: cacheSubdir, err },
        `Failed to clean browser profile cache: ${cacheSubdir}`);
    }
  }

  // Also delete loose large files in profile root (Crashpad, debug logs)
  if (fs.existsSync(profileDir)) {
    for (const file of fs.readdirSync(profileDir)) {
      if (file.startsWith('Crashpad') || file.endsWith('.log')) {
        const filePath = path.join(profileDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            fs.rmSync(filePath, { force: true });
            result.freedBytes += stat.size;
          }
        } catch { /* ignore */ }
      }
    }
  }

  if (result.deletedDirs > 0) {
    logger.info(
      { event: 'resource.browser_profile_cleaned', deleted: result.deletedDirs, bytesFreed: result.freedBytes },
      `Cleaned browser profile: ${result.deletedDirs} cache dirs removed (${formatBytes(result.freedBytes)} freed)`
    );
  }

  return result;
}

// ── Artifact Rotation ───────────────────────────────────────────────────────

interface RotationResult {
  deletedCount: number;
  deletedBytes: number;
  remainingCount: number;
  remainingBytes: number;
}

/**
 * Delete publisher-run artifact directories older than `maxAgeDays`.
 * Returns summary of what was cleaned up.
 */
export function rotateArtifacts(maxAgeDays = MAX_ARTIFACT_AGE_DAYS): RotationResult {
  const result: RotationResult = { deletedCount: 0, deletedBytes: 0, remainingCount: 0, remainingBytes: 0 };

  if (!fs.existsSync(ARTIFACTS_DIR)) return result;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(ARTIFACTS_DIR, entry.name);
    const stat = fs.statSync(dirPath);

    if (stat.mtimeMs < cutoff) {
      const size = dirSize(dirPath);
      fs.rmSync(dirPath, { recursive: true, force: true });
      result.deletedCount++;
      result.deletedBytes += size;
    } else {
      result.remainingCount++;
      result.remainingBytes += dirSize(dirPath);
    }
  }

  if (result.deletedCount > 0) {
    logger.info(
      { event: 'resource.artifacts_rotated', deleted: result.deletedCount, bytesFreed: result.deletedBytes },
      `Rotated ${result.deletedCount} artifact directories (${formatBytes(result.deletedBytes)} freed)`
    );
  }

  return result;
}

/** Enforce a hard size cap on the artifacts directory by deleting oldest first. */
export function capArtifactsBySize(maxMB = MAX_ARTIFACTS_SIZE_MB): number {
  if (!fs.existsSync(ARTIFACTS_DIR)) return 0;

  const maxBytes = maxMB * 1024 * 1024;
  const entries = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const dirPath = path.join(ARTIFACTS_DIR, e.name);
      return { name: e.name, path: dirPath, mtime: fs.statSync(dirPath).mtimeMs, size: dirSize(dirPath) };
    })
    .sort((a, b) => a.mtime - b.mtime); // oldest first

  let total = entries.reduce((sum, e) => sum + e.size, 0);
  let freed = 0;

  while (total > maxBytes && entries.length > 0) {
    const oldest = entries.shift()!;
    fs.rmSync(oldest.path, { recursive: true, force: true });
    total -= oldest.size;
    freed += oldest.size;
  }

  if (freed > 0) {
    logger.info(
      { event: 'resource.artifacts_capped', bytesFreed: freed },
      `Artifacts capped at ${maxMB}MB — freed ${formatBytes(freed)}`
    );
  }

  return freed;
}

// ── Crawlee Dataset Cleanup ─────────────────────────────────────────────────

const CRAWLEE_DATASETS_DIR = path.join(ENV.PROJECT_ROOT, 'storage', 'datasets', 'default');

/**
 * Delete all JSON files in the Crawlee default dataset directory.
 * Data is persisted to SQLite (competitor-ads.db) after each crawl run,
 * so these files are redundant intermediate artifacts.
 */
export function cleanCrawleeDatasets(): { deletedCount: number; deletedBytes: number } {
  const result = { deletedCount: 0, deletedBytes: 0 };
  if (!fs.existsSync(CRAWLEE_DATASETS_DIR)) return result;

  for (const file of fs.readdirSync(CRAWLEE_DATASETS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(CRAWLEE_DATASETS_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      fs.rmSync(filePath, { force: true });
      result.deletedCount++;
      result.deletedBytes += stat.size;
    } catch (err) {
      logger.warn({ event: 'resource.crawlee_datasets_cleanup_failed', file, err }, `Failed to delete dataset file: ${file}`);
    }
  }

  if (result.deletedCount > 0) {
    logger.info(
      { event: 'resource.crawlee_datasets_cleaned', deleted: result.deletedCount, bytesFreed: result.deletedBytes },
      `Crawlee datasets cleaned: ${result.deletedCount} files removed (${formatBytes(result.deletedBytes)} freed)`
    );
  }

  return result;
}

// ── Market Data Snapshot Rotation ───────────────────────────────────────────

const COMPETITOR_ADS_DIR = path.join(ENV.PROJECT_ROOT, 'artifacts', 'competitor-ads');
export const KEEP_MARKET_DATA_SNAPSHOTS = 2;

/**
 * Delete market-data-* snapshot directories in artifacts/competitor-ads,
 * keeping the `keepCount` most recent. Each run generates a new snapshot dir;
 * older ones are redundant once data is in SQLite.
 */
export function cleanMarketDataSnapshots(keepCount = KEEP_MARKET_DATA_SNAPSHOTS): { deletedCount: number; deletedBytes: number } {
  const result = { deletedCount: 0, deletedBytes: 0 };
  if (!fs.existsSync(COMPETITOR_ADS_DIR)) return result;

  const snapshots = fs.readdirSync(COMPETITOR_ADS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('market-data-'))
    .map(e => {
      const dirPath = path.join(COMPETITOR_ADS_DIR, e.name);
      return { name: e.name, path: dirPath, mtime: fs.statSync(dirPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime); // newest first

  const toDelete = snapshots.slice(keepCount);
  for (const snap of toDelete) {
    const size = dirSize(snap.path);
    try {
      fs.rmSync(snap.path, { recursive: true, force: true });
      result.deletedCount++;
      result.deletedBytes += size;
    } catch (err) {
      logger.warn({ event: 'resource.market_data_cleanup_failed', dir: snap.name, err }, `Failed to delete market-data snapshot: ${snap.name}`);
    }
  }

  if (result.deletedCount > 0) {
    logger.info(
      { event: 'resource.market_data_rotated', deleted: result.deletedCount, bytesFreed: result.deletedBytes, kept: keepCount },
      `Market data snapshots rotated: ${result.deletedCount} removed, kept ${keepCount} most recent (${formatBytes(result.deletedBytes)} freed)`
    );
  }

  return result;
}

// ── Session Handover Archival ────────────────────────────────────────────────

const SESSION_HANDOVERS_DIR = path.join(ENV.PROJECT_ROOT, '.agent', 'session-handovers');
const SESSION_HANDOVERS_ARCHIVE_DIR = path.join(SESSION_HANDOVERS_DIR, 'archive');
export const KEEP_SESSION_HANDOVERS = 5;

/**
 * Move old session handover JSON files to archive/, keeping the `keepCount` most recent.
 * Template files (not matching the date-stamped pattern) are always preserved.
 */
export function archiveSessionHandovers(keepCount = KEEP_SESSION_HANDOVERS): { archivedCount: number } {
  const result = { archivedCount: 0 };
  if (!fs.existsSync(SESSION_HANDOVERS_DIR)) return result;

  const DATED_PATTERN = /handover-.*-\d{8}.*\.json$/;
  const files = fs.readdirSync(SESSION_HANDOVERS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.json') && DATED_PATTERN.test(e.name))
    .map(e => {
      const filePath = path.join(SESSION_HANDOVERS_DIR, e.name);
      return { name: e.name, path: filePath, mtime: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime); // newest first

  const toArchive = files.slice(keepCount);
  if (toArchive.length === 0) return result;

  if (!fs.existsSync(SESSION_HANDOVERS_ARCHIVE_DIR)) {
    fs.mkdirSync(SESSION_HANDOVERS_ARCHIVE_DIR, { recursive: true });
  }

  for (const file of toArchive) {
    const dest = path.join(SESSION_HANDOVERS_ARCHIVE_DIR, file.name);
    try {
      fs.renameSync(file.path, dest);
      result.archivedCount++;
    } catch (err) {
      logger.warn({ event: 'resource.handover_archive_failed', file: file.name, err }, `Failed to archive handover: ${file.name}`);
    }
  }

  if (result.archivedCount > 0) {
    logger.info(
      { event: 'resource.handovers_archived', archived: result.archivedCount, kept: keepCount },
      `Session handovers archived: ${result.archivedCount} moved to archive/, kept ${keepCount} most recent`
    );
  }

  return result;
}

// ── Activity Log Rotation ───────────────────────────────────────────────────

/** Truncate activity_log.json to `keepEntries` if it exceeds `maxEntries`. */
export function rotateActivityLog(maxEntries = MAX_ACTIVITY_LOG_ENTRIES, keepEntries = KEEP_ACTIVITY_LOG_ENTRIES): number {
  const logPath = ENV.ACTIVITY_LOG_PATH;
  if (!fs.existsSync(logPath)) return 0;

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const entries: unknown[] = JSON.parse(content);
    if (!Array.isArray(entries) || entries.length <= maxEntries) return 0;

    const removed = entries.length - keepEntries;
    const trimmed = entries.slice(-keepEntries);
    fs.writeFileSync(logPath, JSON.stringify(trimmed, null, 2), 'utf-8');
    logger.info(
      { event: 'resource.log_rotated', removed, remaining: keepEntries },
      `Activity log rotated: removed ${removed} entries, kept ${keepEntries}`
    );
    return removed;
  } catch (err) {
    logger.warn({ event: 'resource.log_rotate_failed', err }, 'Failed to rotate activity log');
    return 0;
  }
}

// ── Resource Metrics ────────────────────────────────────────────────────────

export interface ResourceMetrics {
  process: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    cpuUserSec: number;
    cpuSystemSec: number;
    rssWarning: boolean;
  };
  artifacts: {
    directoryCount: number;
    totalSizeMb: number;
    exceedsSizeCap: boolean;
    oldestDays: number | null;
    newestDays: number | null;
  };
  activityLog: {
    exists: boolean;
    entryCount: number;
    exceedsMax: boolean;
    fileSizeKb: number;
  };
  browserProfile: {
    exists: boolean;
    fileCount: number;
    totalSizeMb: number;
  };
  chromiumProcesses: number;
  timestamp: string;
}

export function getResourceMetrics(): ResourceMetrics {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const rssMb = Math.round(mem.rss / 1024 / 1024);

  const now = Date.now();

  // Artifacts
  let artifacts: ResourceMetrics['artifacts'] = { directoryCount: 0, totalSizeMb: 0, exceedsSizeCap: false, oldestDays: null, newestDays: null };
  if (fs.existsSync(ARTIFACTS_DIR)) {
    const entries = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true }).filter(e => e.isDirectory());
    artifacts.directoryCount = entries.length;
    let totalSize = 0;
    let oldestMs: number | null = null;
    let newestMs: number | null = null;
    for (const e of entries) {
      const dirPath = path.join(ARTIFACTS_DIR, e.name);
      const stat = fs.statSync(dirPath);
      const size = dirSize(dirPath);
      totalSize += size;
      if (oldestMs === null || stat.mtimeMs < oldestMs) oldestMs = stat.mtimeMs;
      if (newestMs === null || stat.mtimeMs > newestMs) newestMs = stat.mtimeMs;
    }
    artifacts.totalSizeMb = Math.round(totalSize / 1024 / 1024);
    artifacts.exceedsSizeCap = totalSize > MAX_ARTIFACTS_SIZE_MB * 1024 * 1024;
    artifacts.oldestDays = oldestMs !== null ? Math.round((now - oldestMs) / (24 * 60 * 60 * 1000)) : null;
    artifacts.newestDays = newestMs !== null ? Math.round((now - newestMs) / (24 * 60 * 60 * 1000)) : null;
  }

  // Activity log
  let activityLog: ResourceMetrics['activityLog'] = { exists: false, entryCount: 0, exceedsMax: false, fileSizeKb: 0 };
  if (fs.existsSync(ENV.ACTIVITY_LOG_PATH)) {
    try {
      const content = fs.readFileSync(ENV.ACTIVITY_LOG_PATH, 'utf-8');
      const entries: unknown[] = JSON.parse(content);
      activityLog.exists = true;
      activityLog.entryCount = Array.isArray(entries) ? entries.length : 0;
      activityLog.exceedsMax = activityLog.entryCount > MAX_ACTIVITY_LOG_ENTRIES;
      activityLog.fileSizeKb = Math.round(content.length / 1024);
    } catch { /* corrupted log, ignore */ }
  }

  // Browser profile
  let browserProfile: ResourceMetrics['browserProfile'] = { exists: false, fileCount: 0, totalSizeMb: 0 };
  if (fs.existsSync(ENV.BOT_PROFILE_DIR)) {
    const count = countFiles(ENV.BOT_PROFILE_DIR);
    const size = dirSize(ENV.BOT_PROFILE_DIR);
    browserProfile.exists = true;
    browserProfile.fileCount = count;
    browserProfile.totalSizeMb = Math.round(size / 1024 / 1024);
  }

  // Chromium process count (exclude our own)
  let chromiumCount = 0;
  try {
    const output = execSync('pgrep -f "chromium\\|chrome-headless-shell"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const pids = output.trim().split('\n').filter(Boolean);
    // Simple count — can't easily filter our children here without spawning more
    chromiumCount = pids.length;
  } catch { /* pgrep not available */ }

  return {
    process: {
      rssMb,
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
      cpuUserSec: Math.round(cpu.user / 1_000_000 * 100) / 100,
      cpuSystemSec: Math.round(cpu.system / 1_000_000 * 100) / 100,
      rssWarning: rssMb > RSS_WARN_MB,
    },
    artifacts,
    activityLog,
    browserProfile,
    chromiumProcesses: chromiumCount,
    timestamp: new Date().toISOString(),
  };
}

/** Log warnings when resource thresholds are exceeded. */
export function checkResourceThresholds(): string[] {
  const m = getResourceMetrics();
  const warnings: string[] = [];

  if (m.process.rssWarning) warnings.push(`RSS is ${m.process.rssMb}MB (threshold: ${RSS_WARN_MB}MB)`);
  if (m.artifacts.exceedsSizeCap) warnings.push(`Artifacts ${m.artifacts.totalSizeMb}MB exceeds ${MAX_ARTIFACTS_SIZE_MB}MB cap`);
  if (m.activityLog.exceedsMax) warnings.push(`Activity log has ${m.activityLog.entryCount} entries (max: ${MAX_ACTIVITY_LOG_ENTRIES})`);
  if (m.browserProfile.fileCount > 50_000) warnings.push(`Browser profile has ${m.browserProfile.fileCount} files (threshold: 50,000)`);
  if (m.chromiumProcesses > 6) warnings.push(`${m.chromiumProcesses} Chromium processes detected (threshold: 6)`);

  if (warnings.length > 0) {
    logger.warn({ event: 'resource.threshold_warnings', warnings }, `Resource threshold warnings: ${warnings.join('; ')}`);
  }

  return warnings;
}

import { closeSharedBrowser, activeContexts, isSharedBrowserReady } from './sharedBrowser.js';

/** Run all garbage collection tasks. Returns summary of what was cleaned. */
export function runGarbageCollection(): {
  artifacts: RotationResult;
  logRotated: number;
  browserProfile: { deletedDirs: number; freedBytes: number };
  browserRecycled: boolean;
  crawleeDatasets: { deletedCount: number; deletedBytes: number };
  marketDataSnapshots: { deletedCount: number; deletedBytes: number };
  sessionHandovers: { archivedCount: number };
} {
  const artifacts = rotateArtifacts();
  const logRotated = rotateActivityLog();
  const browserProfile = cleanBrowserProfile();
  const crawleeDatasets = cleanCrawleeDatasets();
  const marketDataSnapshots = cleanMarketDataSnapshots();
  const sessionHandovers = archiveSessionHandovers();

  let browserRecycled = false;
  if (isSharedBrowserReady() && activeContexts.size === 0) {
    logger.info({ event: 'resource.gc_browser_recycle' }, '[ResourceMonitor] Recycling idle shared browser during GC to reclaim memory');
    closeSharedBrowser().catch(err => {
      logger.warn({ event: 'resource.gc_browser_recycle_failed', err }, 'Failed to close shared browser during GC');
    });
    browserRecycled = true;
  }

  return { artifacts, logRotated, browserProfile, browserRecycled, crawleeDatasets, marketDataSnapshots, sessionHandovers };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) {
        total += fs.statSync(path.join(entry.parentPath || dir, entry.name)).size;
      }
    }
  } catch { /* permission error or race, ignore */ }
  return total;
}

function countFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) count++;
    }
  } catch { /* permission error or race, ignore */ }
  return count;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
