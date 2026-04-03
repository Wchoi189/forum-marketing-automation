import React, { useState, useEffect } from 'react';
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
  ResponsiveContainer 
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import type { ActivityLog, BoardStats, CompetitorStat, DraftItem } from '../contracts/models';

/** API errors may already include `[Observer]` / `[Publisher]`; strip one leading tag for readable banner text. */
function stripTaggedErrorPrefix(text: string) {
  return text.replace(/^\[(Observer|Publisher)\]\s*/, '').trim();
}

type ObserverControlState = {
  enabled: boolean;
  minPreVisitDelayMs: number;
  maxPreVisitDelayMs: number;
  minIntervalBetweenRunsMs: number;
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
  running: boolean;
};

type ControlPanelState = {
  preset: 'balanced' | 'night-safe' | 'day-aggressive';
  observer: ObserverControlState;
  autoPublisher: AutoPublisherControlState;
};

const DEFAULT_CONTROL_PANEL: ControlPanelState = {
  preset: 'balanced',
  observer: {
    enabled: true,
    minPreVisitDelayMs: 0,
    maxPreVisitDelayMs: 0,
    minIntervalBetweenRunsMs: 0
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
    running: false
  }
};

function isSharePlanAuthor(author: string) {
  return author.toLowerCase().includes('shareplan');
}

export default function App() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [competitorStats, setCompetitorStats] = useState<CompetitorStat[]>([]);
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string, log?: ActivityLog } | null>(null);

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [controlPanel, setControlPanel] = useState<ControlPanelState>(DEFAULT_CONTROL_PANEL);
  const [controlSaving, setControlSaving] = useState(false);

  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

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
      const [compRes, boardRes] = await Promise.all([
        fetch('/api/competitor-stats'),
        fetch('/api/board-stats')
      ]);
      const [compData, boardData] = await Promise.all([
        compRes.json(),
        boardRes.json()
      ]);
      setCompetitorStats(compData);
      setBoardStats(boardData);
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

  const fetchControlPanel = async () => {
    try {
      const response = await fetch('/api/control-panel');
      const data = await response.json();
      setControlPanel(data);
    } catch (error) {
      console.error('Failed to fetch control panel:', error);
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchDrafts();
    fetchStats();
    fetchControlPanel();
    const interval = setInterval(() => {
      fetchLogs();
      fetchDrafts();
      fetchStats();
      fetchControlPanel();
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
      setControlPanel(data);
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
    try {
      const response = await fetch('/api/run-publisher', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await response.json();
      const label = force ? 'Publisher (manual override)' : 'Publisher (scheduled-style / auto)';
      if (data.success) {
        setActionMessage({ type: 'success', text: `${label} — ${data.message}`, log: data.log });
        fetchLogs();
      } else {
        const detail = stripTaggedErrorPrefix(data.error || data.message || 'Publisher failed.');
        setActionMessage({ type: 'error', text: `${label} — ${detail}`, log: data.log });
      }
    } catch (error) {
      const label = force ? 'Publisher (manual override)' : 'Publisher (scheduled-style / auto)';
      setActionMessage({ type: 'error', text: `${label} — network error (could not reach API).` });
    } finally {
      setLoading(false);
    }
  };

  const latestLog = logs[0];
  const isSafe = latestLog?.status === 'safe';

  const chartData = [...logs].reverse().map(log => ({
    time: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    views: log.view_count_of_last_post,
    gap: log.current_gap_count
  }));

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
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
        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Safety Gauge */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-8 rounded-3xl border ${isSafe ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'} flex flex-col items-center justify-center text-center space-y-4`}
          >
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isSafe ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
              {isSafe ? <ShieldCheck className="w-10 h-10" /> : <ShieldAlert className="w-10 h-10" />}
            </div>
            <div>
              <h2 className="text-sm font-medium opacity-50 uppercase tracking-widest mb-1">Safety Status</h2>
              <p className={`text-3xl font-black uppercase italic ${isSafe ? 'text-green-500' : 'text-red-500'}`}>
                {latestLog ? (isSafe ? 'Safe Zone' : 'Danger Zone') : 'No Data'}
              </p>
              <p className="text-xs opacity-40 mt-2">
                Current Gap: <span className="font-bold text-white">{latestLog?.current_gap_count || 0} posts</span>
              </p>
            </div>
          </motion.div>

          {/* Last Post Info */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Last Post Stats</h2>
              <Clock className="w-4 h-4 opacity-30" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs opacity-40">Timestamp</p>
                <p className="text-xl font-mono">{latestLog?.last_post_timestamp || '--:--:--'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs opacity-40">View Count</p>
                <p className="text-xl font-mono">{latestLog?.view_count_of_last_post || 0}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-white/5">
              <p className="text-xs opacity-40 mb-2">Top Competitors</p>
              <div className="flex flex-wrap gap-2">
                {latestLog?.top_competitor_names.slice(0, 3).map((name, i) => (
                  <span key={i} className="px-2 py-1 rounded bg-white/5 text-[10px] font-medium border border-white/5">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Board Analytics */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Board Analytics</h2>
              <Activity className="w-4 h-4 opacity-30" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs opacity-40">Turnover Rate</p>
                <p className="text-xl font-mono">{boardStats?.turnoverRate || 0} <span className="text-[10px] opacity-50">posts/hr</span></p>
              </div>
              <div className="space-y-1">
                <p className="text-xs opacity-40">Share of Voice</p>
                <p className="text-xl font-mono">{boardStats?.shareOfVoice || 0}%</p>
              </div>
            </div>
            <div className="pt-4 border-t border-white/5">
              <p className="text-xs opacity-40 mb-2">Visibility Status</p>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${boardStats?.shareOfVoice && boardStats.shareOfVoice > 10 ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-[10px] opacity-40 uppercase tracking-widest">
                  {boardStats?.shareOfVoice && boardStats.shareOfVoice > 10 ? 'High Presence' : 'Low Presence'}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Action Status */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-8 rounded-3xl border border-white/10 bg-white/5 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">System Messages</h2>
              <AlertCircle className="w-4 h-4 opacity-30" />
            </div>
            <div className="flex-1 flex items-center justify-center py-4">
              <AnimatePresence mode="wait">
                {actionMessage ? (
                  <motion.div
                    key={actionMessage.text}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`w-full text-center p-4 rounded-2xl border ${actionMessage.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                  >
                    <p className="text-sm font-medium mb-2">{actionMessage.text}</p>
                    {actionMessage.type === 'error' && actionMessage.log && (
                      <button
                        onClick={() => setSelectedLog(actionMessage.log!)}
                        className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-xs font-bold uppercase tracking-wider transition-all"
                      >
                        View Details
                      </button>
                    )}
                  </motion.div>
                ) : (
                  <p className="text-sm opacity-30 italic">System idle...</p>
                )}
              </AnimatePresence>
            </div>
            <button 
              onClick={() => runPublisher(false)}
              disabled={loading || !isSafe}
              className="w-full py-3 rounded-2xl bg-white text-black font-bold text-sm hover:bg-white/90 transition-all disabled:opacity-20"
            >
              Run Auto-Publisher
            </button>
          </motion.div>
        </div>

        {/* Runtime Control Panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">Runtime Control Panel</h2>
            <span className="text-[10px] opacity-40 uppercase tracking-widest">
              Scheduler: {controlPanel.autoPublisher.enabled ? 'Enabled' : 'Paused'} / {controlPanel.autoPublisher.running ? 'Running' : 'Idle'} / Effective {controlPanel.autoPublisher.effectiveIntervalMinutes}m
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs opacity-60 uppercase tracking-widest">Preset</label>
            <select
              value={controlPanel.preset}
              onChange={(e) =>
                setControlPanel((current) => ({
                  ...current,
                  preset: e.target.value as ControlPanelState['preset']
                }))
              }
              className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
            >
              <option value="balanced">Balanced</option>
              <option value="night-safe">Night Safe</option>
              <option value="day-aggressive">Day Aggressive</option>
            </select>
            <span className="text-[10px] opacity-40">Preset updates both observer pacing and scheduler cadence.</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10">
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
            </div>

            <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10">
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
            </div>
          </div>

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
    </div>
  );
}
