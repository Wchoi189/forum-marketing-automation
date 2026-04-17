import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Activity, RefreshCw, Send } from 'lucide-react';
import PipelineCanvas, { PipelineStepId } from './PipelineCanvas';
import { useAppData } from './hooks/useAppData';
import LogDetailModal from './components/LogDetailModal';
import OverrideConfirmModal from './components/OverrideConfirmModal';
import OverviewPage from './pages/OverviewPage';
import OperationsPage from './pages/OperationsPage';
import ControlsPage from './pages/ControlsPage';
import PublisherRunsPage from './pages/PublisherRunsPage';

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
            { to: '/analytics', label: 'Competitor EDA' },
            { to: '/fiori', label: 'Fiori View ↗' }
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }: { isActive: boolean }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg text-sm border transition-all ${
                  isActive ? 'bg-orange-600/20 border-orange-500/40 text-orange-200' : 'border-white/10 hover:bg-white/5'
                }`
              }
            >
              {item.label}
              {item.to === '/controls' && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  app.controlPanel.autoPublisher.running
                    ? 'bg-orange-500 animate-pulse'
                    : app.controlPanel.autoPublisher.enabled
                    ? 'bg-emerald-500'
                    : 'bg-white/20'
                }`} />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-[10px] uppercase tracking-widest opacity-30 mb-1">Publisher</p>
          <p className={`text-xs font-semibold ${
            app.controlPanel.autoPublisher.running ? 'text-orange-400' :
            app.controlPanel.autoPublisher.enabled ? 'text-emerald-400' : 'text-white/30'
          }`}>
            {app.controlPanel.autoPublisher.running ? 'Running' :
             app.controlPanel.autoPublisher.enabled ? 'Active' : 'Paused'}
          </p>
        </div>
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
