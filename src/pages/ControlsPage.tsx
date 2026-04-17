import React from 'react';
import { motion } from 'motion/react';
import { type UseAppDataReturn } from '../hooks/useAppData';
import { applyRuntimePreset, type ControlPanelState } from '../lib/controlPanel';
import PublisherStatusBanner from '../components/PublisherStatusBanner';
import ObserverPanel from '../components/observer/ObserverPanel';
import SchedulerPanel from '../components/scheduler/SchedulerPanel';
import SchedulerDiagnosticsWidget from '../components/scheduler/SchedulerDiagnosticsWidget';
import PublisherSettingsPanel from '../components/publisher/PublisherSettingsPanel';
import AiAdvisorPanel from '../components/AiAdvisorPanel';

export default function ControlsPage({ app }: { app: UseAppDataReturn }) {
  return (
    <>
      <PublisherStatusBanner app={app} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6" onChangeCapture={() => app.setControlDirty(true)}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Runtime Control Panel</h2>
          <div className="text-right">
            {app.controlDirty && <span className="block text-[10px] text-amber-300/80">Unsaved local edits</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs opacity-60 uppercase tracking-widest">Preset</label>
          <select value={app.controlPanel.preset} onChange={(e) => app.setControlPanel((c) => applyRuntimePreset(e.target.value as ControlPanelState['preset'], c))} className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm">
            <option value="balanced">Balanced</option><option value="night-safe">Night Safe</option><option value="day-aggressive">Day Aggressive</option>
          </select>
          <span className="text-[10px] opacity-40">Preset updates both observer pacing and scheduler cadence.</span>
        </div>
        <div className="flex items-center gap-2">
          {(['observer', 'scheduler', 'publisher'] as const).map((s) => (
            <button key={s} type="button" onClick={() => app.setControlPanelSection(s)} className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest border transition-all ${app.controlPanelSection === s ? 'bg-orange-600 border-orange-500 text-white' : 'bg-white/5 border-white/10 opacity-70 hover:opacity-100'}`}>{s}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {app.controlPanelSection === 'observer' && <ObserverPanel app={app} />}
          {app.controlPanelSection === 'scheduler' && <SchedulerPanel app={app} />}
        </div>
        {app.controlPanelSection === 'scheduler' && (
          <SchedulerDiagnosticsWidget
            trendInsights={app.trendInsights}
            stateVersion={app.controlPanel.stateVersion}
            persistedAt={app.controlPanel.persistedAt}
          />
        )}
        {app.controlPanelSection === 'publisher' && <PublisherSettingsPanel app={app} />}
        <div className="pt-4 border-t border-white/10 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">System Kill-switches</p>
          <label className="flex items-center justify-between text-sm">
            <span>
              NL Webhook
              <span className="ml-2 text-[10px] opacity-40">POST /api/nl-command</span>
            </span>
            <button
              type="button"
              onClick={() => { app.setControlPanel((c) => ({ ...c, nlWebhookEnabled: !c.nlWebhookEnabled })); app.setControlDirty(true); }}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-all focus:outline-none ${
                app.controlPanel.nlWebhookEnabled ? 'bg-emerald-600 border-emerald-500' : 'bg-white/10 border-white/20'
              }`}
              aria-label="Toggle NL webhook"
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-md transition-transform mt-px ${app.controlPanel.nlWebhookEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </button>
          </label>
        </div>

        <div className="flex items-center justify-end">
          <button onClick={() => { void app.saveControlPanel(); }} disabled={app.controlSaving} className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 transition-all text-sm font-bold disabled:opacity-50">{app.controlSaving ? 'Saving...' : 'Apply Controls'}</button>
        </div>
      </motion.div>
      <AiAdvisorPanel app={app} />
    </>
  );
}
