import React from 'react';
import { motion } from 'motion/react';
import { type UseAppDataReturn } from '../hooks/useAppData';
import { stripTaggedErrorPrefix } from '../lib/controlPanel';

export default function PublisherRunsPage({ app }: { app: UseAppDataReturn }) {
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
