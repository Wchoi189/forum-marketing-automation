// ── Shared types for the competitor intelligence pipeline ─────────────────────

export type AdProduct = {
  name: string;
  plan_tier?: string;
  duration_months?: number;
  price_krw?: number;
  price_per_month_krw?: number;
  constraints?: string;
};

export type EvidenceSource = {
  type: "html" | "ocr" | "vlm";
  excerpt: string;
  image_ref?: string;
  source_block?: string;
};

export type AdEvidence = {
  sources: EvidenceSource[];
  field_evidence?: Record<string, EvidenceSource[]>;
};

export type CompetitorAdRecord = {
  record_id: string;
  run_id: string;
  vendor: string;
  author_name?: string;
  post_url: string;
  post_title: string;
  posted_at: string;
  posted_at_raw?: string;
  captured_at: string;
  products: AdProduct[];
  terms?: Record<string, string>;
  account_type?: string;
  region?: string;
  bundle?: string;
  promo?: string;
  conditions?: string;
  contact?: string;
  notes?: string;
  confidence?: number;
  extraction_source?: "html" | "ocr" | "vlm" | "llm-text" | "mixed";
  evidence: AdEvidence;
};

export type RunError = {
  post_url: string;
  reason: string;
  artifact_ref?: string;
};

export type ParsedResult = {
  products: AdProduct[];
  account_type?: string;
  posted_at: string;
  posted_at_raw?: string;
  confidence: number;
  warnings: string[];
};
