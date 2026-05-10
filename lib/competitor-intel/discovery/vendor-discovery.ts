/**
 * Vendor discovery — scan → filter → queue orchestration.
 *
 * Takes discovered BoardPost entries from the board scanner,
 * deduplicates against SQLite, and enqueues into a Crawlee RequestQueue
 * for the PlaywrightCrawler extraction pipeline.
 */

import type { RequestQueue } from "crawlee";
import type { BoardPost } from "./board-scanner.js";
import { recordIdFrom, postIdFromUrl } from "../storage/record-builder.js";

type VendorDiscoveryOptions = {
  posts: BoardPost[];
  queue: RequestQueue;
  runId: string;
  vendor?: string;
  /** Check function: returns true if record should be skipped */
  isRecordKnown?: (recordId: string) => boolean;
};

export type DiscoveryResult = {
  /** Total posts discovered from board scan */
  discovered: number;
  /** Posts already in DB and skipped */
  skipped: number;
  /** Posts enqueued for crawling */
  enqueued: number;
  /** Vendor author names discovered */
  authors: string[];
};

/**
 * Filter discovered posts against known records, enqueue new ones,
 * and return a summary of what happened.
 */
export async function discoverAndEnqueue(opts: VendorDiscoveryOptions): Promise<DiscoveryResult> {
  const { posts, queue, runId, vendor = "ppomppu" } = opts;
  const isKnown = opts.isRecordKnown ?? (() => false);

  let skipped = 0;
  let enqueued = 0;
  const authors = new Set<string>();

  for (const post of posts) {
    authors.add(post.authorName);
    const recordId = recordIdFrom(post.postUrl, vendor);

    if (isKnown(recordId)) {
      console.log(`  [discovery] skipping ${postIdFromUrl(post.postUrl)} (already in DB)`);
      skipped++;
      continue;
    }

    await queue.addRequest({
      url: post.postUrl,
      uniqueKey: `${vendor}|${post.postUrl}`,
      userData: {
        runId,
        authorName: post.authorName,
        postTitle: post.postTitle,
        discoveredFromBoard: true,
      },
    });
    enqueued++;
  }

  return {
    discovered: posts.length,
    skipped,
    enqueued,
    authors: Array.from(authors),
  };
}

/**
 * Group discovered posts by author name for reporting.
 */
export function groupByAuthor(posts: BoardPost[]): Map<string, BoardPost[]> {
  const groups = new Map<string, BoardPost[]>();
  for (const post of posts) {
    const existing = groups.get(post.authorName) ?? [];
    existing.push(post);
    groups.set(post.authorName, existing);
  }
  return groups;
}
