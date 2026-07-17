import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);
import { ENV } from '../config/env.js';
import { logger } from './logger.js';

const ARTIFACTS_DIR = path.join(ENV.ARTIFACTS_DIR, 'publisher-runs');
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
export async function cleanBrowserProfile(profileDir = ENV.BOT_PROFILE_DIR): Promise<{ deletedDirs: number; freedBytes: number }> {
  const result = { deletedDirs: 0, freedBytes: 0 };

  for (const cacheSubdir of BROWSER_CACHE_DIRS) {
    const fullPath = path.join(profileDir, cacheSubdir);
    if (!fs.existsSync(fullPath)) continue;

    const size = await dirSize(fullPath);
    try {
      await fs.promises.rm(fullPath, { recursive: true, force: true });
      result.deletedDirs++;
      result.freedBytes += size;
    } catch (err) {
      logger.warn({ event: 'resource.browser_profile_cleanup_failed', subdir: cacheSubdir, err },
        `Failed to clean browser profile cache: ${cacheSubdir}`);
    }
  }

  // Also delete loose large files in profile root (Crashpad, debug logs)
  if (fs.existsSync(profileDir)) {
    const files = await fs.promises.readdir(profileDir);
    for (const file of files) {
      if (file.startsWith('Crashpad') || file.endsWith('.log')) {
        const filePath = path.join(profileDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isFile()) {
            await fs.promises.rm(filePath, { force: true });
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
export async function rotateArtifacts(maxAgeDays = MAX_ARTIFACT_AGE_DAYS): Promise<RotationResult> {
  const result: RotationResult = { deletedCount: 0, deletedBytes: 0, remainingCount: 0, remainingBytes: 0 };

  if (!fs.existsSync(ARTIFACTS_DIR)) return result;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(ARTIFACTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(ARTIFACTS_DIR, entry.name);
    const stat = await fs.promises.stat(dirPath);

    if (stat.mtimeMs < cutoff) {
      const size = await dirSize(dirPath);
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      result.deletedCount++;
      result.deletedBytes += size;
    } else {
      result.remainingCount++;
      result.remainingBytes += await dirSize(dirPath);
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
export async function capArtifactsBySize(maxMB = MAX_ARTIFACTS_SIZE_MB): Promise<number> {
  if (!fs.existsSync(ARTIFACTS_DIR)) return 0;

  const maxBytes = maxMB * 1024 * 1024;
  const entriesRaw = await fs.promises.readdir(ARTIFACTS_DIR, { withFileTypes: true });
  
  const entries = [];
  for (const e of entriesRaw) {
    if (!e.isDirectory()) continue;
    const dirPath = path.join(ARTIFACTS_DIR, e.name);
    const mtime = (await fs.promises.stat(dirPath)).mtimeMs;
    const size = await dirSize(dirPath);
    entries.push({ name: e.name, path: dirPath, mtime, size });
  }
  
  entries.sort((a, b) => a.mtime - b.mtime); // oldest first

  let total = entries.reduce((sum, e) => sum + e.size, 0);
  let freed = 0;

  while (total > maxBytes && entries.length > 0) {
    const oldest = entries.shift()!;
    await fs.promises.rm(oldest.path, { recursive: true, force: true });
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

// ── Activity Log Rotation ───────────────────────────────────────────────────

/** Truncate activity_log.json to `keepEntries` if it exceeds `maxEntries`. */
export async function rotateActivityLog(maxEntries = MAX_ACTIVITY_LOG_ENTRIES, keepEntries = KEEP_ACTIVITY_LOG_ENTRIES): Promise<number> {
  const logPath = ENV.ACTIVITY_LOG_PATH;
  if (!fs.existsSync(logPath)) return 0;

  try {
    const content = await fs.promises.readFile(logPath, 'utf-8');
    const entries: unknown[] = JSON.parse(content);
    if (!Array.isArray(entries) || entries.length <= maxEntries) return 0;

    const removed = entries.length - keepEntries;
    const trimmed = entries.slice(-keepEntries);
    await fs.promises.writeFile(logPath, JSON.stringify(trimmed, null, 2), 'utf-8');
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

export async function getResourceMetrics(): Promise<ResourceMetrics> {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const rssMb = Math.round(mem.rss / 1024 / 1024);

  const now = Date.now();

  // Artifacts
  let artifacts: ResourceMetrics['artifacts'] = { directoryCount: 0, totalSizeMb: 0, exceedsSizeCap: false, oldestDays: null, newestDays: null };
  if (fs.existsSync(ARTIFACTS_DIR)) {
    const entries = await fs.promises.readdir(ARTIFACTS_DIR, { withFileTypes: true });
    let totalSize = 0;
    let oldestMs: number | null = null;
    let newestMs: number | null = null;
    let dirCount = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      dirCount++;
      const dirPath = path.join(ARTIFACTS_DIR, e.name);
      const stat = await fs.promises.stat(dirPath);
      const size = await dirSize(dirPath);
      totalSize += size;
      if (oldestMs === null || stat.mtimeMs < oldestMs) oldestMs = stat.mtimeMs;
      if (newestMs === null || stat.mtimeMs > newestMs) newestMs = stat.mtimeMs;
    }
    artifacts.directoryCount = dirCount;
    artifacts.totalSizeMb = Math.round(totalSize / 1024 / 1024);
    artifacts.exceedsSizeCap = totalSize > MAX_ARTIFACTS_SIZE_MB * 1024 * 1024;
    artifacts.oldestDays = oldestMs !== null ? Math.round((now - oldestMs) / (24 * 60 * 60 * 1000)) : null;
    artifacts.newestDays = newestMs !== null ? Math.round((now - newestMs) / (24 * 60 * 60 * 1000)) : null;
  }

  // Activity log
  let activityLog: ResourceMetrics['activityLog'] = { exists: false, entryCount: 0, exceedsMax: false, fileSizeKb: 0 };
  if (fs.existsSync(ENV.ACTIVITY_LOG_PATH)) {
    try {
      const content = await fs.promises.readFile(ENV.ACTIVITY_LOG_PATH, 'utf-8');
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
    const count = await countFiles(ENV.BOT_PROFILE_DIR);
    const size = await dirSize(ENV.BOT_PROFILE_DIR);
    browserProfile.exists = true;
    browserProfile.fileCount = count;
    browserProfile.totalSizeMb = Math.round(size / 1024 / 1024);
  }

  // Chromium process count (exclude our own)
  let chromiumCount = 0;
  try {
    const { stdout } = await execAsync('pgrep -f "chromium\\|chrome-headless-shell"');
    const pids = stdout.trim().split('\n').filter(Boolean);
    // Simple count — can't easily filter our children here without spawning more
    chromiumCount = pids.length;
  } catch { /* pgrep not available or matched nothing */ }

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
export async function checkResourceThresholds(): Promise<string[]> {
  const m = await getResourceMetrics();
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
export async function runGarbageCollection(): Promise<{
  artifacts: RotationResult;
  logRotated: number;
  browserProfile: { deletedDirs: number; freedBytes: number };
  browserRecycled: boolean;
}> {
  const artifacts = await rotateArtifacts();
  await capArtifactsBySize(); // Enforce 500MB size limit
  const logRotated = await rotateActivityLog();
  const browserProfile = await cleanBrowserProfile();

  let browserRecycled = false;
  if (isSharedBrowserReady() && activeContexts.size === 0) {
    logger.info({ event: 'resource.gc_browser_recycle' }, '[ResourceMonitor] Recycling idle shared browser during GC to reclaim memory');
    closeSharedBrowser().catch(err => {
      logger.warn({ event: 'resource.gc_browser_recycle_failed', err }, 'Failed to close shared browser during GC');
    });
    browserRecycled = true;
  }

  return { artifacts, logRotated, browserProfile, browserRecycled };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function dirSize(dir: string): Promise<number> {
  if (!fs.existsSync(dir)) return 0;
  try {
    const { stdout } = await execAsync(`du -sb "${dir}"`);
    return parseInt(stdout.split('\\t')[0], 10);
  } catch {
    return 0; // Fallback or permission error
  }
}

async function countFiles(dir: string): Promise<number> {
  if (!fs.existsSync(dir)) return 0;
  try {
    const { stdout } = await execAsync(`find "${dir}" -type f | wc -l`);
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
