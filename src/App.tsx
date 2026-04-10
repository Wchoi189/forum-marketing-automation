import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Activity, RefreshCw, Send, Users, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PipelineCanvas, { PipelineStepId } from './PipelineCanvas';
import { useAppData, type UseAppDataReturn } from './hooks/useAppData';
import LogDetailModal from './components/LogDetailModal';
import OverrideConfirmModal from './components/OverrideConfirmModal';
import OverviewPage from './pages/OverviewPage';
import {
  stripTaggedErrorPrefix,
  gapPolicySourceLabel,
  applyRuntimePreset,
  type ControlPanelState,
  type AiAdvisorOutput
} from './lib/controlPanel';

export default function App() {
  const location = useLocation();
  const onOverview = location.pathname === '/' || location.pathname === '/overview';
  const onOperations = location.pathname === '/operations';
  const onControls = location.pathname === '/controls';
  const onPublisherRuns = location.pathname === '/publisher-runs';

  const app = useAppData();
  const [simulationIndex, setSimulationIndex] = useState<number>(-1);
  const [isSimulating, setIsSimulating] = useState(false);
  const STAGES: PipelineStepId[] = ['navigate', 'login-page', 'login', 'write-post', 'restore-draft', 'publish'];

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (isSimulating && simulationIndex < STAGES.length) {
      timeout = setTimeout(() => setSimulationIndex(prev => prev + 1), 1500);
    } else if (isSimulating && simulationIndex === STAGES.length) {
      setIsSimulating(false);
    }
    return () => clearTimeout(timeout);
  }, [isSimulating, simulationIndex]);

  const isPublishing = app.loading || app.controlPanel.autoPublisher.running;
  const currentStep: PipelineStepId = isPublishing
    ? (app.realPublisherStep ?? 'navigate')
    : simulationIndex === -1 ? 'standby'
    : simulationIndex >= STAGES.length ? 'complete'
    : STAGES[simulationIndex];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30 flex">
      <aside className="w-56 shrink-0 border-r border-white/10 bg-black/40 p-4 hidden lg:block">
        <div className="text-xs uppercase tracking-widest opacity-40 mb-3">Navigation</div>
        <nav className="space-y-2">
          {[
            { to: '/overview', label: 'Overview' },
            { to: '/operations', label: 'Operations' },
            { to: '/controls', label: 'Controls' },
            { to: '/publisher-runs', label: 'Publisher Runs' },
            { to: '/analytics', label: 'Competitor EDA' }
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-2 rounded-lg text-sm border transition-all ${
                  isActive ? 'bg-orange-600/20 border-orange-500/40 text-orange-200' : 'border-white/10 hover:bg-white/5'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight uppercase italic">Ppomppu OTT Bot</h1>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/analytics" className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium">
                Competitor EDA
              </Link>
              <button onClick={app.runObserver} disabled={app.loading} className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center gap-2 text-sm font-medium disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${app.loading ? 'animate-spin' : ''}`} />
                Refresh Observer
              </button>
              <button onClick={() => app.runPublisher(true)} disabled={app.loading} className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 transition-all flex items-center gap-2 text-sm font-bold shadow-lg shadow-orange-600/20 disabled:opacity-50">
                <Send className="w-4 h-4" />
                Manual Override
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
          {onOverview && (
            <OverviewPage
              app={app}
              currentStep={currentStep}
              simulationIndex={simulationIndex}
              isSimulating={isSimulating}
              STAGES={STAGES}
              onStartSimulation={() => { setSimulationIndex(0); setIsSimulating(true); }}
              onResetSimulation={() => { setSimulationIndex(-1); setIsSimulating(false); }}
            />
          )}
          {onPublisherRuns && <PublisherRunsPage app={app} />}
          {onControls && <ControlsPage app={app} />}
          {onOperations && <OperationsPage app={app} />}
        </main>

        {app.selectedLog && <LogDetailModal log={app.selectedLog} onClose={() => app.setSelectedLog(null)} />}
        {app.showOverrideModal && <OverrideConfirmModal onConfirm={() => { app.setShowOverrideModal(false); app.runPublisher(true); }} onCancel={() => app.setShowOverrideModal(false)} />}
      </div>
    </div>
  );
}

/* ── Page components (Phase 4 — remaining pages to extract) ──────────────── */

function PublisherRunsPage({ app }: { app: UseAppDataReturn }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Publisher Runs</h2>
        <button type="button" onClick={app.fetchPublisherHistory} className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-widest hover:bg-white/10">Refresh</button>
      </div>
      <div className="space-y-2">
        {app.publisherHistory.length === 0 ? (
          <p className="text-sm opacity-50">No publisher runs recorded yet.</p>
        ) : (
          app.publisherHistory.map((row, i) => (
            <div key={`${row.at}-${i}`} className="p-3 rounded-xl border border-white/10 bg-black/20 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono opacity-70">{new Date(row.at).toLocaleString()}</span>
                <span className={row.success ? 'text-emerald-400 font-bold uppercase' : 'text-red-400 font-bold uppercase'}>{row.success ? 'ok' : 'fail'}</span>
                {row.decision && <span className="opacity-60 uppercase">{row.decision.replace(/_/g, ' ')}</span>}
                {row.artifactDir && <span className="font-mono opacity-50">{row.artifactDir}</span>}
              </div>
              <div className="opacity-75 mt-1">{stripTaggedErrorPrefix(row.message)}</div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}

function ControlsPage({ app }: { app: UseAppDataReturn }) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6" onChangeCapture={() => app.setControlDirty(true)}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Runtime Control Panel</h2>
          <div className="text-right">
            <span className="block text-[10px] opacity-40 uppercase tracking-widest">Scheduler: {app.controlPanel.autoPublisher.enabled ? 'Enabled' : 'Paused'} / {app.controlPanel.autoPublisher.running ? 'Running' : 'Idle'} / Effective {app.controlPanel.autoPublisher.effectiveIntervalMinutes}m</span>
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
        {app.controlPanelSection === 'publisher' && <PublisherSettingsPanel app={app} />}
        <div className="flex items-center justify-end">
          <button onClick={app.saveControlPanel} disabled={app.controlSaving} className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 transition-all text-sm font-bold disabled:opacity-50">{app.controlSaving ? 'Saving...' : 'Apply Controls'}</button>
        </div>
      </motion.div>
      <AiAdvisorPanel app={app} />
    </>
  );
}

function AiAdvisorPanel({ app }: { app: UseAppDataReturn }) {
  const { aiRec, aiRecBuiltAt, aiRecApplied, applyAiRecommendation, loading } = app;

  const ageMinutes = aiRecBuiltAt ? Math.round((Date.now() - new Date(aiRecBuiltAt).getTime()) / 60000) : null;
  const isStale = ageMinutes !== null && ageMinutes > 30;

  const confidenceBadge: Record<AiAdvisorOutput['confidence'], string> = {
    high: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    low: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">AI Advisor</h2>
        {aiRec && (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${confidenceBadge[aiRec.confidence]}`}>
            {aiRec.confidence}
          </span>
        )}
      </div>

      {aiRec ? (
        <>
          <div className="flex gap-8">
            <div>
              <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Interval</p>
              <p className="font-mono text-xl font-bold">{aiRec.recommendedIntervalMinutes} min</p>
            </div>
            <div>
              <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Gap</p>
              <p className="font-mono text-xl font-bold">{aiRec.recommendedGapThreshold} posts</p>
            </div>
          </div>
          <p className="text-sm opacity-70 leading-relaxed">{aiRec.reasoning}</p>
          <div className="flex flex-wrap gap-1.5">
            {aiRec.signalsUsed.map((s) => (
              <span key={s} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-wider opacity-60">{s}</span>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="space-y-0.5">
              {ageMinutes !== null && (
                <p className="text-[10px] opacity-40">Built {ageMinutes} minute{ageMinutes !== 1 ? 's' : ''} ago</p>
              )}
              {isStale && (
                <p className="text-[10px] text-amber-400/80">Stale — run observer to refresh</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {aiRecApplied && <span className="text-[10px] text-emerald-400/80 font-medium">Applied</span>}
              <button
                onClick={applyAiRecommendation}
                disabled={isStale || loading}
                className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 transition-all text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Apply Recommendation
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm opacity-50">AI advisor disabled — set XAI_API_KEY to enable</p>
      )}
    </motion.div>
  );
}

function ObserverPanel({ app }: { app: UseAppDataReturn }) {
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

function SchedulerPanel({ app }: { app: UseAppDataReturn }) {
  const s = app.controlPanel.autoPublisher;
  const setSch = (patch: Partial<typeof s>) => app.setControlPanel((c) => ({ ...c, autoPublisher: { ...c.autoPublisher, ...patch } }));
  return (
    <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10 lg:col-span-2">
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Auto-Publisher Scheduler</p>
      <label className="flex items-center justify-between text-sm"><span>Auto-publisher enabled</span><input type="checkbox" checked={s.enabled} onChange={(e) => setSch({ enabled: e.target.checked })} /></label>
      <NumField label="Base interval (minutes)" value={s.baseIntervalMinutes} onChange={(v) => setSch({ baseIntervalMinutes: Math.max(1, v) })} />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Quiet hours start" value={s.quietHoursStart} onChange={(v) => setSch({ quietHoursStart: Math.max(0, Math.min(23, v)) })} />
        <NumField label="Quiet hours end" value={s.quietHoursEnd} onChange={(v) => setSch({ quietHoursEnd: Math.max(0, Math.min(23, v)) })} />
      </div>
      <NumField label="Quiet-hours multiplier (higher = slower)" value={s.quietHoursMultiplier} step={0.1} min={0.2} max={5} onChange={(v) => setSch({ quietHoursMultiplier: Math.max(0.2, Math.min(5, v)) })} />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Active hours start" value={s.activeHoursStart} onChange={(v) => setSch({ activeHoursStart: Math.max(0, Math.min(23, v)) })} />
        <NumField label="Active hours end" value={s.activeHoursEnd} onChange={(v) => setSch({ activeHoursEnd: Math.max(0, Math.min(23, v)) })} />
      </div>
      <NumField label="Active-hours multiplier (lower = faster)" value={s.activeHoursMultiplier} step={0.1} min={0.2} max={5} onChange={(v) => setSch({ activeHoursMultiplier: Math.max(0.2, Math.min(5, v)) })} />
      <label className="flex items-center justify-between text-sm"><span>Trend adaptive scheduling</span><input type="checkbox" checked={s.trendAdaptiveEnabled} onChange={(e) => setSch({ trendAdaptiveEnabled: e.target.checked })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Trend window (days)" value={s.trendWindowDays} onChange={(v) => setSch({ trendWindowDays: Math.max(1, Math.min(60, v)) })} />
        <NumField label="Recalibration cycle (days)" value={s.trendRecalibrationDays} onChange={(v) => setSch({ trendRecalibrationDays: Math.max(1, Math.min(30, v)) })} />
      </div>
      <NumField label="Schedule jitter (±% around effective interval)" value={s.scheduleJitterPercent} onChange={(v) => setSch({ scheduleJitterPercent: Math.max(0, Math.min(50, v)) })} />
      <label className="block text-xs opacity-60">Jitter mode</label>
      <select value={s.scheduleJitterMode} onChange={(e) => setSch({ scheduleJitterMode: e.target.value === 'none' ? 'none' : 'uniform' })} className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"><option value="uniform">Uniform random slack</option><option value="none">None (fixed interval)</option></select>
      <p className="text-[10px] opacity-40">Actual delay between auto-publisher runs varies within ±% of the computed effective interval (quiet/active/trend multipliers still apply first).</p>
      <NumField label="Target publish interval (minutes, 0 = off)" value={s.targetPublishIntervalMinutes} max={1440} onChange={(v) => setSch({ targetPublishIntervalMinutes: Math.max(0, Math.min(1440, v)) })} />
      <p className="text-[10px] opacity-40">When set, blends 50/50 with the trend-adjusted effective interval so you can bias toward a desired cadence while still reacting to how fast new competitor posts appear (trend adaptive must stay on for the dynamic part).</p>
    </div>
  );
}

function PublisherSettingsPanel({ app }: { app: UseAppDataReturn }) {
  return (
    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Publisher — saved drafts</p>
      <p className="text-[10px] opacity-50 leading-relaxed">The drafts list alternates each saved post with an empty &quot;Preview&quot; row. Item 1 = first data row, item 2 = third <code className="text-orange-400/90">tr</code>, etc. The configured row must still match the required draft title guard server-side.</p>
      <NumField label="Draft item number (1-based)" value={app.controlPanel.publisher.draftItemIndex} max={50} onChange={(v) => app.setControlPanel((c) => ({ ...c, publisher: { ...c.publisher, draftItemIndex: Math.max(1, Math.min(50, v)) } }))} />
    </div>
  );
}

function OperationsPage({ app }: { app: UseAppDataReturn }) {
  const [sortConfig, setSortConfig] = useState<{ key: 'author' | 'frequency' | 'avgViews', direction: 'asc' | 'desc' }>({ key: 'frequency', direction: 'desc' });
  const handleSort = (key: 'author' | 'frequency' | 'avgViews') => setSortConfig((c) => ({ key, direction: c.key === key && c.direction === 'desc' ? 'asc' : 'desc' }));
  const sorted = [...app.competitorStats].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
    if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const chartData = app.logs.map(log => ({ time: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), views: log.view_count_of_last_post, gap: log.current_gap_count }));

  return (
    <>
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Competitor Intelligence (Last 7 Days)</h2>
        <Users className="w-4 h-4 opacity-30" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr className="border-b border-white/5">
            <Th label="Author" active={sortConfig.key === 'author'} dir={sortConfig.direction} onClick={() => handleSort('author')} />
            <Th label="Post Frequency" active={sortConfig.key === 'frequency'} dir={sortConfig.direction} onClick={() => handleSort('frequency')} center />
            <Th label="Avg. View Count" active={sortConfig.key === 'avgViews'} dir={sortConfig.direction} onClick={() => handleSort('avgViews')} center />
            <th className="pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40">Market Presence</th>
          </tr></thead>
          <tbody>
            {sorted.length > 0 ? sorted.map((comp, i) => {
              const isRef = comp.author.toLowerCase().includes('shareplan');
              return (
              <tr key={i} className={`border-b border-white/5 group transition-all ${isRef ? 'bg-orange-500/10' : 'hover:bg-white/5'}`}>
                <td className="py-4 text-sm font-medium">{comp.author}{isRef && <span className="ml-2 px-2 py-0.5 rounded bg-orange-600/20 text-orange-400 text-[10px] uppercase tracking-wider">Reference</span>}</td>
                <td className="py-4 text-sm font-mono text-center">{comp.frequency}</td>
                <td className="py-4 text-sm font-mono text-center">{comp.avgViews}</td>
                <td className="py-4"><div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden"><div className="bg-orange-600 h-full transition-all duration-1000" style={{ width: `${Math.min(100, (comp.frequency / (sorted[0]?.frequency || 1)) * 100)}%` }} /></div></td>
              </tr>
            )}) : <tr><td colSpan={4} className="py-8 text-center text-sm opacity-30 italic">No competitor data available yet. Run observer to collect data.</td></tr>}
          </tbody>
        </table>
      </div>
    </motion.div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6">
        <div className="flex items-center justify-between"><h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Post Velocity (Views)</h2><Eye className="w-4 h-4 opacity-30" /></div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} /><XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} /><YAxis stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} /><Line type="monotone" dataKey="views" stroke="#ea580c" strokeWidth={3} dot={{ fill: '#ea580c', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, strokeWidth: 0 }} /></LineChart></ResponsiveContainer>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6 overflow-hidden">
        <div className="flex items-center justify-between"><h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Activity History</h2><Users className="w-4 h-4 opacity-30" /></div>
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
          {app.logs.map((log, i) => (
            <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all">
              <div className="flex items-center gap-4"><div className={`w-2 h-2 rounded-full ${log.status === 'safe' ? 'bg-green-500' : log.status === 'unsafe' ? 'bg-red-500' : 'bg-yellow-500'}`} /><div><p className="text-xs font-mono opacity-40">{new Date(log.timestamp).toLocaleString()}</p><p className="text-sm font-medium">Gap: {log.current_gap_count} posts</p></div></div>
              <div className="flex items-center gap-6"><div className="text-right"><p className="text-xs opacity-40">Views</p><p className="text-sm font-mono">{log.view_count_of_last_post}</p></div><button onClick={() => app.setSelectedLog(log)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100"><Eye className="w-4 h-4" /></button></div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>

    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6">
      <div className="flex items-center justify-between"><h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Saved Drafts</h2><div className="px-2 py-1 rounded bg-orange-600/20 text-orange-500 text-[10px] font-bold uppercase tracking-wider">{app.drafts.length} Drafts Found</div></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {app.drafts.map((draft) => (
          <div key={draft.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between space-y-4 hover:border-orange-500/30 transition-all group">
            <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-[10px] font-mono opacity-40">{draft.timestamp}</span><span className="text-[10px] font-bold text-green-500 uppercase">Ready</span></div><p className="text-sm font-medium leading-relaxed group-hover:text-orange-500 transition-colors">{draft.title}</p></div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-[10px] opacity-40 uppercase tracking-widest">Verified Content</span></div>
          </div>
        ))}
      </div>
    </motion.div>
    </>
  );
}

/* ── Tiny inline helpers ──────────────────────────────────────────────────── */

function NumField({ label, value, onChange, min = 0, max = 999999, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <><label className="block text-xs opacity-60">{label}</label><input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || min)} className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm" /></>;
}

function Th({ label, active, dir, onClick, center }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; center?: boolean }) {
  return (
    <th className={`pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40 cursor-pointer hover:opacity-100 transition-opacity ${center ? 'text-center' : ''}`} onClick={onClick}>
      <div className={`flex items-center gap-1 ${center ? 'justify-center' : ''}`}>{label}{active && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
    </th>
  );
}

