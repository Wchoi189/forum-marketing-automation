/**
 * lib/analytics/index.ts
 *
 * Barrel export for derived numbers: board turnover and share of voice
 * (trends), publisher run signal classification (schedulerSignals), and the
 * competitor EDA payload behind /api/analytics (competitors).
 *
 * All three read history — ActivityLog[] or PublisherHistoryEntry[] — and
 * return a payload. None of them touch the browser or write state.
 */

export {
  TREND_MULTIPLIER_MIN,
  TREND_MULTIPLIER_MAX,
  COMBINED_MULTIPLIER_MIN,
  COMBINED_MULTIPLIER_MAX,
  kstHourNow,
  kstColdStartMultiplier,
  trendMultiplierFromAvgRate,
  multiplierBandFromAvgRate,
  computeTurnoverAnalysis,
  shareOfVoiceMultiplierFromSoV,
  computeShareOfVoice,
  buildTrendInsightsPayload,
} from './trends.js';

export type {
  TrendConfidenceReason,
  TrendMultiplierBand,
  TrendHourlyBucket,
  TrendInsightsPayload,
  TurnoverAnalysis,
} from './trends.js';

export {
  ADAPTATION_ELIGIBLE_SIGNAL_CLASSES,
  OPPORTUNITY_MULTIPLIER_MIN,
  OPPORTUNITY_MULTIPLIER_MAX,
  classifySchedulerSignal,
  buildSchedulerSignalTimeline,
  summarizeSchedulerSignals,
  buildSchedulerAdaptationWindows,
} from './schedulerSignals.js';

export type {
  SchedulerSignalClass,
  SchedulerSignalEvent,
  SchedulerSignalSummary,
  SchedulerSignalSummaryOptions,
  SchedulerAdaptationWindowSummary,
} from './schedulerSignals.js';

export {
  parsePostBoardDate,
  extractNewPostEvents,
  buildCompetitorAnalyticsPayload,
  parseAnalyticsQuery,
} from './competitors.js';

export type {
  AnalyticsBucket,
  NewPostEvent,
  CompetitorAnalyticsQuery,
  DataHealthStrip,
  AuthorSummaryRow,
  HeatmapCell,
  HeatmapBlock,
  BotLikenessTier,
  AuthorBotSignals,
  CompetitorAnalyticsPayload,
} from './competitors.js';
