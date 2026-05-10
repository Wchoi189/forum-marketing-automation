/**
 * SQLite adapter — syncs Crawlee Dataset items into the competitor-ads database.
 *
 * Extracted from scripts/competitor-ads-intel.ts to avoid duplication
 * and make the sync path testable.
 */

import { Dataset } from "crawlee";
import { openDatabase, isRecordKnown, insertRecord, upsertVendorProfile } from "../../competitor-ad-sqlite.js";
import { exportDatasetToJsonlGz } from "./jsonl-export.js";
import type { Database } from "../../competitor-ad-sqlite.js";

export type SyncResult = {
  /** Records successfully inserted into SQLite */
  successCount: number;
  /** Records that failed to insert */
  errors: Array<{ post_url: string; reason: string }>;
  /** Number of items exported to JSONL */
  exportedCount: number;
};

/**
 * Iterate all items in the Crawlee Dataset, export to gzip JSONL,
 * then insert each into SQLite with vendor profile upsert.
 */
export async function syncDatasetToSqlite(
  db: Database,
  runId: string,
  outputPath: string,
): Promise<SyncResult> {
  const { count: exportedCount } = await exportDatasetToJsonlGz(outputPath);

  const ds = await Dataset.open();
  const items = await ds.export();
  let successCount = 0;
  const errors: Array<{ post_url: string; reason: string }> = [];

  for (const item of items) {
    const record = item as Record<string, unknown>;
    try {
      const products = (record.products as Array<{ name: string }>) ?? [];
      insertRecord(db, {
        record_id: record.record_id as string,
        run_id: record.run_id as string,
        vendor: record.vendor as string,
        author_name: record.author_name as string | undefined,
        post_url: record.post_url as string,
        post_title: record.post_title as string,
        posted_at: record.posted_at as string,
        captured_at: record.captured_at as string,
        products,
        productsFull: record.products as unknown[],
        extraction_source: record.extraction_source as string | undefined,
        confidence: record.confidence as number | undefined,
        account_type: record.account_type as string | undefined,
      });

      const productNames = (record.products as Array<{ name: string }>) ?? [];
      upsertVendorProfile(db, record.vendor as string, {
        author_name: record.author_name as string | undefined,
        post_url: record.post_url as string,
        posted_at: record.posted_at as string,
        product_names: productNames.map((p) => p.name),
      });
      successCount += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({
        post_url: (record.post_url as string) ?? "unknown",
        reason,
      });
    }
  }

  return { successCount, errors, exportedCount };
}

/**
 * Open a fresh database and return it with an `isKnown` helper bound to it.
 * Convenience wrapper for callers that need both.
 */
export function openWithKnownCheck(): {
  db: Database;
  isKnown: (recordId: string) => boolean;
} {
  const db = openDatabase();
  return { db, isKnown: (recordId: string) => isRecordKnown(db, recordId) };
}
