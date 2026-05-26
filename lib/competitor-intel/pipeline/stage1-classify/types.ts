export type PostType =
  | "direct_offer"
  | "affiliate"
  | "promo_code"
  | "comparison"
  | "unknown";

export type Stage1Output = {
  postType: PostType;
  classifierConfidence: number;
  classifierEvidence: {
    excerpt: string;
    reasoning: string;
  };
  skipExtraction: boolean;
  affiliateTarget?: string;
  promoCode?: string;
  referencePrice?: number;
  warnings?: string[];
};
