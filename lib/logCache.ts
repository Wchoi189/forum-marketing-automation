import fs from 'fs';
import type { ActivityLog } from '../lib/models.js';
import { KEEP_ACTIVITY_LOG_ENTRIES } from './resourceMonitor.js';

/**
 * Shared in-memory cache for activity_log.json.
 * Replaces per-call fs.readFile + JSON.parse with TTL-based invalidation.
 *
 * Used by both the scheduler (via deps.getLogs) and server API endpoints.
 */
export class LogCache {
  private logs: ActivityLog[] | null = null;
  private expiresAt = 0;

  constructor(
    private logFilePath: string,
    private ttlMs: number = 15_000,
    private maxEntries: number = KEEP_ACTIVITY_LOG_ENTRIES,
  ) {}

  /** Return cached logs, or read+parse from disk if expired. */
  get(): ActivityLog[] {
    if (this.logs !== null && Date.now() < this.expiresAt) {
      return this.logs;
    }
    try {
      const data = fs.readFileSync(this.logFilePath, 'utf-8');
      const parsed: ActivityLog[] = JSON.parse(data);
      this.logs = parsed.slice(-this.maxEntries);
    } catch {
      this.logs = [];
    }
    this.expiresAt = Date.now() + this.ttlMs;
    return this.logs;
  }

  /** Force next call to re-read from disk. */
  invalidate() {
    this.logs = null;
    this.expiresAt = 0;
  }
}

// Shared singleton instance — created by bot.ts at module init.
let sharedCache: LogCache | null = null;

export function getSharedLogCache(): LogCache {
  if (!sharedCache) {
    throw new Error('LogCache not initialized — call initSharedLogCache() first');
  }
  return sharedCache;
}

export function initSharedLogCache(filePath: string, ttlMs?: number): LogCache {
  sharedCache = new LogCache(filePath, ttlMs);
  return sharedCache;
}
