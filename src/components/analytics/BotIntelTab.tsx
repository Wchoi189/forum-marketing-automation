import type { CompetitorAnalyticsPayload } from '../../../lib/analytics/index';
import { BotBadge } from './BotBadge';

export function BotIntelTab({ payload }: { payload: CompetitorAnalyticsPayload }) {
  return (
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
  );
}
