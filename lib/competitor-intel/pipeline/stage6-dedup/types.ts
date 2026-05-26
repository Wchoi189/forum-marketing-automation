export type SimilarityScore = {
  postId: string;
  score: number;
};

export type StoredEmbedding = {
  postId: string;
  vendor?: string;
  embedding: number[];
  timestamp: string;
};

export type Stage6Output = {
  uniquePosts: boolean;
  duplicateIds: string[];
  similarityScores: SimilarityScore[];
  embedding?: number[];
  warnings?: string[];
};
