export type CleanBlock = {
  text: string;
  lineIndex: number;
  hasPrice: boolean;
  hasDuration: boolean;
  hasProductKeyword: boolean;
  filterReason?: "partial_noise" | "mixed";
};

export type FilterReason = {
  blockIndex: number;
  reason: string;
  pattern: string;
};

export type RemovedBlock = {
  text: string;
  reason: string;
};

export type Stage2Output = {
  cleanBlocks: CleanBlock[];
  filterReasons: FilterReason[];
  signalScore: number;
  llmRequired: boolean;
  contentForLlm: string;
  removedBlocks?: RemovedBlock[];
  skip?: boolean;
};
