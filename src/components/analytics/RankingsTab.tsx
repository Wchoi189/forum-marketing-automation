import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Download } from 'lucide-react';
import type { CompetitorAnalyticsPayload } from '../../../lib/analytics/index';
import { buildCsv, downloadCsv } from '../../lib/analyticsCsv';
import { formatPostsPerActiveDay } from '../../lib/analyticsFormat';
import { BotBadge } from './BotBadge';

const TABLE_PAGE_SIZE = 8;

export function RankingsTab({
  payload,
  from,
  to,
  selectedAuthor,
  onSelectAuthor,
  page,
  onPageChange,
}: {
  payload: CompetitorAnalyticsPayload;
  from: string;
  to: string;
  selectedAuthor: string | null;
  onSelectAuthor: (author: string | null) => void;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(payload.summary.length / TABLE_PAGE_SIZE);
  const pagedRows = payload.summary.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);

  // Top 15 for ranked bar chart
  const rankedBarData = payload.summary.slice(0, 15).map((r) => ({
    author: r.author.length > 18 ? r.author.slice(0, 18) + '…' : r.author,
    postsPerActiveDay: r.postsPerActiveDay,
  }));

  return (
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
                    onClick={() => onSelectAuthor(isSelected ? null : row.author)}
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
              {page * TABLE_PAGE_SIZE + 1}–{Math.min((page + 1) * TABLE_PAGE_SIZE, payload.summary.length)} of {payload.summary.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPageChange(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-30 transition-colors"
              >
                ‹ Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPageChange(i)}
                  className={`w-7 h-7 rounded text-center transition-colors ${
                    i === page
                      ? 'bg-orange-600 text-white'
                      : 'border border-white/10 hover:bg-white/5'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                disabled={page === totalPages - 1}
                className="px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-30 transition-colors"
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
