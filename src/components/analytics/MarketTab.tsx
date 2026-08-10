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
import type { CompetitorAnalyticsPayload } from '../../../lib/analytics/index';
import { Heatmap } from './Heatmap';

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

/** Market-wide view: never filtered by author. */
export function MarketTab({ payload }: { payload: CompetitorAnalyticsPayload }) {
  return (
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
  );
}
