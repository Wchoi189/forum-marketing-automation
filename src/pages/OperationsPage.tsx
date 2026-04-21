import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Eye, Users, ChevronUp, ChevronDown } from 'lucide-react';
import { type UseAppDataReturn } from '../hooks/useAppData';

function Th({ label, active, dir, onClick, center }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; center?: boolean }) {
  return (
    <th className={`pb-4 text-[10px] font-bold uppercase tracking-wider opacity-40 cursor-pointer hover:opacity-100 transition-opacity ${center ? 'text-center' : ''}`} onClick={onClick}>
      <div className={`flex items-center gap-1 ${center ? 'justify-center' : ''}`}>{label}{active && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
    </th>
  );
}

export default function OperationsPage({ app }: { app: UseAppDataReturn }) {
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
        <div className="h-[300px] w-full min-w-0">
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
