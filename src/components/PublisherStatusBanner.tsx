import React from 'react';
import { type UseAppDataReturn } from '../hooks/useAppData';

export default function PublisherStatusBanner({ app }: { app: UseAppDataReturn }) {
  const s = app.controlPanel.autoPublisher;
  const isEnabled = s.enabled;
  const isRunning = s.running;

  const toggleEnabled = () => {
    app.setControlPanel((c) => ({ ...c, autoPublisher: { ...c.autoPublisher, enabled: !isEnabled } }));
    // Immediately persist the toggle without requiring manual "Apply Controls"
    void app.saveControlPanel();
  };

  let etaLabel = '';
  if (isEnabled && !isRunning && s.nextTickEta) {
    const ms = new Date(s.nextTickEta).getTime() - Date.now();
    if (ms > 0) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      etaLabel = mins > 0 ? `Next tick in ${mins}m ${secs}s` : `Next tick in ${secs}s`;
    }
  }

  return (
    <div className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
      isRunning
        ? 'bg-orange-600/15 border-orange-500/40'
        : isEnabled
        ? 'bg-emerald-600/10 border-emerald-500/30'
        : 'bg-white/5 border-white/10'
    }`}>
      <div className="flex items-center gap-4">
        {/* Status dot */}
        <div className={`w-3 h-3 rounded-full shrink-0 ${
          isRunning ? 'bg-orange-500 animate-pulse' : isEnabled ? 'bg-emerald-500' : 'bg-white/20'
        }`} />
        <div>
          <p className="text-sm font-bold">
            Auto-Publisher —{' '}
            <span className={isRunning ? 'text-orange-400' : isEnabled ? 'text-emerald-400' : 'text-white/40'}>
              {isRunning ? 'Running' : isEnabled ? 'Active' : 'Paused'}
            </span>
          </p>
          <p className="text-[10px] opacity-40 mt-0.5">
            {isRunning
              ? `Publishing now (gap check + browser flow in progress)…`
              : isEnabled
              ? `Interval: ${s.effectiveIntervalMinutes}m effective${etaLabel ? ` · ${etaLabel}` : ''}`
              : 'Scheduler is paused — no automatic publishes will fire'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={toggleEnabled}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 transition-all focus:outline-none ${
          isEnabled ? 'bg-emerald-600 border-emerald-500' : 'bg-white/10 border-white/20'
        }`}
        aria-label={isEnabled ? 'Pause auto-publisher' : 'Enable auto-publisher'}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform mt-0.5 ${isEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
