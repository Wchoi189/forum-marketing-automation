/**
 * Competitor Ads Intelligence (Manual)
 *
 * Runs a manual, fail-closed extraction job over a CSV list of vendor/post URLs,
 * or discovers vendors from a board listing via --scan-board.
 * Uses Crawlee (PlaywrightCrawler) for browser lifecycle, retries, and concurrency.
 * Outputs a gzip JSONL dataset plus raw evidence artifacts.
 *
 * Usage:
 *   npx tsx scripts/competitor-ads-intel.ts --input-csv <path> [--run-id <id>] [--rate-limit-rps <n>]
 *   npx tsx scripts/competitor-ads-intel.ts --scan-board <url> [--max-pages <n>] [--vendor-key <pattern>]
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { RequestQueue } from "crawlee";
import { ENV } from "../config/env.js";
import {
  registry,
  PpomppuStrategy,
  createRequestHandler,
  createPlaywrightCrawler,
  loadCsvRows,
  recordIdFrom,
  postIdFromUrl,
  scanBoard,
  discoverAndEnqueue,
  groupByAuthor,
  syncDatasetToSqlite,
} from "../lib/competitor-intel/index.js";
import { openDatabase, listVendorProfiles, getRecordCount, isRecordKnown } from "../lib/competitor-ad-sqlite.js";

// ── CLI args ─────────────────────────────────────────────────────────────────

type CliArgs =
  | { mode: "show-vendors" }
  | { mode: "csv"; inputCsv: string; runId: string; rateLimitRps: number }
  | { mode: "scan-board"; boardUrl: string; maxPages: number; vendorKey?: string; runId: string; rateLimitRps: number };

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args.set(key.slice(2), "true");
    } else {
      args.set(key.slice(2), value);
      i++;
    }
  }

  if (args.has("show-vendors")) {
    return { mode: "show-vendors" };
  }

  const runId = args.get("run-id") || new Date().toISOString().replace(/[:.]/g, "-");
  const rateLimitRaw = args.get("rate-limit-rps") || "1";
  const rateLimitRps = Number(rateLimitRaw);
  if (!Number.isFinite(rateLimitRps) || rateLimitRps <= 0) {
    console.error("--rate-limit-rps must be a positive number");
    process.exit(1);
  }

  if (args.has("scan-board")) {
    const boardUrl = args.get("scan-board");
    if (!boardUrl) {
      console.error("--scan-board requires a URL value");
      process.exit(1);
    }
    const maxPages = Number(args.get("max-pages") || "10");
    if (!Number.isFinite(maxPages) || maxPages <= 0) {
      console.error("--max-pages must be a positive number");
      process.exit(1);
    }
    return {
      mode: "scan-board",
      boardUrl,
      maxPages,
      vendorKey: args.get("vendor-key"),
      runId,
      rateLimitRps,
    };
  }

  const inputCsv = args.get("input-csv");
  if (!inputCsv) {
    console.error("Missing required --input-csv <path> or --scan-board <url>");
    process.exit(1);
  }

  return { mode: "csv", inputCsv, runId, rateLimitRps };
}

// ── Paths / artifacts ────────────────────────────────────────────────────────

function artifactRoot(runId: string): string {
  return path.join(ENV.PROJECT_ROOT, "artifacts", "competitor-ads", runId);
}

function dataOutputPath(runId: string): string {
  return path.join(artifactRoot(runId), "data", "records.jsonl.gz");
}

function runSummaryPath(runId: string): string {
  return path.join(artifactRoot(runId), "data", "run-summary.json");
}

async function ensureArtifactDirs(runId: string): Promise<void> {
  const root = artifactRoot(runId);
  const dirs = [
    root,
    path.join(root, "data"),
    path.join(root, "raw_html"),
    path.join(root, "images"),
    path.join(root, "ocr"),
    path.join(root, "vlm"),
    path.join(root, "logs"),
  ];
  await Promise.all(dirs.map((dir) => fsp.mkdir(dir, { recursive: true })));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Register vendor strategies
  registry.register(new PpomppuStrategy());

  // Standalone read-only operation
  if (args.mode === "show-vendors") {
    const db = openDatabase();
    const profiles = listVendorProfiles(db);
    const counts = getRecordCount(db);
    db.close();

    if (profiles.length === 0) {
      console.log("No vendor profiles found.");
      return;
    }

    console.log(`Vendor Profiles (${profiles.length} vendors, ${counts.total} total records in DB):\n`);
    for (const p of profiles) {
      console.log(`  ${p.vendor_id}`);
      if (p.author_name) console.log(`    Author: ${p.author_name}`);
      console.log(`    Posts: ${p.total_posts}`);
      console.log(`    First seen: ${p.first_seen_at ?? "unknown"} (${p.first_seen_post_url ?? "N/A"})`);
      console.log(`    Last seen:  ${p.last_seen_at ?? "unknown"} (${p.last_seen_post_url ?? "N/A"})`);
      if (p.products.length > 0) {
        console.log(`    Products (${p.products.length}): ${p.products.join(", ")}`);
      }
      console.log("");
    }
    return;
  }

  const runId = args.runId;
  const rateLimitRps = args.rateLimitRps;
  const root = artifactRoot(runId);
  await ensureArtifactDirs(runId);

  const db = openDatabase();
  const isKnown = (recordId: string) => isRecordKnown(db, recordId);

  // ── Mode: scan-board ────────────────────────────────────────────────────
  if (args.mode === "scan-board") {
    console.log(`Board scan mode: ${args.boardUrl}`);
    console.log(`  max-pages  : ${args.maxPages}`);
    console.log(`  vendor-key : ${args.vendorKey ?? "(none, scan all)"}`);
    console.log(`  run-id     : ${runId}`);

    const posts = await scanBoard({
      boardUrl: args.boardUrl,
      maxPages: args.maxPages,
      vendorKey: args.vendorKey,
    });

    console.log(`\nDiscovered ${posts.length} posts from board scan.`);

    // Group by author for reporting
    const groups = groupByAuthor(posts);
    console.log(`\nAuthors discovered (${groups.size}):`);
    for (const [author, authorPosts] of groups) {
      console.log(`  ${author}: ${authorPosts.length} posts`);
    }

    // Enqueue into RequestQueue
    const queue = await RequestQueue.open();
    const discovery = await discoverAndEnqueue({
      posts,
      queue,
      runId,
      vendor: "ppomppu",
      isRecordKnown: isKnown,
    });

    console.log(`\nDiscovery summary:`);
    console.log(`  discovered : ${discovery.discovered}`);
    console.log(`  enqueued   : ${discovery.enqueued}`);
    console.log(`  skipped    : ${discovery.skipped}`);

    if (discovery.enqueued === 0) {
      console.log("No new posts to crawl. Exiting.");
      db.close();
      return;
    }

    // Run crawler on discovered posts
    const handler = createRequestHandler({ artifactRoot: root, registry });
    const crawler = createPlaywrightCrawler(handler, {
      maxConcurrency: 1,
      maxRequestsPerMinute: rateLimitRps * 60,
      maxRetries: 2,
      requestQueue: queue,
    });

    const startedAt = new Date().toISOString();
    const result = await crawler.run();
    const finishedAt = new Date().toISOString();

    // Export + sync (same as CSV mode)
    const { successCount, errors, exportedCount } = await syncDatasetToSqlite(db, runId, dataOutputPath(runId));

    const counts = getRecordCount(db);
    db.close();

    const summary = {
      run_id: runId,
      mode: "scan-board",
      board_url: args.boardUrl,
      started_at: startedAt,
      finished_at: finishedAt,
      discovered_posts: discovery.discovered,
      enqueued_posts: discovery.enqueued,
      success_count: successCount,
      failure_count: result.requestsFailed,
      skipped_count: discovery.skipped,
      records_written: exportedCount,
      artifact_dir: root,
      db_total_records: counts.total,
      db_distinct_vendors: counts.distinct_vendors,
      authors: discovery.authors,
      errors,
    };

    await fsp.writeFile(runSummaryPath(runId), JSON.stringify(summary, null, 2));

    console.log("Board scan + extraction complete.");
    console.log(`  run_id         : ${runId}`);
    console.log(`  discovered     : ${discovery.discovered}`);
    console.log(`  enqueued       : ${discovery.enqueued}`);
    console.log(`  success_count  : ${successCount}`);
    console.log(`  failure_count  : ${result.requestsFailed}`);
    console.log(`  records_written: ${exportedCount}`);
    console.log(`  db records     : ${counts.total} total, ${counts.distinct_vendors} vendors`);
    return;
  }

  // ── Mode: csv ───────────────────────────────────────────────────────────
  const rows = loadCsvRows(args.inputCsv);
  if (rows.length === 0) {
    console.error("No rows found in input CSV.");
    db.close();
    process.exit(1);
  }

  // Filter out already-known records (cross-run dedup via SQLite)
  const toProcess = rows.filter((row) => {
    const recordId = recordIdFrom(row.postUrl, row.vendor);
    if (isKnown(recordId)) {
      console.log(`  [${postIdFromUrl(row.postUrl)}] skipping (already in DB from prior run)`);
      return false;
    }
    return true;
  });

  const skippedCount = rows.length - toProcess.length;

  // Enqueue URLs in RequestQueue
  const queue = await RequestQueue.open();
  for (const row of toProcess) {
    await queue.addRequest({
      url: row.postUrl,
      uniqueKey: `${row.vendor}|${row.postUrl}`,
      userData: { runId, notesOverride: row.notesOverride },
    });
  }

  console.log(`Queued ${toProcess.length} URLs (${skippedCount} skipped, ${rows.length} total)`);

  // Create and run crawler
  const handler = createRequestHandler({ artifactRoot: root, registry });
  const crawler = createPlaywrightCrawler(handler, {
    maxConcurrency: 1,
    maxRequestsPerMinute: rateLimitRps * 60,
    maxRetries: 2,
    requestQueue: queue,
  });

  const startedAt = new Date().toISOString();
  const result = await crawler.run();
  const finishedAt = new Date().toISOString();

  // Export + sync
  const { successCount, errors, exportedCount } = await syncDatasetToSqlite(db, runId, dataOutputPath(runId));
  const counts = getRecordCount(db);
  db.close();

  const summary = {
    run_id: runId,
    mode: "csv",
    started_at: startedAt,
    finished_at: finishedAt,
    total_posts: rows.length,
    success_count: successCount,
    failure_count: result.requestsFailed,
    skipped_count: skippedCount,
    records_written: exportedCount,
    artifact_dir: root,
    output_path: dataOutputPath(runId),
    db_total_records: counts.total,
    db_distinct_vendors: counts.distinct_vendors,
    errors,
  };

  await fsp.writeFile(runSummaryPath(runId), JSON.stringify(summary, null, 2));

  console.log("Competitor ads extraction complete.");
  console.log(`  run_id         : ${runId}`);
  console.log(`  total_posts    : ${rows.length}`);
  console.log(`  success_count  : ${successCount}`);
  console.log(`  failure_count  : ${result.requestsFailed}`);
  console.log(`  skipped_count  : ${skippedCount}`);
  console.log(`  records_written: ${exportedCount}`);
  console.log(`  output_path    : ${dataOutputPath(runId)}`);
  console.log(`  db records     : ${counts.total} total, ${counts.distinct_vendors} vendors`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
