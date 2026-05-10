export { VendorRegistry, registry } from "./vendor-registry.js";
export type { VendorStrategy, VendorSelectors } from "./vendor-strategy.js";
export { PpomppuStrategy } from "./ppomppu/ppomppu-strategy.js";
export type { CompetitorAdRecord, AdProduct, EvidenceSource, AdEvidence, RunError } from "./types.js";
export { recordIdFrom, postIdFromUrl, buildRecordBase } from "./storage/record-builder.js";
export {
  loadCsvRows,
  type CsvRow,
  chooseContentSelector,
  collectImages,
  extractTextBlocks,
  findPostedAt,
  extractProductsFromText,
} from "./extraction/pipeline.js";
export { runOcr } from "./extraction/ocr.js";
export { runVlmParse, extractJsonObject } from "./extraction/vlm.js";
export { validateVlmAgainstHtml } from "./extraction/validation.js";
export { getImageDimensions, validateImageForVlm, isImageLargeEnough } from "./extraction/image-utils.js";
export { createRequestHandler } from "./crawler/request-handler.js";
export { createPlaywrightCrawler, type CrawlerOptions } from "./crawler/crawlee-config.js";
export { exportDatasetToJsonlGz } from "./storage/jsonl-export.js";
export { syncDatasetToSqlite, openWithKnownCheck, type SyncResult } from "./storage/sqlite-adapter.js";
export { scanBoard, createBoardScanHandler, extractPostsFromPage, extractNextPageUrl, type BoardPost, type ScanOptions, type PpomppuListingSelectors } from "./discovery/board-scanner.js";
export { discoverAndEnqueue, groupByAuthor, type DiscoveryResult } from "./discovery/vendor-discovery.js";
