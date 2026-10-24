import React from 'react';
import type { CompetitorAnalyticsPayload } from '../../../lib/analytics/index';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

export function Heatmap({
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
