export type FinalProduct = {
  name: string;
  duration?: number;
  price?: number;
  source: "cheerio" | "llm" | "mixed";
  confidence: number;
};

export type SourceAttribution = {
  productId: string;
  sources: string[];
  votes: number;
};

export type RejectedProduct = {
  product: { name: string; price?: number; duration?: number };
  reason: string;
};

export type Stage4Output = {
  finalProducts: FinalProduct[];
  sourceAttribution: SourceAttribution[];
  confidenceBreakdown: {
    overall: number;
    perProduct: number[];
  };
  warnings: string[];
  rejectedProducts?: RejectedProduct[];
  mergeLog?: string[];
};
