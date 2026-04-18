import React from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  ShieldAlert,
  Send,
  Activity,
  Clock,
  Users,
  Eye,
  AlertCircle
} from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import PipelineCanvas, { PipelineStepId } from '../PipelineCanvas';
import type { UseAppDataReturn } from '../hooks/useAppData';

interface OverviewPageProps {
  app: UseAppDataReturn;
  currentStep: PipelineStepId;
  simulationIndex: number;
  isSimulating: boolean;
  STAGES: PipelineStepId[];
  onStartSimulation: () => void;
  onResetSimulation: () => void;
}

export default function OverviewPage({
  app,
  currentStep,
  simulationIndex,
  isSimulating,
  STAGES,
  onStartSimulation,
  onResetSimulation
}: OverviewPageProps) {
  const latestLog = app.logs[0];
  const isSafe = latestLog?.status === 'safe';
  const isKnownUnsafe = latestLog?.status === 'unsafe';
  const safetyUiState = latestLog ? (isSafe ? 'safe' : (isKnownUnsafe ? 'unsafe' : 'unknown')) : 'unknown';
  const minGapRequired = latestLog?.gap_threshold_min ?? app.controlPanel.observer.gapThresholdMin;

  const chartData = app.logs.map(log => ({
    time: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    views: log.view_count_of_last_post,
    gap: log.current_gap_count
  }));

  return (
    <>
    {/* ── Level 0: Global Status Strip ─────────────────────────────── */}
    <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-3 flex items-center justify-between text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        {app.controlPanel?.autoPublisher.running ? (
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        ) : (
          <span className={`w-2 h-2 rounded-full ${app.controlPanel?.autoPublisher.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
        )}
        <span className="font-semibold text-white/80">
          Auto-Publish:{' '}
          {app.controlPanel?.autoPublisher.running
            ? <span className="text-orange-400">Publishing…</span>
            : app.controlPanel?.autoPublisher.enabled
              ? <span className="text-green-400">Active</span>
              : <span className="text-gray-400">Paused</span>}
        </span>
        {app.controlPanel?.autoPublisher.enabled && !app.controlPanel?.autoPublisher.running && (
          <>
            <span className="text-white/40">|</span>
            <span className="text-white/40 text-xs">publishes automatically when gap is safe</span>
          </>
        )}
        {app.controlPanel?.autoPublisher.enabled && app.controlPanel?.autoPublisher.nextTickEta && !app.controlPanel?.autoPublisher.running && (
          <>
            <span className="text-white/40">|</span>
            <span className="text-white/60">
              Next attempt: {new Date(app.controlPanel.autoPublisher.nextTickEta).toLocaleTimeString()}
            </span>
          </>
        )}
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
          <button
            onClick={() => safetyUiState === 'unsafe' ? app.setShowOverrideModal(true) : app.runPublisher(false)}
            disabled={app.loading}
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
          onClick={onStartSimulation}
          disabled={isSimulating}
          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-xs transition-all disabled:opacity-40"
        >
          Start Simulation
        </button>
        <button
          onClick={onResetSimulation}
          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-xs transition-all"
        >
          Reset
        </button>
      </div>
    </motion.div>

    {/* ── Level 2: KPI Strip — 4 short widgets ─────────────────────── */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <p className="text-2xl font-mono font-bold">{app.boardStats?.turnoverRate ?? 0}</p>
          <p className="text-[10px] opacity-40 uppercase tracking-widest mt-0.5">posts / hr</p>
        </div>
      </motion.div>

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
          <p className="text-2xl font-mono font-bold">{app.boardStats?.shareOfVoice ?? 0}%</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${app.boardStats?.shareOfVoice && app.boardStats.shareOfVoice > 10 ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-[10px] opacity-40 uppercase tracking-widest">
              {app.boardStats?.shareOfVoice && app.boardStats.shareOfVoice > 10 ? 'High Presence' : 'Low Presence'}
            </span>
          </div>
        </div>
      </motion.div>
    </div>

    {/* ── Level 3: Data & Logs — 3-col grid (chart × 2, logs × 1) ──── */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
              {app.trendInsights?.precedenceNote ? ` ${app.trendInsights.precedenceNote}` : ''}
            </p>
          </div>
          {app.trendInsights && (
            <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-widest opacity-60 shrink-0">
              <span>Window {app.trendInsights.windowDays}d</span>
              <span>Mult ×{app.trendInsights.trendMultiplier}</span>
              <span>Conf {Math.round(app.trendInsights.confidence * 100)}%</span>
              <span className="text-orange-300/90">{app.trendInsights.multiplierBand.replace(/_/g, ' ')}</span>
              <span className={
                app.trendInsights.sovFactor < 1 ? 'text-amber-300/90' :
                app.trendInsights.sovFactor > 1 ? 'text-emerald-300/90' : ''
              }>
                SoV {app.trendInsights.sovPercent}%
              </span>
            </div>
          )}
        </div>

        {app.trendInsights ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Avg posts/hr</p>
                <p className="text-xl font-mono font-bold">{app.trendInsights.avgNewPostsPerHour}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Volatility</p>
                <p className="text-xl font-mono font-bold">{app.trendInsights.volatility}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Advisory intervals</p>
                <p className="text-sm font-mono">Q~{app.trendInsights.recommendedIntervalMinutesQuiet}m · A~{app.trendInsights.recommendedIntervalMinutesActive}m</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Share of Voice</p>
                <p className={`text-xl font-mono font-bold ${
                  app.trendInsights.sovFactor < 1 ? 'text-amber-400' :
                  app.trendInsights.sovFactor > 1 ? 'text-emerald-400' : ''
                }`}>{app.trendInsights.sovPercent}%</p>
                <p className="text-[10px] opacity-50 mt-0.5">
                  {app.trendInsights.sovFactor < 1 ? 'underrep · ×0.75' :
                   app.trendInsights.sovFactor > 1 ? 'overrep · ×1.20' : 'neutral · ×1.00'}
                </p>
              </div>
            </div>
            {app.trendInsights.schedulerSignals && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Signal multiplier</p>
                  <p className="text-xl font-mono font-bold">×{app.trendInsights.schedulerSignals.summary.isolatedMultiplier.toFixed(2)}</p>
                  <p className="text-[10px] opacity-50 mt-0.5">{app.trendInsights.schedulerSignals.summary.reason.replace(/_/g, ' ')}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Attempt / recheck</p>
                  <p className="text-xl font-mono font-bold">{app.trendInsights.schedulerSignals.summary.publishAttemptCount}/{app.trendInsights.schedulerSignals.summary.gapRecheckCount}</p>
                  <p className="text-[10px] opacity-50 mt-0.5">{app.trendInsights.schedulerSignals.summary.adaptationEligibleCount} eligible</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Calibration p10~p90</p>
                  <p className="text-sm font-mono font-bold">{app.trendInsights.schedulerSignals.calibration.isolatedMultiplierP10.toFixed(2)} ~ {app.trendInsights.schedulerSignals.calibration.isolatedMultiplierP90.toFixed(2)}</p>
                  <p className="text-[10px] opacity-50 mt-0.5">hit rate {Math.round(app.trendInsights.schedulerSignals.calibration.isolatedBoundHitRate * 100)}%</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Bound suggestion</p>
                  <p className="text-sm font-mono font-bold">{app.trendInsights.schedulerSignals.calibration.suggestedMinBound.toFixed(2)} ~ {app.trendInsights.schedulerSignals.calibration.suggestedMaxBound.toFixed(2)}</p>
                  <p className="text-[10px] opacity-50 mt-0.5">{app.trendInsights.schedulerSignals.calibration.recommendation.replace(/_/g, ' ')}</p>
                </div>
              </div>
            )}
            <div className="w-full h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={app.trendInsights.hourlyProfile.map((h) => ({ label: `${h.hour}h`, rate: h.avgNewPostsPerHour }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis dataKey="label" tick={{ fill: '#ffffff55', fontSize: 9 }} interval={3} />
                  <YAxis tick={{ fill: '#ffffff55', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: 8 }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                    {app.trendInsights.hourlyProfile.map((_, i) => (
                      <Cell key={i} fill={i % 2 === 0 ? '#ea580caa' : '#f97316cc'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] opacity-35 font-mono">{app.trendInsights.confidenceReason.replace(/_/g, ' ')}</p>
          </div>
        ) : (
          <p className="text-sm opacity-40 italic">Loading trend insights…</p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-6 rounded-3xl border border-white/10 bg-white/5 flex flex-col gap-4"
      >
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[10px] font-medium opacity-50 uppercase tracking-widest">System Messages</h2>
            <AlertCircle className="w-3.5 h-3.5 opacity-25" />
          </div>
          <AnimatePresence mode="wait">
            {app.actionMessage ? (
              <motion.div
                key={app.actionMessage.text}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`text-left break-words p-3 rounded-xl border text-xs ${app.actionMessage.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
              >
                <p className="font-medium mb-1.5">{app.actionMessage.text}</p>
                {app.actionMessage.type === 'error' && app.actionMessage.log && (
                  <button
                    onClick={() => app.setSelectedLog(app.actionMessage.log!)}
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

        <div className="border-t border-white/5" />

        <div className="flex-1 min-h-0 flex flex-col">
          <p className="text-[10px] font-medium opacity-50 uppercase tracking-widest mb-2">Publisher Runs</p>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1" style={{ maxHeight: '340px' }}>
            {app.publisherHistory.length === 0 ? (
              <p className="text-[10px] opacity-35">No runs recorded yet.</p>
            ) : (
              app.publisherHistory.map((row, i) => (
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
                        app.setActionMessage({ type: 'success', text: `Copied artifact path: ${row.artifactDir}` });
                      }}
                      className="text-[9px] uppercase opacity-70 border border-white/20 px-1 rounded hover:opacity-100"
                      title={row.artifactDir}
                    >
                      copy artifactDir
                    </button>
                  )}
                  <span className="opacity-60 break-all">{(row.message || '').replace(/^\[(Observer|Publisher)\]\s*/, '').trim()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </div>
    </>
  );
}
