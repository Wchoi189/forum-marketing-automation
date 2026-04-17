import type { TrendInsights } from '../../lib/controlPanel';

type SchedulerDiagnosticsWidgetProps = {
  trendInsights: TrendInsights | null;
  stateVersion: number;
  persistedAt: string | null;
};

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatReason(reason: string): string {
  return reason.replace(/_/g, ' ');
}

export default function SchedulerDiagnosticsWidget({
  trendInsights,
  stateVersion,
  persistedAt,
}: SchedulerDiagnosticsWidgetProps) {
  const diagnostics = trendInsights?.schedulerSignals ?? null;

  return (
    <div className="rounded-2xl border border-emerald-300/25 bg-emerald-950/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-200/70">
            Scheduler Diagnostics
          </p>
          <p className="text-xs text-emerald-50/70 mt-1">
            Quick triage for isolated signal behavior and calibration posture.
          </p>
        </div>
        <div className="text-right text-[10px] text-emerald-100/60">
          <p>state v{stateVersion}</p>
          <p>{persistedAt ? new Date(persistedAt).toLocaleString() : 'never persisted'}</p>
        </div>
      </div>

      {!diagnostics && (
        <div className="rounded-xl border border-emerald-200/20 bg-black/25 p-3 text-xs text-emerald-100/80">
          Diagnostics are not available yet. Fetching <span className="font-mono">/api/trend-insights</span> should populate schedulerSignals.
        </div>
      )}

      {diagnostics && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-emerald-200/20 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-widest text-emerald-100/60">Multiplier</p>
              <p className="font-mono text-lg font-bold text-emerald-50">
                x{diagnostics.summary.isolatedMultiplier.toFixed(2)}
              </p>
              <p className="text-[10px] text-emerald-100/60">{formatReason(diagnostics.summary.reason)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200/20 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-widest text-emerald-100/60">Attempts</p>
              <p className="font-mono text-lg font-bold text-emerald-50">
                {diagnostics.summary.publishAttemptCount}/{diagnostics.summary.gapRecheckCount}
              </p>
              <p className="text-[10px] text-emerald-100/60">eligible {diagnostics.summary.adaptationEligibleCount}</p>
            </div>
            <div className="rounded-xl border border-emerald-200/20 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-widest text-emerald-100/60">Opportunity</p>
              <p className="font-mono text-lg font-bold text-emerald-50">{toPercent(diagnostics.summary.opportunityScore)}</p>
              <p className="text-[10px] text-emerald-100/60">success {toPercent(diagnostics.summary.successRate)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200/20 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-widest text-emerald-100/60">Bound Hit Rate</p>
              <p className="font-mono text-lg font-bold text-emerald-50">{toPercent(diagnostics.calibration.isolatedBoundHitRate)}</p>
              <p className="text-[10px] text-emerald-100/60">{formatReason(diagnostics.calibration.recommendation)}</p>
            </div>
          </div>

          {diagnostics.latestWindow && (
            <div className="rounded-xl border border-emerald-200/20 bg-black/25 p-3 text-xs text-emerald-50/85">
              <p>
                Latest window #{diagnostics.latestWindow.windowIndex}: {diagnostics.latestWindow.startAt} to{' '}
                {diagnostics.latestWindow.endAt}
              </p>
              <p className="text-emerald-100/70 mt-1">
                delta from baseline {diagnostics.latestWindow.deltaFromBaseline.toFixed(3)} ({formatReason(diagnostics.latestWindow.reason)})
              </p>
            </div>
          )}

          <p className="text-[10px] text-emerald-100/60">
            Deep-dive endpoint: <span className="font-mono">/api/scheduler-signals?windowDays=14&amp;windowSize=8&amp;historyLimit=240</span>
          </p>
        </>
      )}
    </div>
  );
}
