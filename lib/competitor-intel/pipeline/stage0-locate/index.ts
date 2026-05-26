import { spawn } from "node:child_process";
import path from "node:path";
import { load } from "cheerio";
import type { Stage0Output } from "./types.js";

const PYTHON_BIN = "/parent/marketing-automation/.venv/bin/python3";
const SCRIPT_PATH = path.resolve(
  import.meta.dirname,
  "../../../../scripts/trafilatura_extract.py",
);
const TIMEOUT_MS = 5000;

const CHEERIO_TITLE_SELECTORS = [
  "#topTitle > h1",
  "h1.view-title",
  "meta[property='og:title']",
];

const CHEERIO_BODY_SELECTORS = [
  "td.board-contents",
  "div.JS_ContentMain",
  "#bbsview",
  "#bbsContents",
];

function cheerioFallback(
  html: string,
  originalChars: number,
): Pick<Stage0Output, "titleText" | "bodyText" | "debugInfo"> {
  const $ = load(html);

  let titleText = "";
  for (const sel of CHEERIO_TITLE_SELECTORS) {
    const el = $(sel).first();
    if (el.length) {
      titleText =
        sel.startsWith("meta")
          ? (el.attr("content") ?? "")
          : (el.text().trim());
      if (titleText) break;
    }
  }

  let bodyText = "";
  for (const sel of CHEERIO_BODY_SELECTORS) {
    const el = $(sel).first();
    if (el.length) {
      bodyText = el.text().replace(/\s+/g, " ").trim();
      if (bodyText.length > 20) break;
    }
  }

  const cleanChars = bodyText.length;
  const reductionPct = originalChars > 0
    ? Math.round(((originalChars - cleanChars) / originalChars) * 100)
    : 0;

  return {
    titleText,
    bodyText,
    debugInfo: { originalChars, cleanChars, reductionPct, tool: "cheerio" },
  };
}

function runTrafilatura(html: string): Promise<{
  title: string;
  body: string;
  originalChars: number;
  cleanChars: number;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT_PATH], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`trafilatura timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`trafilatura exit ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`trafilatura JSON parse failed: ${stdout.slice(0, 200)}`));
      }
    });

    proc.stdin.write(html, "utf-8");
    proc.stdin.end();
  });
}

export async function locateElements(html: string, _postUrl: string): Promise<Stage0Output> {
  const warnings: string[] = [];
  const originalChars = html.length;

  let trafilaturaResult: { title: string; body: string; originalChars: number; cleanChars: number } | null = null;

  try {
    trafilaturaResult = await runTrafilatura(html);
  } catch (err) {
    warnings.push(`trafilatura_error: ${(err as Error).message}`);
  }

  if (trafilaturaResult && trafilaturaResult.body.trim().length > 0) {
    const { title, body, originalChars: origChars, cleanChars } = trafilaturaResult;
    const reductionRatio = origChars > 0 ? (origChars - cleanChars) / origChars : 0;

    return {
      titleText: title,
      bodyText: body,
      reductionRatio,
      warnings: warnings.length > 0 ? warnings : undefined,
      debugInfo: {
        originalChars: origChars,
        cleanChars,
        reductionPct: Math.round(reductionRatio * 100),
        tool: "trafilatura",
      },
    };
  }

  // Trafilatura returned empty — fall back to Cheerio
  warnings.push("trafilatura_empty_fallback_used");
  const fallback = cheerioFallback(html, originalChars);
  const reductionRatio = originalChars > 0
    ? (originalChars - (fallback.debugInfo?.cleanChars ?? 0)) / originalChars
    : 0;

  return {
    titleText: fallback.titleText,
    bodyText: fallback.bodyText,
    reductionRatio,
    warnings,
    debugInfo: fallback.debugInfo,
  };
}
