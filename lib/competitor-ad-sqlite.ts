import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

export type { Db as Database };
import { ENV } from "../config/env.js";

const DB_DIR = path.join(ENV.PROJECT_ROOT, "artifacts", "competitor-ads");
const DB_FILE = path.join(DB_DIR, "competitor-ads.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS records (
    record_id       TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL,
    vendor          TEXT NOT NULL,
    author_name     TEXT,
    post_url        TEXT NOT NULL,
    post_title      TEXT,
    posted_at       TEXT,
    captured_at     TEXT NOT NULL,
    products_json   TEXT,
    products_full_json TEXT,
    extraction_source TEXT,
    account_type      TEXT,
    confidence      REAL,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendor_profiles (
    vendor_id          TEXT PRIMARY KEY,
    author_name        TEXT,
    first_seen_post_url TEXT,
    first_seen_at      TEXT,
    last_seen_post_url TEXT,
    last_seen_at       TEXT,
    total_posts        INTEGER DEFAULT 0,
    products_json      TEXT,
    updated_at         TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_records_vendor ON records(vendor);
  CREATE INDEX IF NOT EXISTS idx_records_posted_at ON records(posted_at);
`;

export function dbPath(): string {
  return DB_FILE;
}

export function openDatabase(dbPath?: string): Db {
  const filePath = dbPath || DB_FILE;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  // Migration: add products_full_json column to existing databases
  const hasColumn = db.prepare("PRAGMA table_info(records)").all()
    .some((col: { name: string }) => col.name === "products_full_json");
  if (!hasColumn) {
    db.exec("ALTER TABLE records ADD COLUMN products_full_json TEXT");
  }

  // Migration: add account_type column to existing databases
  const hasAccountType = db.prepare("PRAGMA table_info(records)").all()
    .some((col: { name: string }) => col.name === "account_type");
  if (!hasAccountType) {
    db.exec("ALTER TABLE records ADD COLUMN account_type TEXT");
  }

  // Migration: add content_hash column for incremental extraction
  const hasContentHash = db.prepare("PRAGMA table_info(records)").all()
    .some((col: { name: string }) => col.name === "content_hash");
  if (!hasContentHash) {
    db.exec("ALTER TABLE records ADD COLUMN content_hash TEXT");
  }

  return db;
}

export function isRecordKnown(db: Db, recordId: string): boolean {
  const row = db.prepare("SELECT 1 FROM records WHERE record_id = ?").get(recordId);
  return !!row;
}

export function insertRecord(db: Db, record: {
  record_id: string;
  run_id: string;
  vendor: string;
  author_name?: string;
  post_url: string;
  post_title?: string;
  posted_at?: string;
  captured_at: string;
  products: Array<{ name: string }>;
  extraction_source?: string;
  confidence?: number;
  productsFull?: unknown[];
  account_type?: string;
  content_hash?: string;
}): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO records
      (record_id, run_id, vendor, author_name, post_url, post_title, posted_at, captured_at, products_json, products_full_json, extraction_source, account_type, confidence, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.record_id,
    record.run_id,
    record.vendor,
    record.author_name || null,
    record.post_url,
    record.post_title || null,
    record.posted_at || null,
    record.captured_at,
    JSON.stringify(record.products.map((p) => p.name)),
    record.productsFull ? JSON.stringify(record.productsFull) : null,
    record.extraction_source || null,
    record.account_type || null,
    record.confidence ?? null,
    record.content_hash || null,
  );
}

export function upsertVendorProfile(db: Db, vendorId: string, params: {
  author_name?: string;
  post_url: string;
  posted_at?: string;
  product_names: string[];
}): void {
  const existing = db.prepare(
    "SELECT vendor_id, first_seen_post_url, first_seen_at, last_seen_post_url, last_seen_at, total_posts, products_json FROM vendor_profiles WHERE vendor_id = ?"
  ).get(vendorId) as {
    vendor_id: string;
    first_seen_post_url: string | null;
    first_seen_at: string | null;
    last_seen_post_url: string | null;
    last_seen_at: string | null;
    total_posts: number;
    products_json: string | null;
  } | undefined;

  const now = new Date().toISOString();
  const postedAt = params.posted_at || now;

  if (!existing) {
    db.prepare(`
      INSERT INTO vendor_profiles
        (vendor_id, author_name, first_seen_post_url, first_seen_at, last_seen_post_url, last_seen_at, total_posts, products_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vendorId,
      params.author_name || null,
      params.post_url,
      postedAt,
      params.post_url,
      postedAt,
      1,
      JSON.stringify([...new Set(params.product_names)]),
      now,
    );
    return;
  }

  const existingProducts: string[] = existing.products_json
    ? JSON.parse(existing.products_json)
    : [];
  const mergedProducts = [...new Set([...existingProducts, ...params.product_names])];

  db.prepare(`
    UPDATE vendor_profiles SET
      author_name = COALESCE(author_name, ?),
      last_seen_post_url = ?,
      last_seen_at = ?,
      total_posts = total_posts + 1,
      products_json = ?,
      updated_at = ?
    WHERE vendor_id = ?
  `).run(
    params.author_name || null,
    params.post_url,
    postedAt,
    JSON.stringify(mergedProducts),
    now,
    vendorId,
  );
}

type VendorProfile = {
  vendor_id: string;
  author_name: string | null;
  first_seen_post_url: string | null;
  first_seen_at: string | null;
  last_seen_post_url: string | null;
  last_seen_at: string | null;
  total_posts: number;
  products: string[];
  updated_at: string;
};

export function listVendorProfiles(db: Db): VendorProfile[] {
  const rows = db.prepare(
    "SELECT * FROM vendor_profiles ORDER BY vendor_id"
  ).all() as Array<{
    vendor_id: string;
    author_name: string | null;
    first_seen_post_url: string | null;
    first_seen_at: string | null;
    last_seen_post_url: string | null;
    last_seen_at: string | null;
    total_posts: number;
    products_json: string | null;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    vendor_id: row.vendor_id,
    author_name: row.author_name,
    first_seen_post_url: row.first_seen_post_url,
    first_seen_at: row.first_seen_at,
    last_seen_post_url: row.last_seen_post_url,
    last_seen_at: row.last_seen_at,
    total_posts: row.total_posts,
    products: row.products_json ? JSON.parse(row.products_json) : [],
    updated_at: row.updated_at,
  }));
}

export function getRecordCount(db: Db): { total: number; distinct_vendors: number } {
  const row = db.prepare(
    "SELECT COUNT(*) as total, COUNT(DISTINCT vendor) as distinct_vendors FROM records"
  ).get() as { total: number; distinct_vendors: number };
  return row;
}
