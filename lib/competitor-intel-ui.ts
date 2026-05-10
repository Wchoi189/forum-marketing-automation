/**
 * Competitor Intelligence — UI query layer.
 *
 * SQL queries that power the competitor intelligence dashboard.
 * Reads from the competitor-ads SQLite database.
 */

import type { Database } from "./competitor-ad-sqlite.js";
import type { AdProduct } from "./competitor-intel/types.js";
import { cleanProductName } from "./competitor-ad-parser/product-name-utils.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OverviewPayload = {
  totalRecords: number;
  vendorCount: number;
  productCount: number;
  latestCapture: string | null;
  confidenceAvg: number | null;
  extractionSourceBreakdown: Array<{ source: string; count: number }>;
};

export type VendorSummary = {
  vendorId: string;
  authorName: string | null;
  totalPosts: number;
  firstSeen: string | null;
  lastSeen: string | null;
  products: string[];
  accountTypes: Array<{ type: string; count: number }>;
};

export type RecordListEntry = {
  recordId: string;
  runId: string;
  vendor: string;
  authorName: string | null;
  postUrl: string;
  postTitle: string | null;
  postedAt: string | null;
  capturedAt: string;
  productNames: string[];
  products: AdProduct[];
  extractionSource: string | null;
  confidence: number | null;
};

export type RecordDetail = RecordListEntry & {
  terms: Record<string, string> | null;
  accountType: string | null;
  region: string | null;
  bundle: string | null;
  promo: string | null;
  conditions: string | null;
  contact: string | null;
  notes: string | null;
};

export type ProductPriceRow = {
  productName: string;
  vendor: string;
  priceKrw: number | null;
  pricePerMonthKrw: number | null;
  durationMonths: number | null;
  planTier: string | null;
  constraints: string | null;
  postUrl: string;
  postedAt: string | null;
};

export type TimelineBucket = {
  date: string;
  vendor: string;
  count: number;
};

// ── Query Functions ───────────────────────────────────────────────────────────

export function getOverview(db: Database): OverviewPayload {
  const countRow = db.prepare(
    "SELECT COUNT(*) as total, COUNT(DISTINCT vendor) as vendorCount, AVG(confidence) as confidenceAvg, MAX(captured_at) as latestCapture FROM records"
  ).get() as { total: number; vendorCount: number; confidenceAvg: number | null; latestCapture: string | null };

  // Count distinct products from vendor_profiles (name-level, but covers all)
  const productRow = db.prepare(
    "SELECT COUNT(DISTINCT value) as productCount FROM vendor_profiles, json_each(products_json)"
  ).get() as { productCount: number };

  const sources = db.prepare(
    "SELECT COALESCE(extraction_source, 'unknown') as source, COUNT(*) as count FROM records GROUP BY source ORDER BY count DESC"
  ).all() as Array<{ source: string; count: number }>;

  return {
    totalRecords: countRow.total,
    vendorCount: countRow.vendorCount,
    productCount: productRow.productCount,
    latestCapture: countRow.latestCapture,
    confidenceAvg: countRow.confidenceAvg !== null ? Math.round(countRow.confidenceAvg * 100) / 100 : null,
    extractionSourceBreakdown: sources,
  };
}

export function getVendorSummaries(db: Database): VendorSummary[] {
  const profiles = db.prepare(
    "SELECT * FROM vendor_profiles ORDER BY total_posts DESC"
  ).all() as Array<{
    vendor_id: string;
    author_name: string | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
    total_posts: number;
    products_json: string | null;
  }>;

  // Get account type distribution from records
  const accountTypes = db.prepare(
    "SELECT vendor, COALESCE(account_type, 'unknown') as type, COUNT(*) as count FROM records GROUP BY vendor, type"
  ).all() as Array<{ vendor: string; type: string; count: number }>;
  const accountTypeMap = new Map<string, Array<{ type: string; count: number }>>();
  for (const at of accountTypes) {
    const existing = accountTypeMap.get(at.vendor) ?? [];
    existing.push({ type: at.type, count: at.count });
    accountTypeMap.set(at.vendor, existing);
  }

  return profiles.map((p) => ({
    vendorId: p.vendor_id,
    authorName: p.author_name,
    totalPosts: p.total_posts,
    firstSeen: p.first_seen_at,
    lastSeen: p.last_seen_at,
    products: p.products_json ? JSON.parse(p.products_json) : [],
    accountTypes: accountTypeMap.get(p.vendor_id) ?? [],
  }));
}

export type ListRecordsOptions = {
  vendor?: string;
  limit?: number;
  offset?: number;
};

export function listRecords(db: Database, opts: ListRecordsOptions = {}): { entries: RecordListEntry[]; total: number } {
  const { vendor, limit = 50, offset = 0 } = opts;

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (vendor) {
    whereClauses.push("vendor = ?");
    params.push(vendor);
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM records ${where}`
  ).get(params) as { total: number };

  const rows = db.prepare(
    `SELECT * FROM records ${where} ORDER BY captured_at DESC LIMIT ? OFFSET ?`
  ).all([...params, limit, offset]) as Array<{
    record_id: string;
    run_id: string;
    vendor: string;
    author_name: string | null;
    post_url: string;
    post_title: string | null;
    posted_at: string | null;
    captured_at: string;
    products_json: string;
    products_full_json: string | null;
    extraction_source: string | null;
    confidence: number | null;
  }>;

  const entries: RecordListEntry[] = rows.map((r) => {
    const products: AdProduct[] = r.products_full_json
      ? JSON.parse(r.products_full_json)
      : (r.products_json ? JSON.parse(r.products_json).map((name: string) => ({ name })) : []);
    return {
      recordId: r.record_id,
      runId: r.run_id,
      vendor: r.vendor,
      authorName: r.author_name,
      postUrl: r.post_url,
      postTitle: r.post_title,
      postedAt: r.posted_at,
      capturedAt: r.captured_at,
      productNames: r.products_json ? JSON.parse(r.products_json) : [],
      products,
      extractionSource: r.extraction_source,
      confidence: r.confidence,
    };
  });

  return { entries, total: countRow.total };
}

export function getRecord(db: Database, recordId: string): RecordDetail | null {
  const row = db.prepare(
    "SELECT * FROM records WHERE record_id = ?"
  ).get(recordId) as {
    record_id: string;
    run_id: string;
    vendor: string;
    author_name: string | null;
    post_url: string;
    post_title: string | null;
    posted_at: string | null;
    captured_at: string;
    products_json: string;
    products_full_json: string | null;
    extraction_source: string | null;
    confidence: number | null;
  } | undefined;

  if (!row) return null;

  const products: AdProduct[] = row.products_full_json
    ? JSON.parse(row.products_full_json)
    : (row.products_json ? JSON.parse(row.products_json).map((name: string) => ({ name })) : []);

  return {
    recordId: row.record_id,
    runId: row.run_id,
    vendor: row.vendor,
    authorName: row.author_name,
    postUrl: row.post_url,
    postTitle: row.post_title,
    postedAt: row.posted_at,
    capturedAt: row.captured_at,
    productNames: row.products_json ? JSON.parse(row.products_json) : [],
    products,
    extractionSource: row.extraction_source,
    confidence: row.confidence,
    // These fields are not persisted in SQLite currently; reserved for future schema
    terms: null,
    accountType: null,
    region: null,
    bundle: null,
    promo: null,
    conditions: null,
    contact: null,
    notes: null,
  };
}

export function getProductPrices(db: Database): ProductPriceRow[] {
  const rows = db.prepare(
    `SELECT vendor, post_url, posted_at, products_full_json
     FROM records
     WHERE products_full_json IS NOT NULL AND products_full_json != '[]'
     ORDER BY vendor`
  ).all() as Array<{
    vendor: string;
    post_url: string;
    posted_at: string | null;
    products_full_json: string;
  }>;

  const result: ProductPriceRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    try {
      const products: AdProduct[] = JSON.parse(row.products_full_json);
      for (const p of products) {
        const cleanName = cleanProductName(p.name, 50);
        const sig = `${cleanName}|${row.vendor}|${p.price_krw ?? ""}|${p.duration_months ?? ""}`;
        if (seen.has(sig)) continue;
        seen.add(sig);

        result.push({
          productName: cleanName,
          vendor: row.vendor,
          priceKrw: p.price_krw ?? null,
          pricePerMonthKrw: p.price_per_month_krw ?? null,
          durationMonths: p.duration_months ?? null,
          planTier: p.plan_tier ?? null,
          constraints: p.constraints ?? null,
          postUrl: row.post_url,
          postedAt: row.posted_at,
        });
      }
    } catch {
      // Skip records with malformed JSON
    }
  }

  return result.sort((a, b) => a.productName.localeCompare(b.productName) || (a.priceKrw ?? Infinity) - (b.priceKrw ?? Infinity));
}

export function getActivityTimeline(db: Database, bucketDays: number = 30): TimelineBucket[] {
  const rows = db.prepare(
    `SELECT DATE(posted_at) as date, vendor, COUNT(*) as count
     FROM records
     WHERE posted_at IS NOT NULL
       AND posted_at >= DATE('now', ?)
     GROUP BY date, vendor
     ORDER BY date, vendor`
  ).all([`-${bucketDays} days`]) as Array<{ date: string; vendor: string; count: number }>;

  return rows.map((r) => ({
    date: r.date,
    vendor: r.vendor,
    count: r.count,
  }));
}
