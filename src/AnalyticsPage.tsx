import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, ChevronLeft, RefreshCw } from 'lucide-react';
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
import type { CompetitorAnalyticsPayload } from '../lib/competitorAnalytics';

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

function buildHeatmapGrid(cells: CompetitorAnalyticsPayload['heatmap']['cells']) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const c of cells) {
    if (c.dayOfWeek >= 0 && c.dayOfWeek <= 6 && c.hour >= 0 && c.hour <= 23) {
      grid[c.dayOfWeek][c.hour] += c.count;
      max = Math.max(max, grid[c.dayOfWeek][c.hour]);
    }
  }
  return { grid, max };
}

export function AnalyticsPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [bucket, setBucket] = useState<'hour' | 'day' | 'week'>('day');
  const [excludeNotices, setExcludeNotices] = useState(true);
  const [payload, setPayload] = useState<CompetitorAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const heat = payload ? buildHeatmapGrid(payload.heatmap.cells) : { grid: [], max: 0 };

  const lineKeys = useMemo(() => {
    if (!payload) return [] as string[];
    return payload.seriesAuthors.filter((a) => a !== '_other');
  }, [payload]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
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
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <section className="p-6 rounded-2xl border border-white/10 bg-white/5 space-y-4">
          <p className="text-xs uppercase tracking-widest opacity-50">Filters</p>
          <div className="flex flex-wrap gap-4 items-end">
            <label className="text-xs opacity-60 block">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="block mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
            </label>
            <label className="text-xs opacity-60 block">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="block mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
            </label>
            <label className="text-xs opacity-60 block">
              Bucket
              <select
                value={bucket}
                onChange={(e) => setBucket(e.target.value as 'hour' | 'day' | 'week')}
                className="block mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm min-w-[120px]"
              >
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={excludeNotices}
                onChange={(e) => setExcludeNotices(e.target.checked)}
              />
              Exclude notice rows
            </label>
          </div>
        </section>

        {error && (
          <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm">{error}</div>
        )}

        {payload && (
          <>
            <section className="p-6 rounded-2xl border border-white/10 bg-white/5 space-y-2">
              <p className="text-xs uppercase tracking-widest opacity-50">Data health</p>
              <div className="flex flex-wrap gap-6 text-sm">
                <span>
                  Snapshots in range: <strong className="text-orange-400">{payload.dataHealth.snapshotCount}</strong>
                </span>
                <span>
                  Median gap between snapshots:{' '}
                  <strong className="text-orange-400">
                    {payload.dataHealth.medianGapHours === null
                      ? 'n/a'
                      : `${payload.dataHealth.medianGapHours.toFixed(1)} h`}
                  </strong>
                </span>
                {payload.dataHealth.largeGapWarning && (
                  <span className="text-amber-400">
                    Wide gaps between snapshots — rates are approximate (first-seen-in-snapshot).
                  </span>
                )}
              </div>
            </section>

            <section className="p-6 rounded-2xl border border-white/10 bg-white/5 space-y-4">
              <p className="text-xs uppercase tracking-widest opacity-50">New posts by bucket (first-seen)</p>
              {payload.timeSeries.length === 0 ? (
                <p className="text-sm opacity-50">No new post events in this window.</p>
              ) : (
                <>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={payload.timeSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                        <XAxis dataKey="bucket" tick={{ fill: '#ffffff88', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#ffffff88', fontSize: 10 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }} />
                        <Legend />
                        <Line type="monotone" dataKey="_total" name="Total" stroke="#f97316" strokeWidth={2} dot={false} />
                        {lineKeys.map((key, i) => (
                          <Line
                            key={key}
                            type="monotone"
                            dataKey={key}
                            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                            strokeWidth={1}
                            dot={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={payload.timeSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                        <XAxis dataKey="bucket" tick={{ fill: '#ffffff88', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#ffffff88', fontSize: 10 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }} />
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
            </section>

            <section className="p-6 rounded-2xl border border-white/10 bg-white/5 space-y-4">
              <p className="text-xs uppercase tracking-widest opacity-50">Summary</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase opacity-50">
                      <th className="pb-2 pr-4">#</th>
                      <th className="pb-2 pr-4">Author</th>
                      <th className="pb-2 pr-4">Posts</th>
                      <th className="pb-2 pr-4">Posts/day</th>
                      <th className="pb-2">Views (sum)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.summary.map((row) => (
                      <tr key={row.author} className="border-b border-white/5">
                        <td className="py-2 pr-4 opacity-50">{row.rank}</td>
                        <td className="py-2 pr-4 font-medium">{row.author}</td>
                        <td className="py-2 pr-4">{row.postsInRange}</td>
                        <td className="py-2 pr-4">{row.postsPerDay}</td>
                        <td className="py-2">{row.totalViews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="p-6 rounded-2xl border border-white/10 bg-white/5 space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-xs uppercase tracking-widest opacity-50">Activity heatmap</p>
                <span className="text-[10px] opacity-40">
                  Mode:{' '}
                  {payload.heatmap.mode === 'post_date_parsed'
                    ? 'post date (parsed when possible)'
                    : 'snapshot hour only'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <div className="inline-grid gap-px bg-white/10 p-px rounded" style={{ gridTemplateColumns: `auto repeat(24, minmax(0, 1fr))` }}>
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-[8px] text-center opacity-40 py-1 w-6">
                      {h}
                    </div>
                  ))}
                  {DOW.map((label, dow) => (
                    <React.Fragment key={label}>
                      <div className="text-[10px] opacity-60 pr-2 py-0.5 flex items-center">{label}</div>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const row = heat.grid[dow];
                        const v = row ? row[hour] ?? 0 : 0;
                        const intensity = heat.max > 0 ? v / heat.max : 0;
                        const bg = `rgba(234, 88, 12, ${0.15 + intensity * 0.85})`;
                        return (
                          <div
                            key={`${dow}-${hour}`}
                            className="w-6 h-5 rounded-sm"
                            style={{ backgroundColor: bg }}
                            title={`${label} ${hour}:00 — ${v}`}
                          />
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>

            <section className="p-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-4">
              <p className="text-xs uppercase tracking-widest text-amber-200/80">Bot-likeness heuristics</p>
              <p className="text-xs opacity-60 leading-relaxed">{payload.disclaimer}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase opacity-50">
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
                          <span
                            className={
                              b.heuristicTier === 'high'
                                ? 'text-red-400'
                                : b.heuristicTier === 'medium'
                                  ? 'text-amber-400'
                                  : 'text-emerald-400/90'
                            }
                          >
                            {b.heuristicTier}
                          </span>
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
            </section>
          </>
        )}

        {!payload && !error && loading && (
          <p className="text-sm opacity-50 flex items-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" /> Loading analytics…
          </p>
        )}
      </main>
    </div>
  );
}
