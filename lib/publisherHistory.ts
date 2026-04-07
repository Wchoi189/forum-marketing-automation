import fs from "fs/promises";
import path from "path";
import { ENV } from "../config/env.js";
import type { PublisherHistoryEntry } from "../contracts/models.js";

export type { PublisherHistoryEntry };

const LEGACY_REL_PATH = path.join("artifacts", "publisher-history.json");
const JSONL_REL_DIR = path.join("artifacts", "publisher-history");

function historyFilePath(): string {
  return path.join(ENV.PROJECT_ROOT, LEGACY_REL_PATH);
}

function historyJsonlDirPath(): string {
  return path.join(ENV.PROJECT_ROOT, JSONL_REL_DIR);
}

function partitionDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function partitionFilePathForEntry(entry: PublisherHistoryEntry): string {
  const day = partitionDate(entry.at);
  return path.join(historyJsonlDirPath(), `${day}.jsonl`);
}

function parseHistoryEntry(value: unknown): PublisherHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PublisherHistoryEntry>;
  if (typeof row.at !== "string" || typeof row.success !== "boolean") return null;
  if (typeof row.force !== "boolean") return null;
  if (typeof row.message !== "string") return null;
  return {
    at: row.at,
    success: row.success,
    force: row.force,
    message: row.message,
    runId: typeof row.runId === "string" ? row.runId : undefined,
    artifactDir: row.artifactDir === null || typeof row.artifactDir === "string" ? row.artifactDir : undefined,
    decision: row.decision
  };
}

async function readHistoryFromJsonl(limit: number): Promise<PublisherHistoryEntry[]> {
  const dir = historyJsonlDirPath();
  try {
    const files = (await fs.readdir(dir))
      .filter((name) => name.endsWith(".jsonl"))
      .sort((a, b) => b.localeCompare(a));

    const out: PublisherHistoryEntry[] = [];
    for (const fileName of files) {
      if (out.length >= limit) break;
      const filePath = path.join(dir, fileName);
      const raw = await fs.readFile(filePath, "utf-8");
      const lines = raw.split("\n");
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]?.trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          const entry = parseHistoryEntry(parsed);
          if (!entry) continue;
          out.push(entry);
          if (out.length >= limit) break;
        } catch {
          // ignore malformed line
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function readHistoryFromLegacyArray(limit: number): Promise<PublisherHistoryEntry[]> {
  try {
    const raw = await fs.readFile(historyFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseHistoryEntry).filter((entry): entry is PublisherHistoryEntry => entry !== null).slice(0, limit);
  } catch {
    return [];
  }
}

export async function appendPublisherHistoryEntry(entry: PublisherHistoryEntry): Promise<void> {
  const file = partitionFilePathForEntry(entry);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf-8");
}

export async function readPublisherHistory(limit: number): Promise<PublisherHistoryEntry[]> {
  const cap = Math.max(1, Math.min(200, Math.round(limit)));
  const fromJsonl = await readHistoryFromJsonl(cap);
  if (fromJsonl.length > 0) return fromJsonl.slice(0, cap);
  return (await readHistoryFromLegacyArray(cap)).slice(0, cap);
}
