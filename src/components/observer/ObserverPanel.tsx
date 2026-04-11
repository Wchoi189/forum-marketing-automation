import React from 'react';
import { NumField } from '../ui/FormFields';
import { type UseAppDataReturn } from '../../hooks/useAppData';

type GapSourcePin = 'env' | 'spec' | null;

const SOURCE_OPTIONS: { pin: GapSourcePin; label: string; hint: string }[] = [
  { pin: null,    label: 'File override', hint: 'Set an explicit value below; falls through to env → spec if empty.' },
  { pin: 'env',   label: 'Env var',       hint: 'Always use the OBSERVER_GAP_THRESHOLD env var (skips file override).' },
  { pin: 'spec',  label: 'Spec default',  hint: 'Always use the spec baseline (skips both file override and env var).' },
];

export default function ObserverPanel({ app }: { app: UseAppDataReturn }) {
  const o = app.controlPanel.observer;
  const setObs = (patch: Partial<typeof o>) => app.setControlPanel((c) => ({ ...c, observer: { ...c.observer, ...patch } }));

  function selectSource(pin: GapSourcePin) {
    if (pin === null) {
      setObs({ gapSourcePin: null });
    } else {
      // Pinning to env or spec — clear any file override so the value is unambiguous
      setObs({ gapSourcePin: pin, gapPersistedOverride: null });
    }
  }

  const activeHint = SOURCE_OPTIONS.find(s => s.pin === o.gapSourcePin)?.hint ?? '';
  const fileOverrideActive = o.gapSourcePin === null;

  return (
    <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10 lg:col-span-2">
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Observer Pacing</p>
      <label className="flex items-center justify-between text-sm"><span>Observer enabled</span><input type="checkbox" checked={o.enabled} onChange={(e) => setObs({ enabled: e.target.checked })} /></label>
      <NumField label="Min delay before board visit (ms)" value={o.minPreVisitDelayMs} onChange={(v) => setObs({ minPreVisitDelayMs: Math.max(0, v) })} />
      <NumField label="Max delay before board visit (ms)" value={o.maxPreVisitDelayMs} onChange={(v) => setObs({ maxPreVisitDelayMs: Math.max(0, v) })} />
      <NumField label="Minimum time between observer runs (ms)" value={o.minIntervalBetweenRunsMs} onChange={(v) => setObs({ minIntervalBetweenRunsMs: Math.max(0, v) })} />

      <div className="pt-2 border-t border-white/10 space-y-3">
        <p className="text-[10px] opacity-50 uppercase tracking-wider">Gap policy (publish safety)</p>

        {/* Source selector */}
        <div className="space-y-1">
          <p className="text-xs opacity-60">Gap threshold source</p>
          <div className="flex gap-1">
            {SOURCE_OPTIONS.map(({ pin, label }) => {
              const active = o.gapSourcePin === pin;
              return (
                <button
                  key={String(pin)}
                  type="button"
                  onClick={() => selectSource(pin)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                    active
                      ? 'bg-orange-500/20 border-orange-400/50 text-orange-300'
                      : 'bg-black/30 border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {activeHint && <p className="text-[10px] opacity-40 leading-relaxed">{activeHint}</p>}
        </div>

        {/* Effective value row */}
        <p className="text-[11px] opacity-45">
          Effective: <span className="text-white font-mono">{o.gapThresholdMin}</span> posts
          {' · '}Spec baseline: <span className="text-white font-mono">{o.gapThresholdSpecBaseline}</span>
          {' · '}Source: <span className="text-orange-300/90">{o.gapSource === 'file' ? 'persisted file' : o.gapSource}</span>
        </p>

        {/* File override input — only active in file mode */}
        <div className={fileOverrideActive ? '' : 'opacity-30 pointer-events-none'}>
          <label className="block text-xs opacity-60 mb-1">
            File override value {fileOverrideActive ? '(empty = fall through to env → spec)' : '(disabled — pin active)'}
          </label>
          <input
            type="number"
            min={1}
            max={50}
            placeholder={`e.g. ${o.gapThresholdMin}`}
            value={o.gapPersistedOverride ?? ''}
            disabled={!fileOverrideActive}
            onChange={(e) => {
              const r = e.target.value;
              setObs({ gapPersistedOverride: r === '' ? null : Math.max(1, Math.min(50, Math.round(Number(r)) || 1)) });
            }}
            className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
