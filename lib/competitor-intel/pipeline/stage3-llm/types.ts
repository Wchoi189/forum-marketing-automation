export type LlmProduct = {
  name: string;
  duration?: number;
  price?: number;
  confidence: number;
  evidence: string;
};

export type CatalogMatch = {
  original: string;
  canonical: string;
};

export type Stage3Output = {
  llmProducts: LlmProduct[];
  promptContext: string;
  llmConfidence: number;
  skipped: boolean;
  rawLlmResponse?: string;
  catalogMatches?: CatalogMatch[];
  warnings?: string[];
};
