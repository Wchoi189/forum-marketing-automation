import fs from "fs/promises";
import path from "path";
import { ENV } from "../config/env.js";

const REL_PATH = path.join("artifacts", "runtime-controls.json");

function filePath(): string {
  return path.join(ENV.PROJECT_ROOT, REL_PATH);
}

export type RuntimeControlsFile = {
  /** Persisted minimum gap (posts). Omitted or null = no runtime file override (use env/spec chain). */
  observerGapThresholdMin?: number | null;
};

function clampGap(n: number): number {
  return Math.max(1, Math.min(50, Math.round(n)));
}

/**
 * Returns persisted gap override from disk, or null if none / invalid.
 */
export async function readRuntimeGapPersistedOverride(): Promise<number | null> {
  try {
    const raw = await fs.readFile(filePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const v = (parsed as RuntimeControlsFile).observerGapThresholdMin;
    if (v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isInteger(v)) return null;
    return clampGap(v);
  } catch {
    return null;
  }
}

/**
 * Persist or clear gap override. null removes the key so env/spec chain applies.
 */
export async function writeRuntimeGapPersistedOverride(value: number | null): Promise<void> {
  const fp = filePath();
  await fs.mkdir(path.dirname(fp), { recursive: true });
  let data: RuntimeControlsFile = {};
  try {
    const raw = await fs.readFile(fp, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = { ...(parsed as RuntimeControlsFile) };
    }
  } catch {
    data = {};
  }
  if (value === null) {
    delete data.observerGapThresholdMin;
  } else {
    data.observerGapThresholdMin = clampGap(value);
  }
  await fs.writeFile(fp, JSON.stringify(data, null, 2), "utf-8");
}
