export function BotBadge({ tier }: { tier: 'low' | 'medium' | 'high' }) {
  const styles: Record<string, string> = {
    low: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    medium: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    high: 'bg-red-500/15 text-red-300 border border-red-500/30'
  };
  const labels: Record<string, string> = { low: 'Low', medium: 'Med', high: 'High' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles[tier]}`}>
      {labels[tier]}
    </span>
  );
}
