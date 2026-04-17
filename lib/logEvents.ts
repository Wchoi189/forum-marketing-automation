export const LOG_EVENT = {
  observerRunStarted: 'observer.run.started',
  observerRunFinished: 'observer.run.finished',
  observerRunFailed: 'observer.run.failed',
  observerRunSkipped: 'observer.run.skipped',
  publisherRunStarted: 'publisher.run.started',
  publisherRunFinished: 'publisher.run.finished',
  publisherRunFailed: 'publisher.run.failed',
  publisherRunSkipped: 'publisher.run.skipped',
  publisherSubmitCompleted: 'publisher.submit.completed',
  publisherSubmitSkipped: 'publisher.submit.skipped',
  publisherArtifactsDir: 'publisher.artifacts.dir',
  publisherArtifactsTrace: 'publisher.artifacts.trace',
  publisherArtifactsTraceDiscarded: 'publisher.artifacts.trace.discarded',
  schedulerStarted: 'scheduler.started',
  schedulerTickStarted: 'scheduler.tick.started',
  schedulerTickSkipped: 'scheduler.tick.skipped',
  schedulerTickFailed: 'scheduler.tick.failed',
  schedulerTickFinished: 'scheduler.tick.finished',
  schedulerNextScheduled: 'scheduler.next.scheduled',
  serverStarted: 'server.started',
  apiTrendInsightsFailed: 'api.trend-insights.failed',
  apiRunObserverFailed: 'api.run-observer.failed',
  apiRunPublisherFailed: 'api.run-publisher.failed',
  apiControlPanelValidationFailed: 'api.control-panel.validation.failed',
  apiControlPanelPersistFailed: 'api.control-panel.persist.failed'
} as const;

export type LogEventName = (typeof LOG_EVENT)[keyof typeof LOG_EVENT];

