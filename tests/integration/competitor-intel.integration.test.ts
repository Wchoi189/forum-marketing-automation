import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCsvRows, recordIdFrom, buildRecordBase } from "../../lib/competitor-intel/index.js";
import { openDatabase, isRecordKnown, insertRecord, upsertVendorProfile, listVendorProfiles, getRecordCount } from "../../lib/competitor-ad-sqlite.js";

// ---------------------------------------------------------------------------
// CSV parser integration
// ---------------------------------------------------------------------------

test("loadCsvRows: parses a valid CSV with vendor_id and post_url", () => {
  const tmp = path.join(os.tmpdir(), `test-csv-${Date.now()}.csv`);
  fs.writeFileSync(tmp, "vendor_id,post_url,notes_override\nppomppu,https://ppomppu.co.kr/post/1,Test note\nppomppu,https://ppomppu.co.kr/post/2,\n");

  try {
    const rows = loadCsvRows(tmp);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].vendor, "ppomppu");
    assert.equal(rows[0].postUrl, "https://ppomppu.co.kr/post/1");
    assert.equal(rows[0].notesOverride, "Test note");
    assert.equal(rows[1].notesOverride, ""); // empty string, not undefined
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("loadCsvRows: throws when post_url column is missing", () => {
  const tmp = path.join(os.tmpdir(), `test-csv-missing-${Date.now()}.csv`);
  fs.writeFileSync(tmp, "vendor_id,other_col\nppomppu,hello\n");

  try {
    assert.throws(() => loadCsvRows(tmp), /must include vendor_id and post_url/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("loadCsvRows: strips BOM", () => {
  const tmp = path.join(os.tmpdir(), `test-csv-bom-${Date.now()}.csv`);
  const content = "﻿vendor_id,post_url\nppomppu,https://ppomppu.co.kr/post/1\n";
  fs.writeFileSync(tmp, content, "utf-8");

  try {
    const rows = loadCsvRows(tmp);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vendor, "ppomppu");
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("loadCsvRows: skips rows with empty vendor or post_url", () => {
  const tmp = path.join(os.tmpdir(), `test-csv-skip-${Date.now()}.csv`);
  fs.writeFileSync(tmp, "vendor_id,post_url\nppomppu,https://ppomppu.co.kr/post/1\n,https://ppomppu.co.kr/post/2\nppomppu,\n");

  try {
    const rows = loadCsvRows(tmp);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].postUrl, "https://ppomppu.co.kr/post/1");
  } finally {
    fs.unlinkSync(tmp);
  }
});

// ---------------------------------------------------------------------------
// Record builder + SQLite integration
// ---------------------------------------------------------------------------

test("recordIdFrom: produces deterministic IDs", () => {
  const id1 = recordIdFrom("https://ppomppu.co.kr/post/1", "ppomppu");
  const id2 = recordIdFrom("https://ppomppu.co.kr/post/1", "ppomppu");
  assert.equal(id1, id2);
  assert.equal(id1.length, 16); // first 16 hex chars of SHA-256
});

test("recordIdFrom: different URLs produce different IDs", () => {
  const id1 = recordIdFrom("https://ppomppu.co.kr/post/1", "ppomppu");
  const id2 = recordIdFrom("https://ppomppu.co.kr/post/2", "ppomppu");
  assert.notEqual(id1, id2);
});

test("SQLite: insert and check isRecordKnown", () => {
  const db = openDatabase(":memory:");
  try {
    const recordId = recordIdFrom("https://ppomppu.co.kr/post/1", "ppomppu");
    assert.equal(isRecordKnown(db, recordId), false);

    insertRecord(db, {
      record_id: recordId,
      run_id: "test-run",
      vendor: "ppomppu",
      post_url: "https://ppomppu.co.kr/post/1",
      post_title: "Test Post",
      posted_at: "2026-01-01T00:00:00.000Z",
      captured_at: new Date().toISOString(),
      products: [{ name: "Netflix" }],
      confidence: 0.8,
    });

    assert.equal(isRecordKnown(db, recordId), true);
  } finally {
    db.close();
  }
});

test("SQLite: upsert vendor profile increments total_posts", () => {
  const db = openDatabase(":memory:");
  try {
    upsertVendorProfile(db, "ppomppu", {
      post_url: "https://ppomppu.co.kr/post/1",
      product_names: ["Netflix"],
    });

    upsertVendorProfile(db, "ppomppu", {
      post_url: "https://ppomppu.co.kr/post/2",
      product_names: ["YouTube"],
    });

    const profiles = listVendorProfiles(db);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].total_posts, 2);
    assert.deepEqual(profiles[0].products.sort(), ["Netflix", "YouTube"].sort());
  } finally {
    db.close();
  }
});

test("SQLite: getRecordCount returns correct totals", () => {
  const db = openDatabase(":memory:");
  try {
    const counts1 = getRecordCount(db);
    assert.equal(counts1.total, 0);

    insertRecord(db, {
      record_id: recordIdFrom("https://ppomppu.co.kr/post/1", "ppomppu"),
      run_id: "run-1",
      vendor: "ppomppu",
      post_url: "https://ppomppu.co.kr/post/1",
      captured_at: new Date().toISOString(),
      products: [{ name: "Netflix" }],
    });

    insertRecord(db, {
      record_id: recordIdFrom("https://ppomppu.co.kr/post/2", "other"),
      run_id: "run-1",
      vendor: "other",
      post_url: "https://other.co.kr/post/2",
      captured_at: new Date().toISOString(),
      products: [{ name: "Disney" }],
    });

    const counts2 = getRecordCount(db);
    assert.equal(counts2.total, 2);
    assert.equal(counts2.distinct_vendors, 2);
  } finally {
    db.close();
  }
});

test("buildRecordBase: constructs a full CompetitorAdRecord", () => {
  const now = new Date().toISOString();
  const record = buildRecordBase({
    runId: "test-run",
    vendor: "ppomppu",
    authorName: "shareplan",
    postUrl: "https://ppomppu.co.kr/post/1",
    postTitle: "Test Post",
    postedAt: "2026-01-01T00:00:00.000Z",
    capturedAt: now,
    products: [{ name: "Netflix", price_krw: 15000, duration_months: 1 }],
    evidence: { sources: [] },
    extractionSource: "html",
    confidence: 0.9,
  });

  assert.equal(record.run_id, "test-run");
  assert.equal(record.vendor, "ppomppu");
  assert.equal(record.author_name, "shareplan");
  assert.ok(record.record_id.length > 0);
  assert.equal(record.products.length, 1);
  assert.equal(record.extraction_source, "html");
  assert.equal(record.confidence, 0.9);
});
