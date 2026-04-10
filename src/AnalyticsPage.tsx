import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, ChevronLeft, ChevronDown, ChevronUp, Download, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { AuthorSummaryRow, CompetitorAnalyticsPayload } from '../lib/competitorAnalytics';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SERIES_COLORS = [
  '#ea580c',
  '#38bdf8',
  '#a78bfa',
  '#4ade80',
  '#f472b6',
  '#fbbf24',
  '#2dd4bf',
  '#94a3b8',
  '#f87171',
  '#c084fc',
  '#fcd34d',
  '#64748b'
];

function buildHeatmapGrid(cells: CompetitorAnalyticsPayload['heatmap']['cells'], authorFilter: string | null = null) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const c of cells) {
    if (authorFilter !== null && c.author?.toLowerCase().trim() !== authorFilter.toLowerCase().trim()) continue;
    if (c.dayOfWeek >= 0 && c.dayOfWeek <= 6 && c.hour >= 0 && c.hour <= 23) {
      grid[c.dayOfWeek][c.hour] += c.count;
      max = Math.max(max, grid[c.dayOfWeek][c.hour]);
    }
  }
  return { grid, max };
}

function formatGap(hours: number | null): string {
  if (hours === null) return 'n/a';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

function formatPostsPerActiveDay(row: AuthorSummaryRow): string {
  const v = row.postsPerActiveDay;
  const display = v.toFixed(1);
  if (row.activeDays >= 7) {
    const weekly = Math.round(v * 7);
    return `${display}/day · ~${weekly}/wk`;
  }
  return `${display}/day`;
}

function BotBadge({ tier }: { tier: 'low' | 'medium' | 'high' }) {
  const styles: Record<string, string> = {
    low: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    medium: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    high: 'bg-red-500/15 text-red-300 border border-red-500/30'
  };
  const labels: Record<string, string> = { low: 'Low', medium: 'Med', high: 'High' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles[tier]}`}>
      {labels[tier]}
    </span>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-[140px] px-5 py-4 rounded-xl border border-white/10 bg-white/[0.04]">
      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{label}</p>
      <p className="text-2xl font-bold text-orange-400 leading-none">{value}</p>
      {sub && <p className="text-[11px] text-white/40 mt-1">{sub}</p>}
    </div>
  );
}

function csvQuote(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: AuthorSummaryRow[], from: string, to: string): { csv: string; filename: string } {
  const headers = ['Rank', 'Author', 'Posts', 'Active Days', 'Posts/Active Day', 'Avg Views/Post', 'Avg Views Count'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([r.rank, r.author, r.postsInRange, r.activeDays, r.postsPerActiveDay, r.avgViewsPerPost, r.avgViewsPostCount].map(csvQuote).join(','));
  }
  return { csv: lines.join('\n'), filename: `competitors-${from}-${to}.csv` };
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [bucket, setBucket] = useState<'hour' | 'day' | 'week'>('day');
  const [excludeNotices, setExcludeNotices] = useState(true);
  const [payload, setPayload] = useState<CompetitorAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [botExpanded, setBotExpanded] = useState(false);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('from', new Date(from + 'T00:00:00.000Z').toISOString());
    params.set('to', new Date(to + 'T23:59:59.999Z').toISOString());
    params.set('bucket', bucket);
    if (excludeNotices) params.set('excludeNotices', 'true');
    return `/api/analytics/competitors?${params.toString()}`;
  }, [from, to, bucket, excludeNotices]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(queryUrl);
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Request failed');
        setPayload(null);
        return;
      }
      setPayload(data as CompetitorAnalyticsPayload);
    } catch {
      setError('Network error');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [queryUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const heat = payload ? buildHeatmapGrid(payload.heatmap.cells, selectedAuthor) : { grid: [], max: 0 };

  // KPI derivations
  const kpi = useMemo(() => {
    if (!payload || payload.summary.length === 0) return null;
    const top = payload.summary[0];
    const avgMarket =
      payload.summary.length > 0
        ? Math.round((payload.summary.reduce((s, r) => s + r.postsPerActiveDay, 0) / payload.summary.length) * 10) / 10
        : 0;
    return { topAuthor: top.author, topRate: top.postsPerActiveDay, topActiveDays: top.activeDays, avgMarket };
  }, [payload]);

  function handleRowClick(author: string) {
    setSelectedAuthor((prev) => (prev === author ? null : author));
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Dashboard
            </Link>
            <div className="flex items-center gap-2 border-l border-white/10 pl-4">
              <BarChart3 className="w-5 h-5 text-orange-500" />
              <h1 className="text-lg font-bold tracking-tight">Competitor EDA</h1>
            </div>
          </div>

          {/* Zone 1 — inline filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-white/50">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-white/50">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs"
              />
            </label>
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value as 'hour' | 'day' | 'week')}
              className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs"
            >
              <option value="hour">Hourly</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeNotices}
                onChange={(e) => setExcludeNotices(e.target.checked)}
                className="accent-orange-500"
              />
              No notices
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="px-3 py-1.5 rounded-full bg-orange-600 hover:bg-orange-500 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm">{error}</div>
        )}

        {!payload && !error && loading && (
          <p className="text-sm opacity-50 flex items-center gap-2 pt-4">
            <Activity className="w-4 h-4 animate-pulse" /> Loading analytics…
          </p>
        )}

        {payload && (
          <>
            {/* Zone 2 — KPI row */}
            {kpi && (
              <section className="flex flex-wrap gap-3">
                <KpiCard
                  label="Most Active"
                  value={kpi.topAuthor}
                  sub={`${kpi.topRate.toFixed(1)}/day · ${kpi.topActiveDays} active days`}
                />
                <KpiCard
                  label="Market Avg Posts/Day"
                  value={kpi.avgMarket.toFixed(1)}
                  sub={`across ${payload.summary.length} authors`}
                />
                <KpiCard
                  label="Data Freshness"
                  value={
                    <span className={payload.dataHealth.largeGapWarning ? 'text-amber-400' : 'text-orange-400'}>
                      {formatGap(payload.dataHealth.medianGapHours)}
                    </span>
                  }
                  sub={
                    payload.dataHealth.largeGapWarning
                      ? '⚠ Wide gaps — rates approximate'
                      : `${payload.dataHealth.snapshotCount} snapshots`
                  }
                />
              </section>
            )}

            {/* Zone 3 — Summary table */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <p className="text-xs uppercase tracking-widest text-white/40">Competitors</p>
                <div className="flex items-center gap-3">
                  {selectedAuthor && (
                    <button
                      type="button"
                      onClick={() => setSelectedAuthor(null)}
                      className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      ← All authors
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { const { csv, filename } = buildCsv(payload.summary, from, to); downloadCsv(csv, filename); }}
                    disabled={payload.summary.length === 0}
                    className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 disabled:opacity-30 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase text-white/40">
                      <th className="px-6 py-3 font-medium">#</th>
                      <th className="px-6 py-3 font-medium">Author</th>
                      <th className="px-6 py-3 font-medium">Posts</th>
                      <th className="px-6 py-3 font-medium">Posts / Active Day</th>
                      <th className="px-6 py-3 font-medium">Avg Views / Post</th>
                      <th className="px-6 py-3 font-medium">Bot Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.summary.map((row) => {
                      const botRow = payload.botSignals.find((b) => b.author === row.author);
                      const isSelected = selectedAuthor === row.author;
                      return (
                        <tr
                          key={row.author}
                          onClick={() => handleRowClick(row.author)}
                          className={`border-b border-white/5 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-orange-500/10 hover:bg-orange-500/15'
                              : 'hover:bg-white/[0.04]'
                          }`}
                        >
                          <td className="px-6 py-3 text-white/40">{row.rank}</td>
                          <td className="px-6 py-3 font-medium">
                            <span className={isSelected ? 'text-orange-400' : ''}>{row.author}</span>
                          </td>
                          <td className="px-6 py-3">{row.postsInRange}</td>
                          <td className="px-6 py-3 tabular-nums">{formatPostsPerActiveDay(row)}</td>
                          <td className="px-6 py-3 tabular-nums">
                            {row.avgViewsPerPost.toLocaleString()}
                            {row.avgViewsPostCount < row.postsInRange && <sup className="text-white/30 ml-0.5">*</sup>}
                          </td>
                          <td className="px-6 py-3">
                            {botRow ? <BotBadge tier={botRow.heuristicTier} /> : <span className="text-white/20">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {payload.summary.some((r) => r.avgViewsPostCount < r.postsInRange) && (
                  <p className="px-6 py-2 text-[10px] text-white/30">
                    * Avg views computed on non-notice posts only.
                  </p>
                )}
              </div>
            </section>

            {/* Zone 4 — Charts */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10">
                <p className="text-xs uppercase tracking-widest text-white/40">
                  {selectedAuthor ? `Posting activity · ${selectedAuthor}` : 'Market posting activity'}
                </p>
              </div>
              <div className="p-6 space-y-6">
                {payload.timeSeries.length === 0 ? (
                  <p className="text-sm text-white/40">No new post events in this window.</p>
                ) : (
                  <>
                    {/* Timeline: single-author → one line (or empty-state); all → _total only */}
                    <div className="h-64">
                      {selectedAuthor && !payload.timeSeries.some((row) => (row[selectedAuthor] as number) > 0) ? (
                        <div className="h-full flex items-center justify-center">
                          <p className="text-sm text-amber-400/70 text-center">
                            No posts from <span className="font-medium">{selectedAuthor}</span> in this range.
                            <br />
                            <span className="text-white/40">Change the date range or clear the selection.</span>
                          </p>
                        </div>
                      ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={payload.timeSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" />
                          <XAxis dataKey="bucket" tick={{ fill: '#ffffff55', fontSize: 10 }} />
                          <YAxis tick={{ fill: '#ffffff55', fontSize: 10 }} allowDecimals={false} />
                          <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: 8 }} />
                          {selectedAuthor ? (
                            <Line
                              type="monotone"
                              dataKey={selectedAuthor}
                              name={selectedAuthor}
                              stroke="#f97316"
                              strokeWidth={2}
                              dot={false}
                            />
                          ) : (
                            <Line
                              type="monotone"
                              dataKey="_total"
                              name="Total"
                              stroke="#f97316"
                              strokeWidth={2}
                              dot={false}
                            />
                          )}
                          <Legend />
                        </LineChart>
                      </ResponsiveContainer>
                      )}
                    </div>

                    {/* Share-of-voice bar — only in All mode */}
                    {!selectedAuthor && (
                      <div className="h-56">
                        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Share of voice</p>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={payload.timeSeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" />
                            <XAxis dataKey="bucket" tick={{ fill: '#ffffff55', fontSize: 10 }} />
                            <YAxis tick={{ fill: '#ffffff55', fontSize: 10 }} allowDecimals={false} />
                            <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: 8 }} />
                            <Legend />
                            {payload.seriesAuthors.map((key, i) => (
                              <Bar
                                key={key}
                                dataKey={key}
                                stackId="posts"
                                fill={key === '_other' ? '#475569' : SERIES_COLORS[i % SERIES_COLORS.length]}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* Heatmap */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <p className="text-xs uppercase tracking-widest text-white/40">
                  {selectedAuthor ? `Posting schedule · ${selectedAuthor}` : 'Activity heatmap (all authors)'}
                </p>
                <span className="text-[10px] text-white/25">
                  {payload.heatmap.mode === 'post_date_parsed' ? 'post date (parsed)' : 'snapshot hour only'}
                </span>
              </div>
              <div className="p-6 overflow-x-auto">
                <div
                  className="inline-grid gap-px bg-white/10 p-px rounded"
                  style={{ gridTemplateColumns: `auto repeat(24, minmax(0, 1fr))` }}
                >
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-[8px] text-center text-white/30 py-1 w-6">
                      {h}
                    </div>
                  ))}
                  {DOW.map((label, dow) => (
                    <React.Fragment key={label}>
                      <div className="text-[10px] text-white/50 pr-2 py-0.5 flex items-center">{label}</div>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const row = heat.grid[dow];
                        const v = row ? (row[hour] ?? 0) : 0;
                        const intensity = heat.max > 0 ? v / heat.max : 0;
                        const bg = `rgba(234, 88, 12, ${0.12 + intensity * 0.88})`;
                        return (
                          <div
                            key={`${dow}-${hour}`}
                            className="w-6 h-5 rounded-sm"
                            style={{ backgroundColor: bg }}
                            title={`${label} ${hour}:00 — ${v} posts`}
                          />
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>

            {/* Zone 5 — Bot signals (collapsible) */}
            <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] overflow-hidden">
              <button
                type="button"
                onClick={() => setBotExpanded((v) => !v)}
                className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-amber-500/5 transition-colors"
              >
                <p className="text-xs uppercase tracking-widest text-amber-200/70">
                  Advanced: Bot-Likeness Signals
                </p>
                {botExpanded ? (
                  <ChevronUp className="w-4 h-4 text-amber-200/50" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-amber-200/50" />
                )}
              </button>
              {botExpanded && (
                <div className="px-6 pb-6 space-y-4">
                  <p className="text-xs text-white/40 leading-relaxed border-t border-amber-500/10 pt-4">
                    {payload.disclaimer}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] uppercase text-white/40">
                          <th className="pb-2 pr-2">Author</th>
                          <th className="pb-2 pr-2">n</th>
                          <th className="pb-2 pr-2">Tier</th>
                          <th className="pb-2 pr-2">CV gaps</th>
                          <th className="pb-2 pr-2">Clock 5m</th>
                          <th className="pb-2 pr-2">H entropy</th>
                          <th className="pb-2 pr-2">Uniformity</th>
                          <th className="pb-2 pr-2">Burst 6h</th>
                          <th className="pb-2">Burst ratio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.botSignals.map((b) => (
                          <tr key={b.author} className="border-b border-white/5">
                            <td className="py-2 pr-2 font-medium">{b.author}</td>
                            <td className="py-2 pr-2">{b.postCount}</td>
                            <td className="py-2 pr-2">
                              <BotBadge tier={b.heuristicTier} />
                            </td>
                            <td className="py-2 pr-2 font-mono text-xs">
                              {b.interArrivalCv === null ? '—' : b.interArrivalCv.toFixed(2)}
                            </td>
                            <td className="py-2 pr-2 font-mono text-xs">{b.clockAlignmentScore.toFixed(2)}</td>
                            <td className="py-2 pr-2 font-mono text-xs">{b.hourEntropy.toFixed(2)}</td>
                            <td className="py-2 pr-2 font-mono text-xs">{b.circadianUniformity.toFixed(2)}</td>
                            <td className="py-2 pr-2">{b.burstMaxIn6h}</td>
                            <td className="py-2 font-mono text-xs">{b.burstRatio.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
