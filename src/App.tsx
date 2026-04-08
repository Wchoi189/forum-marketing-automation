import React, { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  Send, 
  Activity, 
  Clock, 
  Users, 
  Eye,
  AlertCircle,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import type {
  ActivityLog,
  BoardStats,
  CompetitorStat,
  DraftItem,
  PublisherHistoryEntry,
  TrendInsights
} from '../contracts/models';

/** API errors may already include `[Observer]` / `[Publisher]`; strip one leading tag for readable banner text. */
function stripTaggedErrorPrefix(text: string) {
  return text.replace(/^\[(Observer|Publisher)\]\s*/, '').trim();
}

type ObserverControlState = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
  /** Effective minimum gap (posts) after persisted → env → spec precedence. */
  gapThresholdMin: number;
  /** File-persisted override; null = use env (if set) then spec baseline. */
  gapPersistedOverride: number | null;
  gapThresholdSpecBaseline: number;
  gapUsesEnvOverride: boolean;
};

type AutoPublisherControlState = {
  enabled: boolean;
  baseIntervalMinutes: number;
  effectiveIntervalMinutes: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  quietHoursMultiplier: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  activeHoursMultiplier: number;
  trendAdaptiveEnabled: boolean;
  trendWindowDays: number;
  trendRecalibrationDays: number;
  scheduleJitterPercent: number;
  scheduleJitterMode: 'none' | 'uniform';
  /** 0 = disabled; blended with trend-based interval when > 0. */
  targetPublishIntervalMinutes: number;
  running: boolean;
  nextTickEta?: string | null;
};

type PublisherControlState = {
  /** 1-based item in the saved-drafts table (preview rows between items are skipped automatically). */
  draftItemIndex: number;
};

type ControlPanelState = {
  preset: 'balanced' | 'night-safe' | 'day-aggressive';
  observer: ObserverControlState;
  publisher: PublisherControlState;
  autoPublisher: AutoPublisherControlState;
};

function gapPolicySourceLabel(o: ObserverControlState): string {
  if (o.gapPersistedOverride !== null) return 'persisted file';
  if (o.gapUsesEnvOverride) return 'env';
  return 'spec';
}

/** Keep pacing/scheduler numbers aligned with `server.ts` PRESET_CONFIG (observer + baseInterval math). */
function applyRuntimePreset(preset: ControlPanelState['preset'], current: ControlPanelState): ControlPanelState {
  const base = current.autoPublisher.baseIntervalMinutes;
  const pacing =
    preset === 'balanced'
      ? { enabled: true, minPreVisitDelayMs: 2000, maxPreVisitDelayMs: 7000, minIntervalBetweenRunsMs: 30000 }
      : preset === 'night-safe'
        ? { enabled: true, minPreVisitDelayMs: 5000, maxPreVisitDelayMs: 12000, minIntervalBetweenRunsMs: 60000 }
        : { enabled: true, minPreVisitDelayMs: 1000, maxPreVisitDelayMs: 4000, minIntervalBetweenRunsMs: 15000 };

  const autoPatch =
    preset === 'balanced'
      ? {
          baseIntervalMinutes: base,
          quietHoursStart: 3,
          quietHoursEnd: 5,
          quietHoursMultiplier: 1.8,
          activeHoursStart: 8,
          activeHoursEnd: 23,
          activeHoursMultiplier: 0.8,
          trendAdaptiveEnabled: true,
          trendWindowDays: 7,
          trendRecalibrationDays: 7
        }
      : preset === 'night-safe'
        ? {
            baseIntervalMinutes: Math.max(45, base),
            quietHoursStart: 2,
            quietHoursEnd: 6,
            quietHoursMultiplier: 2.2,
            activeHoursStart: 9,
            activeHoursEnd: 22,
            activeHoursMultiplier: 0.9,
            trendAdaptiveEnabled: true,
            trendWindowDays: 14,
            trendRecalibrationDays: 14
          }
        : {
            baseIntervalMinutes: Math.max(20, Math.round(base * 0.7)),
            quietHoursStart: 3,
            quietHoursEnd: 5,
            quietHoursMultiplier: 1.6,
            activeHoursStart: 9,
            activeHoursEnd: 23,
            activeHoursMultiplier: 0.6,
            trendAdaptiveEnabled: true,
            trendWindowDays: 7,
            trendRecalibrationDays: 7
          };

  return {
    ...current,
    preset,
    observer: {
      ...pacing,
      gapThresholdMin: current.observer.gapThresholdMin,
      gapPersistedOverride: current.observer.gapPersistedOverride,
      gapThresholdSpecBaseline: current.observer.gapThresholdSpecBaseline,
      gapUsesEnvOverride: current.observer.gapUsesEnvOverride
    },
    autoPublisher: { ...current.autoPublisher, ...autoPatch }
  };
}

const DEFAULT_CONTROL_PANEL: ControlPanelState = {
  preset: 'balanced',
  observer: {
    enabled: true,
    minPreVisitDelayMs: 0,
    maxPreVisitDelayMs: 0,
    minIntervalBetweenRunsMs: 0,
    gapThresholdMin: 5,
    gapPersistedOverride: null,
    gapThresholdSpecBaseline: 5,
    gapUsesEnvOverride: false
  },
  publisher: {
    draftItemIndex: 1
  },
  autoPublisher: {
    enabled: true,
    baseIntervalMinutes: 60,
    effectiveIntervalMinutes: 60,
    quietHoursStart: 3,
    quietHoursEnd: 5,
    quietHoursMultiplier: 1.8,
    activeHoursStart: 8,
    activeHoursEnd: 23,
    activeHoursMultiplier: 0.8,
    trendAdaptiveEnabled: true,
    trendWindowDays: 7,
    trendRecalibrationDays: 7,
    scheduleJitterPercent: 15,
    scheduleJitterMode: 'uniform',
    targetPublishIntervalMinutes: 0,
    running: false
  }
};

import PipelineCanvas, { PipelineStepId } from './PipelineCanvas';

function isSharePlanAuthor(author: string) {
  return author.toLowerCase().includes('shareplan');
}

export default function App() {
  const location = useLocation();
  const onOverview = location.pathname === '/' || location.pathname === '/overview';
  const onOperations = location.pathname === '/operations';
  const onControls = location.pathname === '/controls';
  const onPublisherRuns = location.pathname === '/publisher-runs';
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [competitorStats, setCompetitorStats] = useState<CompetitorStat[]>([]);
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null);
  const [trendInsights, setTrendInsights] = useState<TrendInsights | null>(null);
  const [playbookData, setPlaybookData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string, log?: ActivityLog } | null>(null);

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [publisherHistory, setPublisherHistory] = useState<PublisherHistoryEntry[]>([]);
  const [controlPanel, setControlPanel] = useState<ControlPanelState>(DEFAULT_CONTROL_PANEL);
  const [controlSaving, setControlSaving] = useState(false);
  const [controlDirty, setControlDirty] = useState(false);
  const [controlPanelSection, setControlPanelSection] = useState<'observer' | 'scheduler' | 'publisher'>('observer');

  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);

  // Real publisher step — updated by polling /api/publisher-status during a run
  const [realPublisherStep, setRealPublisherStep] = useState<PipelineStepId | null>(null);
  const publisherPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Demo simulation (only shown when no real publish is active)
  const [simulationIndex, setSimulationIndex] = useState<number>(-1); // -1 = standby
  const [isSimulating, setIsSimulating] = useState(false);

  const STAGES: PipelineStepId[] = ['navigate', 'login-page', 'login', 'write-post', 'restore-draft', 'publish'];

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (isSimulating && simulationIndex < STAGES.length) {
      timeout = setTimeout(() => {
        setSimulationIndex(prev => prev + 1);
      }, 1500);
    } else if (isSimulating && simulationIndex === STAGES.length) {
      setIsSimulating(false);
    }
    return () => clearTimeout(timeout);
  }, [isSimulating, simulationIndex]);

  const handleStartSimulation = () => {
    setSimulationIndex(0);
    setIsSimulating(true);
  };

  const handleResetSimulation = () => {
    setSimulationIndex(-1);
    setIsSimulating(false);
  };

  const startPublisherPolling = () => {
    if (publisherPollRef.current) return;
    publisherPollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/publisher-status');
        const data: { step: PipelineStepId | null; running: boolean } = await res.json();
        if (data.step) {
          setRealPublisherStep(data.step);
        }
        if (!data.running && !data.step) {
          stopPublisherPolling();
        }
      } catch {
        // ignore poll errors
      }
    }, 1500);
  };

  const stopPublisherPolling = () => {
    if (publisherPollRef.current) {
      clearInterval(publisherPollRef.current);
      publisherPollRef.current = null;
    }
  };

  // When the scheduler auto-publishes, detect running=true and start step polling
  useEffect(() => {
    if (controlPanel.autoPublisher.running) {
      startPublisherPolling();
    } else {
      stopPublisherPolling();
      setRealPublisherStep(null);
    }
  }, [controlPanel.autoPublisher.running]);

  const isPublishing = loading || controlPanel.autoPublisher.running;

  // Canvas step: real data takes priority; fall back to demo simulation
  const currentStep: PipelineStepId = isPublishing
    ? (realPublisherStep ?? 'navigate')
    : simulationIndex === -1 ? 'standby'
    : simulationIndex >= STAGES.length ? 'complete'
    : STAGES[simulationIndex];

  type SortKey = 'author' | 'frequency' | 'avgViews';
  const [sortConfig, setSortConfig] = useState<{ key: SortKey, direction: 'asc' | 'desc' }>({ key: 'frequency', direction: 'desc' });

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedCompetitors = [...competitorStats].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) {
      return sortConfig.direction === 'asc' ? -1 : 1;
    }
    if (a[sortConfig.key] > b[sortConfig.key]) {
      return sortConfig.direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  const fetchStats = async () => {
    try {
      const [compRes, boardRes, trendRes] = await Promise.all([
        fetch('/api/competitor-stats'),
        fetch('/api/board-stats'),
        fetch('/api/trend-insights')
      ]);
      const [compData, boardData, trendData] = await Promise.all([
        compRes.json(),
        boardRes.json(),
        trendRes.json()
      ]);
      setCompetitorStats(compData);
      setBoardStats(boardData);
      if (trendRes.ok && trendData && typeof trendData.trendMultiplier === 'number') {
        setTrendInsights(trendData as TrendInsights);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/logs');
      const data = await response.json();
      setLogs(data);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  };

  const fetchDrafts = async () => {
    try {
      const response = await fetch('/api/drafts');
      const data = await response.json();
      setDrafts(data);
    } catch (error) {
      console.error('Failed to fetch drafts:', error);
    }
  };

  const fetchPublisherHistory = async () => {
    try {
      const response = await fetch('/api/publisher-history?limit=30');
      const data = await response.json();
      if (Array.isArray(data)) {
        setPublisherHistory(data as PublisherHistoryEntry[]);
      }
    } catch (error) {
      console.error('Failed to fetch publisher history:', error);
    }
  };

  const fetchControlPanel = async () => {
    try {
      const response = await fetch('/api/control-panel');
      const data = await response.json();
      const nextState: ControlPanelState = {
        ...DEFAULT_CONTROL_PANEL,
        ...data,
        observer: { ...DEFAULT_CONTROL_PANEL.observer, ...data.observer },
        publisher: { ...DEFAULT_CONTROL_PANEL.publisher, ...data.publisher },
        autoPublisher: { ...DEFAULT_CONTROL_PANEL.autoPublisher, ...data.autoPublisher }
      };
      setControlPanel((current) => {
        if (!controlDirty) return nextState;
        // While user edits form values, only merge non-form status fields from polling.
        return {
          ...current,
          observer: {
            ...current.observer,
            gapThresholdMin: nextState.observer.gapThresholdMin,
            gapThresholdSpecBaseline: nextState.observer.gapThresholdSpecBaseline,
            gapUsesEnvOverride: nextState.observer.gapUsesEnvOverride
          },
          autoPublisher: {
            ...current.autoPublisher,
            running: nextState.autoPublisher.running,
            effectiveIntervalMinutes: nextState.autoPublisher.effectiveIntervalMinutes
          }
        };
      });
    } catch (error) {
      console.error('Failed to fetch control panel:', error);
    }
  };

  const fetchPlaybook = async () => {
    try {
      const response = await fetch('/api/playbook/ppomppu-gonggu-v1');
      const data = await response.json();
      setPlaybookData(data);
    } catch (error) {
      console.error('Failed to fetch playbook:', error);
    }
  };

  /** Fire-and-forget observer run that silently updates logs when done. Used on mount and after publishing. */
  const silentRefreshObserver = () => {
    fetch('/api/run-observer', { method: 'POST' })
      .then(r => r.json())
      .then(() => { fetchLogs(); fetchStats(); })
      .catch(() => {});
  };

  useEffect(() => {
    fetchLogs();
    fetchDrafts();
    fetchStats();
    fetchControlPanel();
    fetchPublisherHistory();
    fetchPlaybook();
    // Kick off a fresh observer read so the dashboard shows current board state on load
    silentRefreshObserver();
    const interval = setInterval(() => {
      fetchLogs();
      fetchDrafts();
      fetchStats();
      fetchControlPanel();
      fetchPublisherHistory();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const saveControlPanel = async () => {
    setControlSaving(true);
    try {
      const response = await fetch('/api/control-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(controlPanel)
      });
      const data = await response.json();
      setControlPanel({
        ...DEFAULT_CONTROL_PANEL,
        ...data,
        observer: { ...DEFAULT_CONTROL_PANEL.observer, ...data.observer },
        publisher: { ...DEFAULT_CONTROL_PANEL.publisher, ...data.publisher },
        autoPublisher: { ...DEFAULT_CONTROL_PANEL.autoPublisher, ...data.autoPublisher }
      });
      setControlDirty(false);
      setActionMessage({ type: 'success', text: 'Control panel settings saved.' });
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Control panel save failed (network/API error).' });
    } finally {
      setControlSaving(false);
    }
  };

  const runObserver = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/run-observer', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: 'Observer run completed successfully.', log: data.log });
        fetchLogs();
      } else {
        const detail = stripTaggedErrorPrefix(data.error || 'Observer failed.');
        setActionMessage({ type: 'error', text: `Observer — ${detail}`, log: data.log });
      }
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Observer — network error (could not reach API).' });
    } finally {
      setLoading(false);
    }
  };

  const runPublisher = async (force: boolean = false) => {
    setLoading(true);
    setRealPublisherStep(null);
    startPublisherPolling();
    try {
      const response = await fetch('/api/run-publisher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await response.json();
      const label = force ? 'Publisher (manual override)' : 'Publisher (auto)';
      const runHint =
        typeof data.runId === 'string' && data.runId.length > 0 ? ` runId=${data.runId}` : '';
      if (data.success) {
        setActionMessage({ type: 'success', text: `${label} — ${data.message}${runHint}`, log: data.log });
      } else {
        const detail = stripTaggedErrorPrefix(data.error || data.message || 'Publisher failed.');
        setActionMessage({ type: 'error', text: `${label} — ${detail}${runHint}`, log: data.log });
      }
      fetchLogs();
      fetchPublisherHistory();
      // Refresh observer after publish so the dashboard reflects the updated board state
      silentRefreshObserver();
    } catch (error) {
      const label = force ? 'Publisher (manual override)' : 'Publisher (auto)';
      setActionMessage({ type: 'error', text: `${label} — network error (could not reach API).` });
    } finally {
      stopPublisherPolling();
      setRealPublisherStep(null);
      setLoading(false);
    }
  };

  const latestLog = logs[0];
  const isSafe = latestLog?.status === 'safe';
  const isKnownUnsafe = latestLog?.status === 'unsafe';
  const safetyUiState = latestLog ? (isSafe ? 'safe' : (isKnownUnsafe ? 'unsafe' : 'unknown')) : 'unknown';
  const minGapRequired = latestLog?.gap_threshold_min ?? controlPanel.observer.gapThresholdMin;

  const chartData = [...logs].reverse().map(log => ({
    time: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    views: log.view_count_of_last_post,
    gap: log.current_gap_count
  }));

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
              className={({ isActive }) =>
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
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight uppercase italic">Ppomppu OTT Bot</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/analytics"
              className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium"
            >
              Competitor EDA
            </Link>
            <button 
              onClick={runObserver}
              disabled={loading}
              className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center gap-2 text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh Observer
            </button>
            <button 
              onClick={() => runPublisher(true)}
              disabled={loading}
              className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 transition-all flex items-center gap-2 text-sm font-bold shadow-lg shadow-orange-600/20 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Manual Override
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {onOverview && (
        <>
        {/* ── Level 0: Global Status Strip ─────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-3 flex-wrap">
            {controlPanel?.autoPublisher.running ? (
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${controlPanel?.autoPublisher.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
            )}
            <span className="font-semibold text-white/80">
              Auto-Publish:{' '}
              {controlPanel?.autoPublisher.running
                ? <span className="text-orange-400">Publishing…</span>
                : controlPanel?.autoPublisher.enabled
                  ? <span className="text-green-400">Active</span>
                  : <span className="text-gray-400">Paused</span>}
            </span>
            {controlPanel?.autoPublisher.enabled && !controlPanel?.autoPublisher.running && (
              <>
                <span className="text-white/40">|</span>
                <span className="text-white/40 text-xs">publishes automatically when gap is safe</span>
              </>
            )}
            {controlPanel?.autoPublisher.enabled && controlPanel?.autoPublisher.nextTickEta && !controlPanel?.autoPublisher.running && (
              <>
                <span className="text-white/40">|</span>
                <span className="text-white/60">
                  Next attempt: {new Date(controlPanel.autoPublisher.nextTickEta).toLocaleTimeString()}
                </span>
              </>
            )}
            {/* Safety badge integrated into status strip */}
            <span className="text-white/40">|</span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
              safetyUiState === 'safe'
                ? 'border-green-500/40 bg-green-500/10 text-green-400'
                : safetyUiState === 'unsafe'
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-gray-500/40 bg-gray-500/10 text-gray-400'
            }`}>
              {safetyUiState === 'safe'
                ? <ShieldCheck className="w-3 h-3" />
                : <ShieldAlert className="w-3 h-3" />}
              {safetyUiState === 'safe' ? 'Safe Zone' : safetyUiState === 'unsafe' ? 'Danger Zone' : 'Unknown'}
              <span className="opacity-60 font-normal">· gap {latestLog?.current_gap_count ?? 0}/{minGapRequired}</span>
            </span>
          </div>
          <Link to="/controls" className="text-orange-500 hover:text-orange-400 font-medium shrink-0">
            Configure Timer
          </Link>
        </div>

        {/* ── Level 1: Command Center — Pipeline Canvas ─────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-3xl border border-blue-500/20 bg-blue-500/5 space-y-4"
        >
          {/* Header row with title, sim stats, and action button */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Workflow Automation</h2>
              <p className="text-[10px] text-orange-400 mt-0.5 font-bold tracking-wider">Workflow Reset</p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex gap-4 text-[10px] uppercase tracking-widest font-bold">
                <div className="flex flex-col items-end">
                  <span className="opacity-50">Status</span>
                  <span className={isSimulating ? 'text-orange-400' : 'text-white/70'}>{isSimulating ? 'Simulating' : 'Idle'}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="opacity-50">Step</span>
                  <span className="text-white/70 capitalize">{currentStep.replace('-', ' ')}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="opacity-50">Done</span>
                  <span className="text-white/70">{Math.max(0, simulationIndex)}/{STAGES.length}</span>
                </div>
              </div>
              {/* Run publish button lives here — action triggers the pipeline */}
              <button
                onClick={() => safetyUiState === 'unsafe' ? setShowOverrideModal(true) : runPublisher(false)}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-white/15 hover:border-orange-500/50 text-white font-semibold text-xs uppercase tracking-widest transition-all disabled:opacity-30 flex items-center gap-2 shadow-sm"
              >
                <Send className="w-3.5 h-3.5 text-orange-400" />
                Run Publish Now
              </button>
            </div>
          </div>

          <div className="relative">
            <PipelineCanvas currentStep={currentStep} />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleStartSimulation}
              disabled={isSimulating}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-xs transition-all disabled:opacity-40"
            >
              Start Simulation
            </button>
            <button
              onClick={handleResetSimulation}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-xs transition-all"
            >
              Reset
            </button>
          </div>
        </motion.div>

        {/* ── Level 2: KPI Strip — 4 short widgets ─────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Last Post */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="p-4 rounded-2xl border border-white/10 bg-white/5 flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium opacity-50 uppercase tracking-widest">Last Post</p>
              <Clock className="w-3.5 h-3.5 opacity-25" />
            </div>
            <div>
              <p className="text-sm font-mono leading-snug break-all opacity-90">{latestLog?.last_post_timestamp || '—'}</p>
              <p className="text-xs opacity-50 mt-1">{latestLog?.view_count_of_last_post ?? 0} views</p>
            </div>
          </motion.div>

          {/* KPI 2: Top Competitors */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-4 rounded-2xl border border-white/10 bg-white/5 flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium opacity-50 uppercase tracking-widest">Top Competitors</p>
              <Users className="w-3.5 h-3.5 opacity-25" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {latestLog?.top_competitor_names.slice(0, 3).map((name, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-medium border border-white/10">
                  {name}
                </span>
              )) || <span className="text-xs opacity-30">—</span>}
            </div>
          </motion.div>

          {/* KPI 3: Turnover Rate */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="p-4 rounded-2xl border border-white/10 bg-white/5 flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium opacity-50 uppercase tracking-widest">Turnover Rate</p>
              <Activity className="w-3.5 h-3.5 opacity-25" />
            </div>
            <div>
              <p className="text-2xl font-mono font-bold">{boardStats?.turnoverRate ?? 0}</p>
              <p className="text-[10px] opacity-40 uppercase tracking-widest mt-0.5">posts / hr</p>
            </div>
          </motion.div>

          {/* KPI 4: Share of Voice */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="p-4 rounded-2xl border border-white/10 bg-white/5 flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium opacity-50 uppercase tracking-widest">Share of Voice</p>
              <Eye className="w-3.5 h-3.5 opacity-25" />
            </div>
            <div>
              <p className="text-2xl font-mono font-bold">{boardStats?.shareOfVoice ?? 0}%</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${boardStats?.shareOfVoice && boardStats.shareOfVoice > 10 ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-[10px] opacity-40 uppercase tracking-widest">
                  {boardStats?.shareOfVoice && boardStats.shareOfVoice > 10 ? 'High Presence' : 'Low Presence'}
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Level 3: Data & Logs — 3-col grid (chart × 2, logs × 1) ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left (span-2): Trend Insights chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-2 p-6 rounded-3xl border border-orange-500/20 bg-orange-500/5 space-y-4"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Trend Insights</h2>
                <p className="text-[10px] opacity-40 mt-0.5 max-w-md">
                  Hourly turnover profile · multiplier &amp; interval hints follow scheduler-adaptation policy.
                  {trendInsights?.precedenceNote ? ` ${trendInsights.precedenceNote}` : ''}
                </p>
              </div>
              {trendInsights && (
                <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-widest opacity-60 shrink-0">
                  <span>Window {trendInsights.windowDays}d</span>
                  <span>Mult ×{trendInsights.trendMultiplier}</span>
                  <span>Conf {Math.round(trendInsights.confidence * 100)}%</span>
                  <span className="text-orange-300/90">{trendInsights.multiplierBand.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>

            {trendInsights ? (
              <div className="space-y-4">
                {/* Mini stats row above chart */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Avg posts/hr</p>
                    <p className="text-xl font-mono font-bold">{trendInsights.avgNewPostsPerHour}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Volatility</p>
                    <p className="text-xl font-mono font-bold">{trendInsights.volatility}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Advisory intervals</p>
                    <p className="text-sm font-mono">Q~{trendInsights.recommendedIntervalMinutesQuiet}m · A~{trendInsights.recommendedIntervalMinutesActive}m</p>
                  </div>
                </div>
                {/* Main bar chart */}
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendInsights.hourlyProfile.map((h) => ({ label: `${h.hour}h`, rate: h.avgNewPostsPerHour }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fill: '#ffffff55', fontSize: 9 }} interval={3} />
                      <YAxis tick={{ fill: '#ffffff55', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: 8 }}
                        labelStyle={{ color: '#fff' }}
                      />
                      <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                        {trendInsights.hourlyProfile.map((_, i) => (
                          <Cell key={i} fill={i % 2 === 0 ? '#ea580caa' : '#f97316cc'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] opacity-35 font-mono">{trendInsights.confidenceReason.replace(/_/g, ' ')}</p>
              </div>
            ) : (
              <p className="text-sm opacity-40 italic">Loading trend insights…</p>
            )}
          </motion.div>

          {/* Right (span-1): System Logs & Publisher Runs combined */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-6 rounded-3xl border border-white/10 bg-white/5 flex flex-col gap-4"
          >
            {/* System Messages */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-medium opacity-50 uppercase tracking-widest">System Messages</h2>
                <AlertCircle className="w-3.5 h-3.5 opacity-25" />
              </div>
              <AnimatePresence mode="wait">
                {actionMessage ? (
                  <motion.div
                    key={actionMessage.text}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`text-left break-words p-3 rounded-xl border text-xs ${actionMessage.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                  >
                    <p className="font-medium mb-1.5">{actionMessage.text}</p>
                    {actionMessage.type === 'error' && actionMessage.log && (
                      <button
                        onClick={() => setSelectedLog(actionMessage.log!)}
                        className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-[10px] font-bold uppercase tracking-wider transition-all"
                      >
                        View Details
                      </button>
                    )}
                  </motion.div>
                ) : (
                  <p className="text-xs opacity-30 italic px-1">System idle…</p>
                )}
              </AnimatePresence>
            </div>

            {/* Divider */}
            <div className="border-t border-white/5" />

            {/* Publisher Runs log */}
            <div className="flex-1 min-h-0 flex flex-col">
              <p className="text-[10px] font-medium opacity-50 uppercase tracking-widest mb-2">Publisher Runs</p>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1" style={{ maxHeight: '340px' }}>
                {publisherHistory.length === 0 ? (
                  <p className="text-[10px] opacity-35">No runs recorded yet.</p>
                ) : (
                  publisherHistory.map((row, i) => (
                    <div
                      key={`${row.at}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] border-b border-white/5 pb-1.5"
                    >
                      <span className="font-mono text-orange-300/90 shrink-0">
                        {new Date(row.at).toLocaleString(undefined, {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </span>
                      <span className={row.success ? 'text-emerald-400/90 font-bold uppercase' : 'text-red-400/90 font-bold uppercase'}>
                        {row.success ? 'ok' : 'fail'}
                      </span>
                      {row.decision && (
                        <span className="text-[9px] uppercase opacity-50 border border-white/15 px-1 rounded shrink-0">
                          {row.decision.replace(/_/g, ' ')}
                        </span>
                      )}
                      {row.runId && (
                        <span className="font-mono text-[9px] opacity-40 shrink-0" title={row.runId}>
                          {row.runId.slice(0, 8)}…
                        </span>
                      )}
                      {row.force && (
                        <span className="text-[9px] uppercase opacity-50 border border-white/15 px-1 rounded">manual</span>
                      )}
                      {row.artifactDir && (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(row.artifactDir ?? '');
                            setActionMessage({ type: 'success', text: `Copied artifact path: ${row.artifactDir}` });
                          }}
                          className="text-[9px] uppercase opacity-70 border border-white/20 px-1 rounded hover:opacity-100"
                          title={row.artifactDir}
                        >
                          copy artifactDir
                        </button>
                      )}
                      <span className="opacity-60 break-all">{stripTaggedErrorPrefix(row.message)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </div>

        </>
        )}

        {onPublisherRuns && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Publisher Runs</h2>
              <button
                type="button"
                onClick={fetchPublisherHistory}
                className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-widest hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2">
              {publisherHistory.length === 0 ? (
                <p className="text-sm opacity-50">No publisher runs recorded yet.</p>
              ) : (
                publisherHistory.map((row, i) => (
                  <div key={`${row.at}-${i}`} className="p-3 rounded-xl border border-white/10 bg-black/20 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono opacity-70">{new Date(row.at).toLocaleString()}</span>
                      <span className={row.success ? 'text-emerald-400 font-bold uppercase' : 'text-red-400 font-bold uppercase'}>
                        {row.success ? 'ok' : 'fail'}
                      </span>
                      {row.decision && <span className="opacity-60 uppercase">{row.decision.replace(/_/g, ' ')}</span>}
                      {row.artifactDir && <span className="font-mono opacity-50">{row.artifactDir}</span>}
                    </div>
                    <div className="opacity-75 mt-1">{stripTaggedErrorPrefix(row.message)}</div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {onControls && (
        <>
        {/* Runtime Control Panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
          onChangeCapture={() => setControlDirty(true)}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Runtime Control Panel</h2>
            <div className="text-right">
              <span className="block text-[10px] opacity-40 uppercase tracking-widest">
                Scheduler: {controlPanel.autoPublisher.enabled ? 'Enabled' : 'Paused'} / {controlPanel.autoPublisher.running ? 'Running' : 'Idle'} / Effective {controlPanel.autoPublisher.effectiveIntervalMinutes}m
              </span>
              {controlDirty && <span className="block text-[10px] text-amber-300/80">Unsaved local edits</span>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs opacity-60 uppercase tracking-widest">Preset</label>
            <select
              value={controlPanel.preset}
              onChange={(e) =>
                setControlPanel((current) =>
                  applyRuntimePreset(e.target.value as ControlPanelState['preset'], current)
                )
              }
              className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
            >
              <option value="balanced">Balanced</option>
              <option value="night-safe">Night Safe</option>
              <option value="day-aggressive">Day Aggressive</option>
            </select>
            <span className="text-[10px] opacity-40">Preset updates both observer pacing and scheduler cadence.</span>
          </div>

          <div className="flex items-center gap-2">
            {(['observer', 'scheduler', 'publisher'] as const).map((section) => (
              <button
                key={section}
                type="button"
                onClick={() => setControlPanelSection(section)}
                className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest border transition-all ${
                  controlPanelSection === section ? 'bg-orange-600 border-orange-500 text-white' : 'bg-white/5 border-white/10 opacity-70 hover:opacity-100'
                }`}
              >
                {section}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {controlPanelSection === 'observer' && (
            <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Observer Pacing</p>
              <label className="flex items-center justify-between text-sm">
                <span>Observer enabled</span>
                <input
                  type="checkbox"
                  checked={controlPanel.observer.enabled}
                  onChange={(e) =>
                    setControlPanel((current) => ({
                      ...current,
                      observer: { ...current.observer, enabled: e.target.checked }
                    }))
                  }
                />
              </label>
              <label className="block text-xs opacity-60">Min delay before board visit (ms)</label>
              <input
                type="number"
                min={0}
                value={controlPanel.observer.minPreVisitDelayMs}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    observer: {
                      ...current.observer,
                      minPreVisitDelayMs: Math.max(0, Number(e.target.value) || 0)
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <label className="block text-xs opacity-60">Max delay before board visit (ms)</label>
              <input
                type="number"
                min={0}
                value={controlPanel.observer.maxPreVisitDelayMs}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    observer: {
                      ...current.observer,
                      maxPreVisitDelayMs: Math.max(0, Number(e.target.value) || 0)
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <label className="block text-xs opacity-60">Minimum time between observer runs (ms)</label>
              <input
                type="number"
                min={0}
                value={controlPanel.observer.minIntervalBetweenRunsMs}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    observer: {
                      ...current.observer,
                      minIntervalBetweenRunsMs: Math.max(0, Number(e.target.value) || 0)
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <div className="pt-2 border-t border-white/10 space-y-2">
                <p className="text-[10px] opacity-50 uppercase tracking-wider">Gap policy (publish safety)</p>
                <p className="text-[11px] opacity-45">
                  Effective min gap: <span className="text-white font-mono">{controlPanel.observer.gapThresholdMin}</span>{' '}
                  posts · Spec baseline:{' '}
                  <span className="text-white font-mono">{controlPanel.observer.gapThresholdSpecBaseline}</span> · Source:{' '}
                  <span className="text-orange-300/90">{gapPolicySourceLabel(controlPanel.observer)}</span>
                </p>
                <label className="block text-xs opacity-60">
                  File override (empty = env/spec chain; Apply to persist)
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  placeholder={`e.g. ${controlPanel.observer.gapThresholdMin}`}
                  value={controlPanel.observer.gapPersistedOverride ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setControlPanel((current) => ({
                      ...current,
                      observer: {
                        ...current.observer,
                        gapPersistedOverride:
                          raw === ''
                            ? null
                            : Math.max(1, Math.min(50, Math.round(Number(raw)) || 1))
                      }
                    }));
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                />
              </div>
            </div>
            )}

            {controlPanelSection === 'scheduler' && (
            <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Auto-Publisher Scheduler</p>
              <label className="flex items-center justify-between text-sm">
                <span>Auto-publisher enabled</span>
                <input
                  type="checkbox"
                  checked={controlPanel.autoPublisher.enabled}
                  onChange={(e) =>
                    setControlPanel((current) => ({
                      ...current,
                      autoPublisher: { ...current.autoPublisher, enabled: e.target.checked }
                    }))
                  }
                />
              </label>
              <label className="block text-xs opacity-60">Base interval (minutes)</label>
              <input
                type="number"
                min={1}
                value={controlPanel.autoPublisher.baseIntervalMinutes}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    autoPublisher: {
                      ...current.autoPublisher,
                      baseIntervalMinutes: Math.max(1, Number(e.target.value) || 1)
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs opacity-60">Quiet hours start</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={controlPanel.autoPublisher.quietHoursStart}
                    onChange={(e) =>
                      setControlPanel((current) => ({
                        ...current,
                        autoPublisher: {
                          ...current.autoPublisher,
                          quietHoursStart: Math.max(0, Math.min(23, Number(e.target.value) || 0))
                        }
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs opacity-60">Quiet hours end</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={controlPanel.autoPublisher.quietHoursEnd}
                    onChange={(e) =>
                      setControlPanel((current) => ({
                        ...current,
                        autoPublisher: {
                          ...current.autoPublisher,
                          quietHoursEnd: Math.max(0, Math.min(23, Number(e.target.value) || 0))
                        }
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                  />
                </div>
              </div>
              <label className="block text-xs opacity-60">Quiet-hours multiplier (higher = slower)</label>
              <input
                type="number"
                min={0.2}
                max={5}
                step={0.1}
                value={controlPanel.autoPublisher.quietHoursMultiplier}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    autoPublisher: {
                      ...current.autoPublisher,
                      quietHoursMultiplier: Math.max(0.2, Math.min(5, Number(e.target.value) || 1))
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs opacity-60">Active hours start</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={controlPanel.autoPublisher.activeHoursStart}
                    onChange={(e) =>
                      setControlPanel((current) => ({
                        ...current,
                        autoPublisher: {
                          ...current.autoPublisher,
                          activeHoursStart: Math.max(0, Math.min(23, Number(e.target.value) || 0))
                        }
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs opacity-60">Active hours end</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={controlPanel.autoPublisher.activeHoursEnd}
                    onChange={(e) =>
                      setControlPanel((current) => ({
                        ...current,
                        autoPublisher: {
                          ...current.autoPublisher,
                          activeHoursEnd: Math.max(0, Math.min(23, Number(e.target.value) || 0))
                        }
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                  />
                </div>
              </div>
              <label className="block text-xs opacity-60">Active-hours multiplier (lower = faster)</label>
              <input
                type="number"
                min={0.2}
                max={5}
                step={0.1}
                value={controlPanel.autoPublisher.activeHoursMultiplier}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    autoPublisher: {
                      ...current.autoPublisher,
                      activeHoursMultiplier: Math.max(0.2, Math.min(5, Number(e.target.value) || 1))
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <label className="flex items-center justify-between text-sm">
                <span>Trend adaptive scheduling</span>
                <input
                  type="checkbox"
                  checked={controlPanel.autoPublisher.trendAdaptiveEnabled}
                  onChange={(e) =>
                    setControlPanel((current) => ({
                      ...current,
                      autoPublisher: { ...current.autoPublisher, trendAdaptiveEnabled: e.target.checked }
                    }))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs opacity-60">Trend window (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={controlPanel.autoPublisher.trendWindowDays}
                    onChange={(e) =>
                      setControlPanel((current) => ({
                        ...current,
                        autoPublisher: {
                          ...current.autoPublisher,
                          trendWindowDays: Math.max(1, Math.min(60, Number(e.target.value) || 7))
                        }
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs opacity-60">Recalibration cycle (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={controlPanel.autoPublisher.trendRecalibrationDays}
                    onChange={(e) =>
                      setControlPanel((current) => ({
                        ...current,
                        autoPublisher: {
                          ...current.autoPublisher,
                          trendRecalibrationDays: Math.max(1, Math.min(30, Number(e.target.value) || 7))
                        }
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                  />
                </div>
              </div>
              <label className="block text-xs opacity-60">Schedule jitter (±% around effective interval)</label>
              <input
                type="number"
                min={0}
                max={50}
                value={controlPanel.autoPublisher.scheduleJitterPercent}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    autoPublisher: {
                      ...current.autoPublisher,
                      scheduleJitterPercent: Math.max(0, Math.min(50, Number(e.target.value) || 0))
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <label className="block text-xs opacity-60">Jitter mode</label>
              <select
                value={controlPanel.autoPublisher.scheduleJitterMode}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    autoPublisher: {
                      ...current.autoPublisher,
                      scheduleJitterMode: e.target.value === 'none' ? 'none' : 'uniform'
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              >
                <option value="uniform">Uniform random slack</option>
                <option value="none">None (fixed interval)</option>
              </select>
              <p className="text-[10px] opacity-40">
                Actual delay between auto-publisher runs varies within ±% of the computed effective interval (quiet/active/trend
                multipliers still apply first).
              </p>
              <label className="block text-xs opacity-60">Target publish interval (minutes, 0 = off)</label>
              <input
                type="number"
                min={0}
                max={1440}
                value={controlPanel.autoPublisher.targetPublishIntervalMinutes}
                onChange={(e) =>
                  setControlPanel((current) => ({
                    ...current,
                    autoPublisher: {
                      ...current.autoPublisher,
                      targetPublishIntervalMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0))
                    }
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
              />
              <p className="text-[10px] opacity-40">
                When set, blends 50/50 with the trend-adjusted effective interval so you can bias toward a desired cadence while
                still reacting to how fast new competitor posts appear (trend adaptive must stay on for the dynamic part).
              </p>
            </div>
            )}
          </div>

          {controlPanelSection === 'publisher' && (
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Publisher — saved drafts</p>
            <p className="text-[10px] opacity-50 leading-relaxed">
              The drafts list alternates each saved post with an empty &quot;Preview&quot; row. Item 1 = first data row, item 2 =
              third <code className="text-orange-400/90">tr</code>, etc. The configured row must still match the required draft
              title guard server-side.
            </p>
            <label className="block text-xs opacity-60">Draft item number (1-based)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={controlPanel.publisher.draftItemIndex}
              onChange={(e) =>
                setControlPanel((current) => ({
                  ...current,
                  publisher: {
                    ...current.publisher,
                    draftItemIndex: Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  }
                }))
              }
              className="w-full max-w-xs px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
            />
          </div>
          )}

          <div className="flex items-center justify-end">
            <button
              onClick={saveControlPanel}
              disabled={controlSaving}
              className="px-4 py-2 rounded-full bg-orange-600 hover:bg-orange-500 transition-all text-sm font-bold disabled:opacity-50"
            >
              {controlSaving ? 'Saving...' : 'Apply Controls'}
            </button>
          </div>
        </motion.div>
        </>
        )}

        {onOperations && (
        <>
        {/* Competitor Intelligence */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Competitor Intelligence (Last 7 Days)</h2>
            <Users className="w-4 h-4 opacity-30" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5">
                  <th 
                    className="pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40 cursor-pointer hover:opacity-100 transition-opacity"
                    onClick={() => handleSort('author')}
                  >
                    <div className="flex items-center gap-1">
                      Author
                      {sortConfig.key === 'author' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th 
                    className="pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40 text-center cursor-pointer hover:opacity-100 transition-opacity"
                    onClick={() => handleSort('frequency')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Post Frequency
                      {sortConfig.key === 'frequency' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th 
                    className="pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40 text-center cursor-pointer hover:opacity-100 transition-opacity"
                    onClick={() => handleSort('avgViews')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Avg. View Count
                      {sortConfig.key === 'avgViews' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40">Market Presence</th>
                </tr>
              </thead>
              <tbody>
                {sortedCompetitors.length > 0 ? sortedCompetitors.map((comp, i) => {
                  const isReference = isSharePlanAuthor(comp.author);
                  return (
                  <tr
                    key={i}
                    className={`border-b border-white/5 group transition-all ${isReference ? 'bg-orange-500/10' : 'hover:bg-white/5'}`}
                  >
                    <td className="py-4 text-sm font-medium">
                      {comp.author}
                      {isReference && (
                        <span className="ml-2 px-2 py-0.5 rounded bg-orange-600/20 text-orange-400 text-[10px] uppercase tracking-wider">Reference</span>
                      )}
                    </td>
                    <td className="py-4 text-sm font-mono text-center">{comp.frequency}</td>
                    <td className="py-4 text-sm font-mono text-center">{comp.avgViews}</td>
                    <td className="py-4">
                      <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-orange-600 h-full transition-all duration-1000" 
                          style={{ width: `${Math.min(100, (comp.frequency / (sortedCompetitors[0]?.frequency || 1)) * 100)}%` }} 
                        />
                      </div>
                    </td>
                  </tr>
                )}) : (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-sm opacity-30 italic">No competitor data available yet. Run observer to collect data.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Charts & Logs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Post Velocity Chart */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Post Velocity (Views)</h2>
              <Eye className="w-4 h-4 opacity-30" />
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#ffffff40" 
                    fontSize={10} 
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#ffffff40" 
                    fontSize={10} 
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="views" 
                    stroke="#ea580c" 
                    strokeWidth={3} 
                    dot={{ fill: '#ea580c', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Activity Log Table */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Activity History</h2>
              <Users className="w-4 h-4 opacity-30" />
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${log.status === 'safe' ? 'bg-green-500' : log.status === 'unsafe' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                    <div>
                      <p className="text-xs font-mono opacity-40">{new Date(log.timestamp).toLocaleString()}</p>
                      <p className="text-sm font-medium">Gap: {log.current_gap_count} posts</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs opacity-40">Views</p>
                      <p className="text-sm font-mono">{log.view_count_of_last_post}</p>
                    </div>
                    <button 
                      onClick={() => setSelectedLog(log)}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Draft Status */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Saved Drafts</h2>
            <div className="px-2 py-1 rounded bg-orange-600/20 text-orange-500 text-[10px] font-bold uppercase tracking-wider">
              {drafts.length} Drafts Found
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {drafts.map((draft) => (
              <div key={draft.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between space-y-4 hover:border-orange-500/30 transition-all group">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono opacity-40">{draft.timestamp}</span>
                    <span className="text-[10px] font-bold text-green-500 uppercase">Ready</span>
                  </div>
                  <p className="text-sm font-medium leading-relaxed group-hover:text-orange-500 transition-colors">
                    {draft.title}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] opacity-40 uppercase tracking-widest">Verified Content</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
        </>
        )}
      </main>

      {/* Log Details Modal */}
      <AnimatePresence>
        {selectedLog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLog(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl max-h-[80vh] bg-[#111] border border-white/10 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div>
                  <h3 className="text-lg font-bold">Snapshot Details</h3>
                  <p className="text-xs opacity-40 font-mono">{new Date(selectedLog.timestamp).toLocaleString()}</p>
                </div>
                <button 
                  onClick={() => setSelectedLog(null)}
                  className="p-2 rounded-full hover:bg-white/10 transition-all"
                >
                  <AlertCircle className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Gap Count</p>
                    <p className="text-2xl font-black">{selectedLog.current_gap_count}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Last Post Views</p>
                    <p className="text-2xl font-black">{selectedLog.view_count_of_last_post}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Status</p>
                    <p className={`text-2xl font-black uppercase italic ${selectedLog.status === 'safe' ? 'text-green-500' : 'text-red-500'}`}>
                      {selectedLog.status}
                    </p>
                  </div>
                </div>
                
                {selectedLog.error && (
                  <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">Error Details</h4>
                    <p className="text-sm font-mono text-red-300 whitespace-pre-wrap">{selectedLog.error}</p>
                  </div>
                )}

                <h4 className="text-xs font-bold uppercase tracking-widest opacity-40 px-2">Visible Posts on Page 1</h4>
                <div className="space-y-2">
                  {selectedLog.all_posts?.map((post, i) => {
                    const isSharePlan = post.author.toLowerCase().includes('shareplan');
                    return (
                    <div key={i} className={`p-4 rounded-2xl border transition-all ${isSharePlan ? 'bg-orange-500/20 border-orange-500/50' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] font-bold uppercase ${isSharePlan ? 'text-orange-400' : 'opacity-40'}`}>
                          {post.author}
                        </span>
                        <span className="text-[10px] font-mono opacity-40">{post.date}</span>
                      </div>
                      <p className="text-sm font-medium mb-2">{post.title}</p>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1 opacity-40">
                          <Eye className="w-3 h-3" />
                          <span className="text-[10px] font-mono">{post.views}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-40">
                          <Activity className="w-3 h-3" />
                          <span className="text-[10px] uppercase tracking-widest">Pos: {i + 1}</span>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
      `}</style>
      
      {/* Override Confirm Modal */}
      <AnimatePresence>
        {showOverrideModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#111] border border-white/10 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold tracking-tight text-white">Unsafe to Publish</h3>
                <p className="text-sm opacity-60 leading-relaxed">
                  The gap threshold policy indicates the board is too slow right now. Scheduled rules will skip execution and prevent publishing. 
                </p>
                <div className="w-full h-[1px] bg-white/10" />
                <p className="text-sm opacity-60 font-semibold text-orange-400">
                  If you really want to force a post out, use the Manual Override action.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowOverrideModal(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowOverrideModal(false);
                    runPublisher(true);
                  }}
                  className="flex-1 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-600/20 text-white font-bold text-sm transition-all flex items-center gap-2 justify-center"
                >
                  <Send className="w-4 h-4" />
                  Force Override
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      </div>
    </div>
  );
}
