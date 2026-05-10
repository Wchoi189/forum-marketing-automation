import { createHash } from "node:crypto";
import type { CompetitorAdRecord, AdProduct, EvidenceSource, AdEvidence } from "../types.js";

/** Generate a unique record ID from vendor + post URL. */
export function recordIdFrom(postUrl: string, vendor: string): string {
  return createHash("sha256").update(`${vendor}|${postUrl}`).digest("hex").slice(0, 16);
}

/** Generate a short post ID from a URL for artifact naming. */
export function postIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

export function buildRecordBase(input: {
  runId: string;
  vendor: string;
  authorName?: string;
  postUrl: string;
  postTitle: string;
  postedAt: string;
  postedAtRaw?: string;
  capturedAt: string;
  products: AdProduct[];
  evidence: AdEvidence;
  extractionSource: CompetitorAdRecord["extraction_source"];
  confidence: number;
  notes?: string;
}): CompetitorAdRecord {
  return {
    record_id: recordIdFrom(input.postUrl, input.vendor),
    run_id: input.runId,
    vendor: input.vendor,
    author_name: input.authorName,
    post_url: input.postUrl,
    post_title: input.postTitle,
    posted_at: input.postedAt,
    posted_at_raw: input.postedAtRaw,
    captured_at: input.capturedAt,
    products: input.products,
    evidence: input.evidence,
    extraction_source: input.extractionSource,
    confidence: input.confidence,
    notes: input.notes,
  };
}
