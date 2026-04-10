import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Eye, Activity } from 'lucide-react';
import type { ActivityLog } from '../lib/controlPanel';

interface LogDetailModalProps {
  log: ActivityLog;
  onClose: () => void;
}

export default function LogDetailModal({ log, onClose }: LogDetailModalProps) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
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
              <p className="text-xs opacity-40 font-mono">{new Date(log.timestamp).toLocaleString()}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 transition-all"
            >
              <AlertCircle className="w-5 h-5 rotate-45" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Gap Count</p>
                <p className="text-2xl font-black">{log.current_gap_count}</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Last Post Views</p>
                <p className="text-2xl font-black">{log.view_count_of_last_post}</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Status</p>
                <p className={`text-2xl font-black uppercase italic ${log.status === 'safe' ? 'text-green-500' : 'text-red-500'}`}>
                  {log.status}
                </p>
              </div>
            </div>

            {log.error && (
              <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6">
                <h4 className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">Error Details</h4>
                <p className="text-sm font-mono text-red-300 whitespace-pre-wrap">{log.error}</p>
              </div>
            )}

            <h4 className="text-xs font-bold uppercase tracking-widest opacity-40 px-2">Visible Posts on Page 1</h4>
            <div className="space-y-2">
              {log.all_posts?.map((post, i) => {
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
    </AnimatePresence>
  );
}
