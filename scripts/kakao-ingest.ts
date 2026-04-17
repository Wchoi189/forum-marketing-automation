/**
 * Kakao Historical Chat Ingest — Phase 2
 *
 * Reads all 156 CSVs from data/kakao_chat_records_2026-04-18/ and writes a
 * single unified JSONL to data/kakao-processed/conversations.jsonl.
 *
 * Idempotent: re-running overwrites output deterministically.
 * Source CSVs are never modified.
 *
 * Entry point: npx tsx scripts/kakao-ingest.ts
 */

import fs from "node:fs";
import path from "node:path";

const CSV_DIR = path.join("data", "kakao_chat_records_2026-04-18");
const OUT_DIR = path.join("data", "kakao-processed");
const OUT_FILE = path.join(OUT_DIR, "conversations.jsonl");

// ── Types ────────────────────────────────────────────────────────────────────

type Speaker = "operator" | "menu" | "customer";

interface KakaoMessage {
  id: string;
  conv_id: string;
  ts: string;
  source: "historical";
  speaker: Speaker;
  user_id: string;
  text: string;
  labels: string[];
  meta: { conv_filename: string };
}

// ── Speaker normalization ────────────────────────────────────────────────────

function normalizeSpeaker(user: string): Speaker {
  if (user === "SharePlan") return "operator";
  if (user === "SharePlan(메뉴)") return "menu";
  return "customer";
}

// ── CSV parser ───────────────────────────────────────────────────────────────
//
// Minimal RFC 4180-compliant parser. Handles quoted fields containing commas
// and embedded newlines (e.g. multi-line MESSAGE column). Strips leading BOM.

function parseCSV(content: string): string[][] {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // Escaped quote inside quoted field
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }

  // Handle final field when file has no trailing newline
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ── Per-file ingestion ───────────────────────────────────────────────────────

function ingestFile(csvPath: string): KakaoMessage[] {
  const filename = path.basename(csvPath);
  const conv_id = path.basename(csvPath, ".csv");
  const content = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(content);

  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  const [h0, h1, h2] = headerRow;
  if (h0?.trim() !== "DATE" || h1?.trim() !== "USER" || h2?.trim() !== "MESSAGE") {
    throw new Error(`Unexpected header: ${JSON.stringify(headerRow)}`);
  }

  const messages: KakaoMessage[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const [date, user, message] = dataRows[i];
    // Skip blank trailing rows
    if (!date && !user && !message) continue;

    messages.push({
      id: `${conv_id}-${i}`,
      conv_id,
      // "2025-10-16 17:15:08" → "2025-10-16T17:15:08" (KST, no offset stored)
      ts: date.replace(" ", "T"),
      source: "historical",
      speaker: normalizeSpeaker(user),
      user_id: user,
      text: message ?? "",
      labels: [],
      meta: { conv_filename: filename },
    });
  }

  return messages;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const csvFiles = fs
    .readdirSync(CSV_DIR)
    .filter((f) => f.endsWith(".csv"))
    .sort()
    .map((f) => path.join(CSV_DIR, f));

  console.log(`Found ${csvFiles.length} CSV files in ${CSV_DIR}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const out = fs.createWriteStream(OUT_FILE, { encoding: "utf-8", flags: "w" });

  let totalMessages = 0;
  let totalConversations = 0;
  const speakerCounts: Record<Speaker, number> = { operator: 0, menu: 0, customer: 0 };
  const errors: string[] = [];

  for (const csvPath of csvFiles) {
    try {
      const messages = ingestFile(csvPath);
      for (const msg of messages) {
        out.write(JSON.stringify(msg) + "\n");
        speakerCounts[msg.speaker]++;
        totalMessages++;
      }
      totalConversations++;
    } catch (err) {
      errors.push(`${path.basename(csvPath)}: ${(err as Error).message}`);
    }
  }

  out.end();

  console.log(`\nIngestion complete:`);
  console.log(`  Conversations : ${totalConversations} / ${csvFiles.length}`);
  console.log(`  Total messages: ${totalMessages}`);
  console.log(
    `  Speaker split : operator=${speakerCounts.operator}, menu=${speakerCounts.menu}, customer=${speakerCounts.customer}`,
  );
  console.log(`  Output        : ${OUT_FILE}`);

  if (errors.length > 0) {
    console.error(`\nErrors (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

main();
