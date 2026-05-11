/**
 * Re-import the live-crawl JSONL data into SQLite after the DB wipe.
 * Reads records.jsonl.gz and inserts each record + upserts vendor profiles.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { openDatabase, insertRecord, upsertVendorProfile } from "../lib/competitor-ad-sqlite.js";

const JSONL_PATH = "artifacts/competitor-ads/live-20260511/data/records.jsonl.gz";

const lines = zlib
  .gunzipSync(fs.readFileSync(JSONL_PATH))
  .toString("utf8")
  .split("\n")
  .filter((l) => l.trim());

const db = openDatabase();
let inserted = 0;
let skipped = 0;
const errors: string[] = [];

for (const line of lines) {
  const rec = JSON.parse(line) as Record<string, unknown>;
  try {
    const products = (rec.products as Array<{ name: string }>) ?? [];
    insertRecord(db, {
      record_id: rec.record_id as string,
      run_id: rec.run_id as string,
      vendor: rec.vendor as string,
      author_name: rec.author_name as string | undefined,
      post_url: rec.post_url as string,
      post_title: rec.post_title as string,
      posted_at: rec.posted_at as string,
      captured_at: rec.captured_at as string,
      products,
      productsFull: rec.products as unknown[],
      extraction_source: rec.extraction_source as string | undefined,
      confidence: rec.confidence as number | undefined,
      account_type: rec.account_type as string | undefined,
    });

    upsertVendorProfile(db, rec.vendor as string, {
      author_name: rec.author_name as string | undefined,
      post_url: rec.post_url as string,
      posted_at: rec.posted_at as string,
      product_names: products.map((p) => p.name),
    });

    // INSERT OR IGNORE means already-present rows are silently skipped
    const check = db.prepare("SELECT 1 FROM records WHERE record_id = ?").get(rec.record_id);
    if (check) {
      // We can't easily distinguish "just inserted" from "already existed" with OR IGNORE,
      // but since the DB was wiped, all successful non-errors are new inserts.
    }
    inserted++;
  } catch (err) {
    errors.push(`${rec.record_id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

db.close();

const vendorCount = new Set(
  lines.map((l) => JSON.parse(l).vendor as string)
).size;

console.log(`Done. ${inserted} records processed, ${errors.length} errors, ${vendorCount} vendors.`);
if (errors.length > 0) {
  console.log("Errors:", errors.join("\n"));
}
