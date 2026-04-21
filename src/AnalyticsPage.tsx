import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, ChevronLeft, Download, RefreshCw, X } from 'lucide-react';
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

const TABLE_PAGE_SIZE = 8;

type ActiveTab = 'market' | 'rankings' | 'bot-intel';

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

function Heatmap({
  cells,
  mode,
  authorFilter,
}: {
  cells: CompetitorAnalyticsPayload['heatmap']['cells'];
  mode: CompetitorAnalyticsPayload['heatmap']['mode'];
  authorFilter: string | null;
}) {
  const heat = buildHeatmapGrid(cells, authorFilter);
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-white/40">
          {authorFilter ? `Posting schedule · ${authorFilter}` : 'Activity heatmap (all authors)'}
        </p>
        <span className="text-[10px] text-white/25">
          {mode === 'post_date_parsed' ? 'post date (parsed)' : 'snapshot hour only'}
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
  );
}

function AuthorDrawer({
  author,
  payload,
  onClose,
}: {
  author: string | null;
  payload: CompetitorAnalyticsPayload;
  onClose: () => void;
}) {
  const summaryRow = author ? payload.summary.find((r) => r.author === author) : null;
  const botRow = author ? payload.botSignals.find((b) => b.author === author) : null;

  // Escape key to close
  useEffect(() => {
    if (!author) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [author, onClose]);

  return (
    <div
      className={`fixed right-0 top-0 h-screen w-[360px] bg-[#111] border-l border-white/10 z-50 flex flex-col transition-transform duration-200 ease-in-out ${
        author ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {author && summaryRow && (
        <>
          {/* Drawer header */}
          <div className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-3 flex-shrink-0">
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight truncate">{author}</p>
              <div className="flex items-center gap-2 mt-1.5">
                {botRow && <BotBadge tier={botRow.heuristicTier} />}
                <span className="text-[11px] text-white/40">{summaryRow.postsInRange} posts</span>
                <span className="text-[11px] text-white/40">· {summaryRow.activeDays} active days</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors flex-shrink-0 mt-0.5"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer body — scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Mini timeline */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Posting timeline</p>
              {payload.timeSeries.some((row) => (row[author] as number) > 0) ? (
                <div className="h-[120px] min-w-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={payload.timeSeries} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" />
                      <XAxis dataKey="bucket" tick={{ fill: '#ffffff30', fontSize: 8 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#ffffff30', fontSize: 8 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 6, fontSize: 11 }}
                      />
                      <Line
                        type="monotone"
                        dataKey={author}
                        name={author}
                        stroke="#f97316"
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-white/30 italic">No posts in current date range.</p>
              )}
            </div>

            {/* Per-author heatmap */}
            <Heatmap
              cells={payload.heatmap.cells}
              mode={payload.heatmap.mode}
              authorFilter={author}
            />

            {/* Bot signal KV grid */}
            {botRow && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Bot signal metrics</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {[
                    ['CV gaps', botRow.interArrivalCv === null ? '—' : botRow.interArrivalCv.toFixed(2)],
                    ['Clock 5m', botRow.clockAlignmentScore.toFixed(2)],
                    ['H entropy', botRow.hourEntropy.toFixed(2)],
                    ['Uniformity', botRow.circadianUniformity.toFixed(2)],
                    ['Burst 6h', String(botRow.burstMaxIn6h)],
                    ['Burst ratio', botRow.burstRatio.toFixed(2)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-white/5 pb-1">
                      <span className="text-white/40">{k}</span>
                      <span className="font-mono text-white/70">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('market');
  const [tablePage, setTablePage] = useState(0);

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
      setTablePage(0);
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

  const totalPages = payload ? Math.ceil(payload.summary.length / TABLE_PAGE_SIZE) : 0;
  const pagedRows = payload
    ? payload.summary.slice(tablePage * TABLE_PAGE_SIZE, (tablePage + 1) * TABLE_PAGE_SIZE)
    : [];

  // Top 15 for ranked bar chart
  const rankedBarData = payload
    ? payload.summary.slice(0, 15).map((r) => ({
        author: r.author.length > 18 ? r.author.slice(0, 18) + '…' : r.author,
        postsPerActiveDay: r.postsPerActiveDay,
      }))
    : [];

  const tabs: { id: ActiveTab; label: string; count?: number }[] = [
    { id: 'market', label: 'Market' },
    { id: 'rankings', label: 'Rankings', count: payload?.summary.length },
    { id: 'bot-intel', label: 'Bot Intel', count: payload?.botSignals.length },
  ];

  const closeDrawer = useCallback(() => setSelectedAuthor(null), []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header — back nav + title + refresh only */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-40">
        <div className="px-6 h-14 flex items-center justify-between">
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
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh"
            className="p-2 rounded-full hover:bg-white/5 disabled:opacity-50 transition-colors text-white/60 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Two-column shell */}
      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {/* Sidebar — 240px, sticky */}
        <aside className="w-60 flex-shrink-0 border-r border-white/10 px-4 py-6 sticky top-14 self-start space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Date range</p>
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-xs text-white/50">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-white text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/50">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-white text-xs"
                />
              </label>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Bucket</p>
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value as 'hour' | 'day' | 'week')}
              className="w-full px-2 py-1.5 rounded-md bg-[#1a1a1a] border border-white/10 text-white text-xs [&>option]:bg-[#1a1a1a]"
            >
              <option value="hour">Hourly</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeNotices}
              onChange={(e) => setExcludeNotices(e.target.checked)}
              className="accent-orange-500"
            />
            Exclude notices
          </label>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-6 py-6 space-y-5">
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
              {/* KPI row — always visible */}
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

              {/* Tab bar */}
              <div className="flex gap-1 border-b border-white/10">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-2.5 text-sm font-medium transition-colors relative ${
                      activeTab === tab.id
                        ? 'text-white'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    {tab.label}
                    {tab.count !== undefined && (
                      <span className="ml-1.5 text-[10px] text-white/30">{tab.count}</span>
                    )}
                    {activeTab === tab.id && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab: Market — always market-wide, no author filter */}
              {activeTab === 'market' && (
                <div className="space-y-6">
                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/10">
                      <p className="text-xs uppercase tracking-widest text-white/40">Market posting activity</p>
                    </div>
                    <div className="p-6 space-y-6">
                      {payload.timeSeries.length === 0 ? (
                        <p className="text-sm text-white/40">No new post events in this window.</p>
                      ) : (
                        <>
                          <div className="h-64 min-w-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={payload.timeSeries}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" />
                                <XAxis dataKey="bucket" tick={{ fill: '#ffffff55', fontSize: 10 }} />
                                <YAxis tick={{ fill: '#ffffff55', fontSize: 10 }} allowDecimals={false} />
                                <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: 8 }} />
                                <Line
                                  type="monotone"
                                  dataKey="_total"
                                  name="Total"
                                  stroke="#f97316"
                                  strokeWidth={2}
                                  dot={false}
                                />
                                <Legend />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="h-56 min-w-[300px]">
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
                        </>
                      )}
                    </div>
                  </section>

                  <Heatmap
                    cells={payload.heatmap.cells}
                    mode={payload.heatmap.mode}
                    authorFilter={null}
                  />
                </div>
              )}

              {/* Tab: Rankings */}
              {activeTab === 'rankings' && (
                <div className="space-y-5">
                  {/* Ranked bar chart */}
                  {rankedBarData.length > 0 && (
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                      <div className="px-6 py-4 border-b border-white/10">
                        <p className="text-xs uppercase tracking-widest text-white/40">Posts / active day — top {rankedBarData.length}</p>
                      </div>
                      <div className="p-6">
                        <div style={{ height: Math.max(180, rankedBarData.length * 20) }} className="min-w-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              layout="vertical"
                              data={[...rankedBarData].reverse()}
                              margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" horizontal={false} />
                              <XAxis
                                type="number"
                                tick={{ fill: '#ffffff55', fontSize: 9 }}
                                allowDecimals
                              />
                              <YAxis
                                type="category"
                                dataKey="author"
                                tick={{ fill: '#ffffff70', fontSize: 9 }}
                                width={120}
                              />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: 8, fontSize: 11 }}
                                formatter={(v: number) => [v.toFixed(2), 'posts/active day']}
                              />
                              <Bar dataKey="postsPerActiveDay" fill="#ea580c" radius={[0, 3, 3, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Competitors table */}
                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-widest text-white/40">Competitors</p>
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
                          {pagedRows.map((row) => {
                            const botRow = payload.botSignals.find((b) => b.author === row.author);
                            const isSelected = selectedAuthor === row.author;
                            return (
                              <tr
                                key={row.author}
                                onClick={() => setSelectedAuthor((prev) => (prev === row.author ? null : row.author))}
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

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/40">
                        <span>
                          {tablePage * TABLE_PAGE_SIZE + 1}–{Math.min((tablePage + 1) * TABLE_PAGE_SIZE, payload.summary.length)} of {payload.summary.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                            disabled={tablePage === 0}
                            className="px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-30 transition-colors"
                          >
                            ‹ Prev
                          </button>
                          {Array.from({ length: totalPages }, (_, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setTablePage(i)}
                              className={`w-7 h-7 rounded text-center transition-colors ${
                                i === tablePage
                                  ? 'bg-orange-600 text-white'
                                  : 'border border-white/10 hover:bg-white/5'
                              }`}
                            >
                              {i + 1}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setTablePage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={tablePage === totalPages - 1}
                            className="px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-30 transition-colors"
                          >
                            Next ›
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* Tab: Bot Intel */}
              {activeTab === 'bot-intel' && (
                <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] overflow-hidden">
                  <div className="px-6 py-4 border-b border-amber-500/10">
                    <p className="text-xs uppercase tracking-widest text-amber-200/70">Bot-Likeness Signals</p>
                  </div>
                  <div className="px-6 py-6 space-y-4">
                    <p className="text-xs text-white/40 leading-relaxed">{payload.disclaimer}</p>
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
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {/* Author detail drawer — overlays main content */}
      {payload && (
        <AuthorDrawer
          author={selectedAuthor}
          payload={payload}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
