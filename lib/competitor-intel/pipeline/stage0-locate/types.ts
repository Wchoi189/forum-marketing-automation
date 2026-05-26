export type Stage0Output = {
  titleText: string;
  bodyText: string;
  reductionRatio: number;
  warnings?: string[];
  debugInfo?: {
    originalChars: number;
    cleanChars: number;
    reductionPct: number;
    tool: "trafilatura" | "cheerio";
  };
};
