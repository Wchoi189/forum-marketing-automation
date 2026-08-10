/**
 * lib/analytics/boardStats.ts
 *
 * The two small board summaries the dashboard header shows: per-author posting
 * frequency over the last week (GET /api/competitor-stats) and the
 * turnover-rate / share-of-voice pair from the two most recent snapshots
 * (GET /api/board-stats).
 *
 * `logs` is newest-first — that is the order lib/observer/observerRun.ts
 * writes activity_log.json in, and both functions depend on it.
 */

import type { ActivityLog, BoardStats, CompetitorStat } from '../../contracts/models.js';

/** Rows returned by /api/competitor-stats, always including us. */
export const COMPETITOR_STATS_ROW_LIMIT = 10;

/** Placeholder shown when we have not posted inside the window. */
const OUR_AUTHOR_FALLBACK_LABEL = 'SharePlan';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BoardStatsOptions {
  /** Case-insensitive substring identifying our own posts. ENV.OUR_AUTHOR_SUBSTRING. */
  ourAuthorSubstring: string;
}

export interface CompetitorStatsOptions extends BoardStatsOptions {
  nowMs?: number;
}

/**
 * Posting frequency and average views per author over the trailing week.
 *
 * Deduplicates within a snapshot on title+author, not across snapshots: a post
 * visible in five consecutive observer runs counts five times. The number is a
 * board-presence measure, not a post count.
 *
 * Our own row is always present — appended, or swapped in for the tenth
 * competitor when the top ten does not already contain us.
 */
export function buildCompetitorStats(logs: ActivityLog[], options: CompetitorStatsOptions): CompetitorStat[] {
  const cutoffMs = (options.nowMs ?? Date.now()) - ONE_WEEK_MS;
  const stats: Record<string, { count: number; totalViews: number }> = {};

  for (const log of logs) {
    if (new Date(log.timestamp).getTime() < cutoffMs) continue;
    if (!log.all_posts) continue;

    const uniquePostsInSnapshot = new Set<string>();
    for (const post of log.all_posts) {
      const key = post.title + post.author;
      if (uniquePostsInSnapshot.has(key)) continue;
      if (!stats[post.author]) {
        stats[post.author] = { count: 0, totalViews: 0 };
      }
      stats[post.author].count++;
      stats[post.author].totalViews += post.views;
      uniquePostsInSnapshot.add(key);
    }
  }

  const result = Object.entries(stats)
    .map(([author, s]) => ({
      author,
      frequency: s.count,
      avgViews: Math.round(s.totalViews / s.count),
    }))
    .sort((a, b) => b.frequency - a.frequency);

  const isOurAuthor = (author: string) => author.toLowerCase().includes(options.ourAuthorSubstring.toLowerCase());
  const ourRow = result.find((row) => isOurAuthor(row.author)) ?? {
    author: OUR_AUTHOR_FALLBACK_LABEL,
    frequency: 0,
    avgViews: 0,
  };

  const top = result.slice(0, COMPETITOR_STATS_ROW_LIMIT);
  if (top.some((row) => isOurAuthor(row.author))) return top;
  if (top.length < COMPETITOR_STATS_ROW_LIMIT) return [...top, ourRow];
  return [...top.slice(0, COMPETITOR_STATS_ROW_LIMIT - 1), ourRow];
}

/**
 * Board turnover (new posts per hour) and our share of voice, from the two most
 * recent snapshots only. Returns zeroes when there is nothing to diff against.
 */
export function buildBoardStats(logs: ActivityLog[], options: BoardStatsOptions): BoardStats {
  if (logs.length < 2) return { turnoverRate: 0, shareOfVoice: 0 };

  const latest = logs[0];
  const previous = logs[1];

  const prevKeys = new Set(previous.all_posts?.map((p) => p.title + p.author) ?? []);
  const newPosts = latest.all_posts?.filter((p) => !prevKeys.has(p.title + p.author)).length ?? 0;

  const timeDiffHours =
    (new Date(latest.timestamp).getTime() - new Date(previous.timestamp).getTime()) / (1000 * 60 * 60);
  const turnoverRate = timeDiffHours > 0 ? (newPosts / timeDiffHours).toFixed(1) : 0;

  const needle = options.ourAuthorSubstring.toLowerCase();
  const ourPosts = latest.all_posts?.filter((p) => p.author.toLowerCase().includes(needle)).length ?? 0;
  const shareOfVoice = latest.all_posts?.length ? Math.round((ourPosts / latest.all_posts.length) * 100) : 0;

  return { turnoverRate, shareOfVoice };
}
