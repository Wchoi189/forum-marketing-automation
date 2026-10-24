import { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { CompetitorAnalyticsPayload } from '../../../lib/analytics/index';
import { BotBadge } from './BotBadge';
import { Heatmap } from './Heatmap';

export function AuthorDrawer({
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
