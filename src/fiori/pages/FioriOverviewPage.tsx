import { Card, CardHeader, Tag, Title, Text, FlexBox, FlexBoxDirection, FlexBoxWrap } from '@ui5/webcomponents-react';
import { useAppData } from '../../hooks/useAppData';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtPct(n: number | string | undefined | null) {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return isNaN(num) ? String(n) : `${(num * 100).toFixed(1)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SchedulerCard({ app }: { app: ReturnType<typeof useAppData> }) {
  const { autoPublisher } = app.controlPanel;
  const statusDesign = autoPublisher.running
    ? 'Critical'
    : autoPublisher.enabled ? 'Positive' : 'Neutral';
  const statusText = autoPublisher.running
    ? 'Publishing…'
    : autoPublisher.enabled ? 'Active' : 'Paused';

  return (
    <Card
      accessibleName="Scheduler Status"
      header={<CardHeader titleText="Auto-Publisher" subtitleText="Scheduler state" />}
    >
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
          <Text>Status:</Text>
          <Tag design={statusDesign}>{statusText}</Tag>
        </FlexBox>
        <Text>
          Interval: {autoPublisher.effectiveIntervalMinutes ?? autoPublisher.baseIntervalMinutes} min
          {autoPublisher.trendAdaptiveEnabled ? ' (trend-adaptive)' : ''}
        </Text>
        {autoPublisher.enabled && !autoPublisher.running && autoPublisher.nextTickEta && (
          <Text>Next attempt: {fmtTime(autoPublisher.nextTickEta)}</Text>
        )}
        {autoPublisher.quietHoursStart != null && (
          <Text style={{ color: 'var(--sapNeutralTextColor)' }}>
            Quiet hours: {autoPublisher.quietHoursStart}:00 – {autoPublisher.quietHoursEnd}:00
          </Text>
        )}
      </div>
    </Card>
  );
}

function ObserverCard({ app }: { app: ReturnType<typeof useAppData> }) {
  const latest = app.logs[0];
  const { observer } = app.controlPanel;
  const gap = latest?.current_gap_count ?? 0;
  const required = latest?.gap_threshold_min ?? observer.gapThresholdMin;
  const isSafe = latest?.status === 'safe';
  const isUnsafe = latest?.status === 'unsafe';
  const safetyDesign = !latest ? 'Neutral' : isSafe ? 'Positive' : 'Negative';
  const safetyText = !latest ? 'No data' : isSafe ? 'Safe Zone' : isUnsafe ? 'Danger Zone' : 'Unknown';

  return (
    <Card
      accessibleName="Observer Status"
      header={<CardHeader titleText="Observer" subtitleText="Gap policy & board safety" />}
    >
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
          <Text>Safety:</Text>
          <Tag design={safetyDesign}>{safetyText}</Tag>
        </FlexBox>
        <Text>Gap: {gap} / {required} required</Text>
        <Text style={{ color: 'var(--sapNeutralTextColor)' }}>
          Source: {observer.gapSource ?? '—'}
        </Text>
        {latest?.timestamp && (
          <Text style={{ color: 'var(--sapNeutralTextColor)' }}>
            Last observed: {fmtTime(latest.timestamp)}
          </Text>
        )}
      </div>
    </Card>
  );
}

function BoardStatsCard({ app }: { app: ReturnType<typeof useAppData> }) {
  const stats = app.boardStats;
  return (
    <Card
      accessibleName="Board Stats"
      header={<CardHeader titleText="Board Stats" subtitleText="Share of Voice & turnover" />}
    >
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {stats ? (
          <>
            <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
              <Text>Share of Voice:</Text>
              <Tag colorScheme={stats.shareOfVoice > 0.15 ? '8' : '1'}>
                {fmtPct(stats.shareOfVoice)}
              </Tag>
            </FlexBox>
            <Text>Turnover Rate: {fmtPct(stats.turnoverRate)}</Text>
          </>
        ) : (
          <Text style={{ color: 'var(--sapNeutralTextColor)' }}>No board data yet</Text>
        )}
        {app.trendInsights && (
          <Text style={{ color: 'var(--sapNeutralTextColor)' }}>
            Scheduler multiplier: ×{app.trendInsights.trendMultiplier?.toFixed(2) ?? '1.00'}
            {app.trendInsights.multiplierBand ? ` (${app.trendInsights.multiplierBand})` : ''}
          </Text>
        )}
      </div>
    </Card>
  );
}

function PublisherHistoryCard({ app }: { app: ReturnType<typeof useAppData> }) {
  const recent = app.publisherHistory.slice(0, 5);
  const successCount = recent.filter((r) => r.decision === 'published_verified' || r.decision === 'dry_run').length;

  return (
    <Card
      accessibleName="Publisher History"
      header={
        <CardHeader
          titleText="Recent Publisher Runs"
          subtitleText={`Last ${recent.length} runs`}
          action={
            recent.length > 0
              ? <Tag design="Information">{successCount}/{recent.length} published</Tag>
              : undefined
          }
        />
      }
    >
      <div style={{ padding: '0.5rem 1rem 1rem' }}>
        {recent.length === 0 ? (
          <Text style={{ color: 'var(--sapNeutralTextColor)' }}>No publisher runs yet</Text>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sapList_BorderColor)', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem 0.5rem', color: 'var(--sapNeutralTextColor)' }}>Time</th>
                <th style={{ padding: '0.4rem 0.5rem', color: 'var(--sapNeutralTextColor)' }}>Decision</th>
                <th style={{ padding: '0.4rem 0.5rem', color: 'var(--sapNeutralTextColor)' }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((run, i) => {
                const isSuccess = run.decision === 'published_verified' || run.decision === 'dry_run';
                const isSkip = run.decision === 'gap_policy' || run.decision === 'manual_override_disabled';
                const rowDesign = (isSuccess ? 'Positive' : isSkip ? 'Neutral' : 'Negative') as 'Positive' | 'Neutral' | 'Negative';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--sapList_BorderColor, #e0e0e0)' }}>
                    <td style={{ padding: '0.4rem 0.5rem' }}>{fmtTime(run.at)}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <Tag design={rowDesign}>{run.decision ?? (run.success ? 'success' : 'error')}</Tag>
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', color: 'var(--sapNeutralTextColor)' }}>
                      {run.message ? run.message.slice(0, 40) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FioriOverviewPage() {
  const app = useAppData();

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem' }}>
      <Title>Overview</Title>

      <FlexBox wrap={FlexBoxWrap.Wrap} style={{ gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ minWidth: '280px', flex: '1 1 280px' }}>
          <SchedulerCard app={app} />
        </div>
        <div style={{ minWidth: '280px', flex: '1 1 280px' }}>
          <ObserverCard app={app} />
        </div>
        <div style={{ minWidth: '280px', flex: '1 1 280px' }}>
          <BoardStatsCard app={app} />
        </div>
        <div style={{ minWidth: '340px', flex: '2 1 340px' }}>
          <PublisherHistoryCard app={app} />
        </div>
      </FlexBox>
    </FlexBox>
  );
}
