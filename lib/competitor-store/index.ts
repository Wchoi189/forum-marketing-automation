/**
 * lib/competitor-store/index.ts
 *
 * The stored competitor-ad corpus: the SQLite schema and CRUD (sqlite.ts) plus
 * the dashboard read model over it (queries.ts).
 *
 * Deliberately NOT part of lib/competitor-intel/. That module is the crawl
 * pipeline, and its barrel re-exports createPlaywrightCrawler, so importing it
 * pulls Crawlee and Playwright into the graph. routes/api/logs.ts reads this
 * database on every dashboard request and must not drag the crawler into the
 * API server — see KE-002 for what memory pressure costs on this host.
 *
 * Direction of dependency: competitor-intel writes through here (its
 * storage/sqlite-adapter.ts), never the reverse.
 */

export {
  dbPath,
  openDatabase,
  isRecordKnown,
  insertRecord,
  upsertVendorProfile,
  listVendorProfiles,
  getRecordCount,
} from './sqlite.js';

export type { Database, VendorProfile } from './sqlite.js';

export {
  getOverview,
  getVendorSummaries,
  listRecords,
  getRecord,
  getProductPrices,
  getActivityTimeline,
} from './queries.js';

export type {
  OverviewPayload,
  VendorSummary,
  RecordListEntry,
  RecordDetail,
  ProductPriceRow,
  TimelineBucket,
  ListRecordsOptions,
} from './queries.js';
