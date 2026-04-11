import React from 'react';
import { NumField } from '../ui/FormFields';
import { type UseAppDataReturn } from '../../hooks/useAppData';
import { gapPolicySourceLabel } from '../../lib/controlPanel';

export default function ObserverPanel({ app }: { app: UseAppDataReturn }) {
  const o = app.controlPanel.observer;
  const setObs = (patch: Partial<typeof o>) => app.setControlPanel((c) => ({ ...c, observer: { ...c.observer, ...patch } }));
  return (
    <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10 lg:col-span-2">
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Observer Pacing</p>
      <label className="flex items-center justify-between text-sm"><span>Observer enabled</span><input type="checkbox" checked={o.enabled} onChange={(e) => setObs({ enabled: e.target.checked })} /></label>
      <NumField label="Min delay before board visit (ms)" value={o.minPreVisitDelayMs} onChange={(v) => setObs({ minPreVisitDelayMs: Math.max(0, v) })} />
      <NumField label="Max delay before board visit (ms)" value={o.maxPreVisitDelayMs} onChange={(v) => setObs({ maxPreVisitDelayMs: Math.max(0, v) })} />
      <NumField label="Minimum time between observer runs (ms)" value={o.minIntervalBetweenRunsMs} onChange={(v) => setObs({ minIntervalBetweenRunsMs: Math.max(0, v) })} />
      <div className="pt-2 border-t border-white/10 space-y-2">
        <p className="text-[10px] opacity-50 uppercase tracking-wider">Gap policy (publish safety)</p>
        <p className="text-[11px] opacity-45">Effective min gap: <span className="text-white font-mono">{o.gapThresholdMin}</span> posts · Spec baseline: <span className="text-white font-mono">{o.gapThresholdSpecBaseline}</span> · Source: <span className="text-orange-300/90">{gapPolicySourceLabel(o)}</span></p>
        <label className="block text-xs opacity-60">File override (empty = env/spec chain; Apply to persist)</label>
        <input type="number" min={1} max={50} placeholder={`e.g. ${o.gapThresholdMin}`} value={o.gapPersistedOverride ?? ''} onChange={(e) => { const r = e.target.value; setObs({ gapPersistedOverride: r === '' ? null : Math.max(1, Math.min(50, Math.round(Number(r)) || 1)) }); }} className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm" />
      </div>
    </div>
  );
}
