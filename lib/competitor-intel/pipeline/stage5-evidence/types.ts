export type EvidenceLink = {
  source_type: "html" | "llm";
  excerpt: string;
  block_location?: string;
  llm_prompt_context?: string;
  confidence: number;
};

export type ProductWithEvidence = {
  name: string;
  name_evidence: EvidenceLink;
  duration_months?: number;
  duration_evidence?: EvidenceLink;
  price_krw?: number;
  price_evidence?: EvidenceLink;
  confidence: number;
  source: string;
};

export type EvidenceChainEntry = {
  productId: string;
  field: "name" | "price" | "duration";
  source: "html" | "llm";
  excerpt: string;
};

export type Stage5Output = {
  productsWithEvidence: ProductWithEvidence[];
  evidenceChain: EvidenceChainEntry[];
  warnings: string[];
  readyForPersist: boolean;
  auditTrail?: string[];
};
