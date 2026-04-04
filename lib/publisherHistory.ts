import fs from "fs/promises";
import path from "path";
import { ENV } from "../config/env.js";
import type { PublisherHistoryEntry } from "../contracts/models.js";

export type { PublisherHistoryEntry };

const MAX_ENTRIES = 200;
const REL_PATH = path.join("artifacts", "publisher-history.json");

function historyFilePath(): string {
  return path.join(ENV.PROJECT_ROOT, REL_PATH);
}

export async function appendPublisherHistoryEntry(entry: PublisherHistoryEntry): Promise<void> {
  const file = historyFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  let existing: PublisherHistoryEntry[] = [];
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      existing = parsed.filter(
        (row): row is PublisherHistoryEntry =>
          row &&
          typeof row === "object" &&
          typeof (row as PublisherHistoryEntry).at === "string" &&
          typeof (row as PublisherHistoryEntry).success === "boolean"
      );
    }
  } catch {
    existing = [];
  }
  const next = [entry, ...existing].slice(0, MAX_ENTRIES);
  await fs.writeFile(file, JSON.stringify(next, null, 2), "utf-8");
}

export async function readPublisherHistory(limit: number): Promise<PublisherHistoryEntry[]> {
  const cap = Math.max(1, Math.min(200, Math.round(limit)));
  try {
    const raw = await fs.readFile(historyFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, cap) as PublisherHistoryEntry[];
  } catch {
    return [];
  }
}
