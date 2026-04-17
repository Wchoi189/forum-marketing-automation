import React from 'react';
import { motion } from 'motion/react';
import { type UseAppDataReturn } from '../hooks/useAppData';
import { type AiAdvisorOutput } from '../lib/controlPanel';

export default function AiAdvisorPanel({ app }: { app: UseAppDataReturn }) {
  const { aiRec, aiRecBuiltAt, aiRecApplied, aiAppliedValues, aiRecRefreshAttempted, refreshAiRecommendation, applyAiRecommendation, loading, aiTokenStats } = app;

  const ageMinutes = aiRecBuiltAt ? Math.round((Date.now() - new Date(aiRecBuiltAt).getTime()) / 60000) : null;
  const isStale = ageMinutes !== null && ageMinutes > 30;
  const isRefreshing = loading;

  const confidenceBadge: Record<AiAdvisorOutput['confidence'], string> = {
    high: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    low: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
  };

  const handleRefresh = () => {
    refreshAiRecommendation();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="p-8 rounded-3xl border border-white/10 bg-white/5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium opacity-50 uppercase tracking-widest">AI Advisor</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Get new recommendation"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {aiRec && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${confidenceBadge[aiRec.confidence]}`}>
              {aiRec.confidence}
            </span>
          )}
        </div>
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
                <p className="text-[10px] text-amber-400/80">Stale — refresh to get updated recommendation</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {aiRecApplied && aiAppliedValues && (
                <span className="text-[10px] text-emerald-400/80 font-medium">
                  Applied — Gap: <span className="font-mono">{aiAppliedValues.gapThreshold}</span> posts · Interval: <span className="font-mono">{aiAppliedValues.intervalMinutes}</span> min
                </span>
              )}
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
        <div className="space-y-2">
          <p className="text-sm opacity-50">
            {aiRecRefreshAttempted ? 'No recommendation available — advisor may be disabled' : 'Click Refresh to get an AI recommendation'}
          </p>
        </div>
      )}

      {/* Token usage traceability */}
      {aiTokenStats && aiTokenStats.callCount > 0 && (
        <div className="pt-4 border-t border-white/10 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-40">Token Usage (this session)</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
              <p className="text-[9px] opacity-40 uppercase tracking-widest mb-0.5">Calls</p>
              <p className="font-mono text-sm font-bold">{aiTokenStats.callCount}</p>
              <p className="text-[9px] opacity-30">{aiTokenStats.successCount} ok / {aiTokenStats.failureCount} fail</p>
            </div>
            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
              <p className="text-[9px] opacity-40 uppercase tracking-widest mb-0.5">Tokens / call</p>
              <p className="font-mono text-sm font-bold">{aiTokenStats.avgTotalTokens ?? '—'}</p>
              <p className="text-[9px] opacity-30">{aiTokenStats.avgPromptTokens ?? '—'} in / {aiTokenStats.avgCompletionTokens ?? '—'} out</p>
            </div>
            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
              <p className="text-[9px] opacity-40 uppercase tracking-widest mb-0.5">Total tokens</p>
              <p className="font-mono text-sm font-bold">{aiTokenStats.totalTokens.toLocaleString()}</p>
              <p className="text-[9px] opacity-30">
                {aiTokenStats.lastDurationMs != null ? `last ${aiTokenStats.lastDurationMs}ms` : ''}
              </p>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
