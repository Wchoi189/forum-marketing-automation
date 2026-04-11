import React from 'react';
import { NumField } from '../ui/FormFields';
import { type UseAppDataReturn } from '../../hooks/useAppData';

export default function PublisherSettingsPanel({ app }: { app: UseAppDataReturn }) {
  return (
    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Publisher — saved drafts</p>
      <p className="text-[10px] opacity-50 leading-relaxed">The drafts list alternates each saved post with an empty &quot;Preview&quot; row. Item 1 = first data row, item 2 = third <code className="text-orange-400/90">tr</code>, etc. The configured row must still match the required draft title guard server-side.</p>
      <NumField label="Draft item number (1-based)" value={app.controlPanel.publisher.draftItemIndex} max={50} onChange={(v) => app.setControlPanel((c) => ({ ...c, publisher: { ...c.publisher, draftItemIndex: Math.max(1, Math.min(50, v)) } }))} />
    </div>
  );
}
