import { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import {
  Database, Users, Package, BarChart3, Clock, TrendingUp, Eye, ExternalLink,
  ChevronLeft, ChevronRight, ListFilter, Star, X, Copy, Check,
} from 'lucide-react';
import { useCompetIntel, type VendorSummary, type AdProduct } from '../hooks/useCompetIntel';

// ── Helpers ──────────────────────────────────────────────────────────────────

const KRW_TO_USD = 0.00073; // approximate KRW→USD rate (~1,370 KRW/USD)

function fmtPrice(krw: number | null | undefined): string {
  if (krw == null) return '—';
  return `₩${krw.toLocaleString()}`;
}

function fmtPriceUsd(krw: number | null | undefined): string {
  if (krw == null) return '—';
  return `$${Math.round(krw * KRW_TO_USD).toLocaleString()}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(0)}%`;
}

function confidenceColor(conf: number | null | undefined): string {
  if (conf == null) return 'text-white/40';
  if (conf >= 0.85) return 'text-emerald-400';
  if (conf >= 0.6) return 'text-amber-400';
  return 'text-red-400';
}

function accountTypeColor(type: string): string {
  switch (type) {
    case 'direct_login': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'family_share': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'group_invite': return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    default: return 'bg-white/10 text-white/40 border-white/15';
  }
}

// ── KPI Cards ────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, subtitle, badge }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; subtitle?: string; badge?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 opacity-40" />
          <span className="text-[10px] font-medium uppercase tracking-widest opacity-50">{label}</span>
        </div>
        {badge && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 opacity-40">{badge}</span>}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {subtitle && <div className="text-xs opacity-30 mt-1">{subtitle}</div>}
    </motion.div>
  );
}

// ── Tab Bar ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview' as const, label: 'Vendor Overview' },
  { id: 'records' as const, label: 'Ad Records' },
  { id: 'pricing' as const, label: 'Pricing' },
];

function TabBar({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10 w-fit">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            active === tab.id ? 'bg-orange-600/30 text-orange-200' : 'text-white/50 hover:text-white/80'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Vendor Overview Tab ──────────────────────────────────────────────────────

function ActivityChart({ timeline }: { timeline: { date: string; vendor: string; count: number }[] }) {
  if (timeline.length === 0) return <div className="py-12 text-center text-sm opacity-30 italic">No activity data available</div>;

  const byDate = new Map<string, Record<string, number>>();
  const vendors = new Set<string>();
  for (const t of timeline) {
    const existing = byDate.get(t.date) ?? {};
    existing[t.vendor] = (existing[t.vendor] ?? 0) + t.count;
    byDate.set(t.date, existing);
    vendors.add(t.vendor);
  }

  const vendorList = Array.from(vendors).sort();
  const colors = ['#ea580c', '#38bdf8', '#a78bfa', '#4ade80', '#f472b6', '#fbbf24', '#2dd4bf'];
  const data = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, ...counts }));

  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} />
          <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {vendorList.map((v, i) => (
            <Bar key={v} dataKey={v} stackId="a" fill={colors[i % colors.length]} name={v} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VendorOverviewTab({ intel }: { intel: ReturnType<typeof useCompetIntel> }) {
  const { overview, vendors, timeline, loading } = intel;

  if (loading && !overview) {
    return <div className="py-12 text-center text-sm opacity-40">Loading competitor data...</div>;
  }

  return (
    <div className="space-y-6">
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            icon={Database}
            label="Total Records"
            value={String(overview.totalRecords)}
            subtitle="All captured ads"
            badge={overview.extractionSourceBreakdown.length > 0
              ? overview.extractionSourceBreakdown.map(s => `${s.source}: ${s.count}`).join(', ')
              : undefined}
          />
          <KpiCard icon={Users} label="Active Vendors" value={String(overview.vendorCount)} subtitle="Tracked competitors" />
          <KpiCard icon={Package} label="Products" value={String(overview.productCount)} subtitle="Unique offerings" />
          <KpiCard icon={BarChart3} label="Avg Confidence" value={fmtPct(overview.confidenceAvg)} subtitle="Extraction quality" />
          <KpiCard icon={Clock} label="Last Updated" value={fmtDateTime(overview.latestCapture)} subtitle="Most recent capture" />
        </div>
      )}

      {vendors.length > 0 && (
        <>
          <h3 className="text-xs font-medium uppercase tracking-widest opacity-50">Tracked Vendors</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vendors.map((v: VendorSummary) => {
              const primaryType = v.accountTypes[0]?.type ?? 'unknown';
              return (
                <motion.div key={v.vendorId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-2xl border border-white/10 bg-white/5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold">{v.vendorId}</div>
                      <div className="text-xs opacity-40">{v.totalPosts} posts</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border ${accountTypeColor(primaryType)}`}>
                      {primaryType}
                    </span>
                  </div>
                  {v.authorName && (
                    <div className="text-xs opacity-50 mb-2">Author: <span className="text-white/70">{v.authorName}</span></div>
                  )}
                  {v.products.length > 0 && (
                    <div className="flex gap-1 flex-wrap mb-3">
                      {v.products.slice(0, 5).map((p) => (
                        <span key={p} className="px-2 py-0.5 rounded bg-white/10 text-[10px] truncate max-w-[120px]" title={p}>{p}</span>
                      ))}
                      {v.products.length > 5 && (
                        <span className="text-[10px] opacity-30">+{v.products.length - 5}</span>
                      )}
                    </div>
                  )}
                  <div className="text-[10px] opacity-30 flex gap-3">
                    <span>First: {fmtDate(v.firstSeen)}</span>
                    <span>Last: {fmtDate(v.lastSeen)}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      {timeline.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 opacity-40" />
            <span className="text-[10px] font-medium uppercase tracking-widest opacity-50">Posts Over Time</span>
          </div>
          <ActivityChart timeline={timeline} />
        </motion.div>
      )}
    </div>
  );
}

// ── Ad Records Tab ───────────────────────────────────────────────────────────

function RecordDetailPanel({ record, onClose }: { record: ReturnType<typeof useCompetIntel>['recordDetail']; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyTitle = useCallback(() => {
    if (record.postTitle) {
      navigator.clipboard.writeText(record.postTitle);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [record.postTitle]);

  if (!record) return null;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="p-8 rounded-2xl border border-white/10 bg-white/5 space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold truncate">{record.postTitle ?? record.vendor}</h3>
            {record.postTitle && (
              <button onClick={copyTitle} className="p-1 rounded hover:bg-white/10 transition-colors shrink-0" title="Copy title">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 opacity-40" />}
              </button>
            )}
          </div>
          <p className="text-xs opacity-40 mt-1">{record.vendor} · {fmtDateTime(record.postedAt)}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2">
        {record.confidence != null && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${confidenceColor(record.confidence).replace('text-', 'bg-').replace('400', '500/20').replace('emerald', 'emerald').replace('amber', 'amber').replace('red', 'red')} ${confidenceColor(record.confidence)} border-current`}>
            Confidence: {(record.confidence * 100).toFixed(0)}%
          </span>
        )}
        {record.extractionSource && (
          <span className="px-3 py-1 rounded-full bg-sky-500/10 text-sky-300 text-xs border border-sky-500/20">{record.extractionSource}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {[
          ['Vendor', record.vendor],
          ['Author', record.authorName ?? '—'],
          ['Posted', fmtDateTime(record.postedAt)],
          ['Captured', fmtDateTime(record.capturedAt)],
          ['Source', record.extractionSource ?? '—'],
          ['Confidence', record.confidence != null ? `${(record.confidence * 100).toFixed(0)}%` : '—'],
        ].map(([label, val]) => (
          <div key={label}>
            <div className="text-[10px] font-medium uppercase tracking-widest opacity-40">{label}</div>
            <div className="text-white/80">{val}</div>
          </div>
        ))}
        <div className="col-span-2">
          <div className="text-[10px] font-medium uppercase tracking-widest opacity-40">URL</div>
          <a href={record.postUrl} target="_blank" rel="noopener noreferrer" className="text-orange-400 text-xs hover:underline flex items-center gap-1">
            {record.postUrl} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {record.products.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium uppercase tracking-widest opacity-40 mb-3">Products</h4>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 bg-white/5">
                  {['Product', 'Duration', 'Total Price', 'Cost ($)', 'Per Month', 'Tier', 'Constraints'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 font-bold uppercase tracking-wider opacity-40 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.products.map((p: AdProduct, i: number) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="py-2 px-3 font-medium">{p.name}</td>
                    <td className="py-2 px-3">{p.duration_months != null ? `${p.duration_months}mo` : '—'}</td>
                    <td className="py-2 px-3 font-mono font-semibold">{fmtPrice(p.price_krw)}</td>
                    <td className="py-2 px-3 font-mono">{fmtPriceUsd(p.price_krw)}</td>
                    <td className="py-2 px-3 font-mono">{fmtPrice(p.price_per_month_krw)}</td>
                    <td className="py-2 px-3 opacity-60">{p.plan_tier ?? '—'}</td>
                    <td className="py-2 px-3 opacity-40 max-w-[200px] truncate" title={p.constraints}>{p.constraints ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function AdRecordsTab({ intel }: { intel: ReturnType<typeof useCompetIntel> }) {
  const { records, recordDetail, loading, recordTotal, recordPage, goToRecordPage, filterVendor, setFilterVendor, vendors, fetchRecordDetail, closeRecordDetail } = intel;

  const handleRowClick = useCallback((recordId: string) => {
    fetchRecordDetail(recordId);
  }, [fetchRecordDetail]);

  const vendorOptions = Array.from(new Set(vendors.map((v: VendorSummary) => v.vendorId))).sort() as string[];
  const totalPages = Math.max(1, Math.ceil(recordTotal / 20));

  if (recordDetail) {
    return <RecordDetailPanel record={recordDetail} onClose={closeRecordDetail} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ListFilter className="w-4 h-4 opacity-40" />
        <select
          value={filterVendor ?? ''}
          onChange={(e) => { setFilterVendor(e.target.value || undefined); goToRecordPage(0); }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:border-orange-500/50 focus:outline-none"
        >
          <option value="">All vendors</option>
          {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {loading && records.length === 0 ? (
        <div className="py-12 text-center text-sm opacity-40">Loading records...</div>
      ) : records.length === 0 ? (
        <div className="p-12 rounded-2xl border border-white/10 bg-white/5 text-center text-sm opacity-40">No records found</div>
      ) : (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Vendor', 'Title', 'Products', 'Price', 'Date', 'Conf.', 'Source'].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider opacity-40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.recordId}
                    onClick={() => handleRowClick(r.recordId)}
                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-xs">{r.vendor}</td>
                    <td className="py-3 px-4 max-w-[200px]">
                      <div className="truncate" title={r.postTitle ?? ''}>{r.postTitle ?? '—'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {r.productNames.slice(0, 2).map((name) => (
                          <span key={name} className="px-2 py-0.5 rounded bg-white/10 text-[10px] truncate max-w-[80px]" title={name}>{name}</span>
                        ))}
                        {r.productNames.length > 2 && (
                          <span className="text-[10px] opacity-30">+{r.productNames.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">
                      {(() => { const p = r.products.find((x: AdProduct) => x.price_krw != null); return p ? fmtPrice(p.price_krw) : '—'; })()}
                    </td>
                    <td className="py-3 px-4 text-xs opacity-60">{fmtDate(r.postedAt)}</td>
                    <td className={`py-3 px-4 text-xs font-medium ${confidenceColor(r.confidence)}`}>
                      {r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-xs opacity-50">{r.extractionSource ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs opacity-40">
            <span>{recordTotal} records · Page {recordPage + 1} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => goToRecordPage(recordPage - 1)} disabled={recordPage === 0} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                <ChevronLeft className="w-3 h-3" /> Prev
              </button>
              <button onClick={() => goToRecordPage(recordPage + 1)} disabled={recordPage >= totalPages - 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                Next <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Pricing Tab ──────────────────────────────────────────────────────────────

function PriceScatterChart({ products }: { products: ReturnType<typeof useCompetIntel>['products'] }) {
  const [yMetric, setYMetric] = useState<'total' | 'perMonth'>('total');

  const data = products
    .filter((p) => p.priceKrw != null && p.durationMonths != null)
    .map((p) => ({
      x: p.durationMonths ?? 0,
      y: yMetric === 'total' ? (p.priceKrw ?? 0) : (p.pricePerMonthKrw ?? p.priceKrw ?? 0),
      total: p.priceKrw ?? 0,
      perMonth: p.pricePerMonthKrw ?? 0,
      vendor: p.vendor,
      product: p.productName,
      constraints: p.constraints,
      tier: p.planTier,
    }));

  const vendors = Array.from(new Set(data.map((d) => d.vendor))).sort();
  const colors = ['#ea580c', '#38bdf8', '#a78bfa', '#4ade80', '#f472b6', '#fbbf24', '#2dd4bf'];

  if (data.length === 0) {
    return <div className="py-12 text-center text-sm opacity-30 italic">No pricing data with duration available</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-lg bg-white/5 border border-white/10 w-fit">
        {([['total', 'Total Price'], ['perMonth', 'Per Month']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setYMetric(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              yMetric === key ? 'bg-orange-600/30 text-orange-200' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis type="number" dataKey="x" name="Duration" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} label={{ value: 'Duration (months)', position: 'insideBottom', offset: -5, fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} />
            <YAxis
              type="number"
              dataKey="y"
              tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }}
              tickFormatter={(v: number) => `₩${(v / 1000).toFixed(0)}k`}
              label={{ value: yMetric === 'total' ? 'Price (₩)' : 'Price/Month (₩)', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.4)', fontSize: 12 }}
            />
            <ZAxis range={[64, 64]} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
              formatter={(value: number, name: string, props: { payload: { vendor: string; product: string; tier: string | null; constraints: string | null; total: number; perMonth: number } }) => [
                fmtPrice(value),
                `${props.payload.vendor} — ${props.payload.product}`,
                yMetric === 'total' ? [`Per Month: ${fmtPrice(props.payload.perMonth)}`, ''] : [`Total: ${fmtPrice(props.payload.total)}`, ''],
              ] as React.ReactNode}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {vendors.map((v, i) => (
              <Scatter key={v} name={v} data={data.filter((d) => d.vendor === v)} fill={colors[i % colors.length]} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PricingTab({ intel }: { intel: ReturnType<typeof useCompetIntel> }) {
  const { products, loading } = intel;

  if (loading && products.length === 0) {
    return <div className="py-12 text-center text-sm opacity-40">Loading pricing data...</div>;
  }

  return (
    <div className="space-y-6">
      {products.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-4 h-4 opacity-40" />
            <span className="text-[10px] font-medium uppercase tracking-widest opacity-50">Price Comparison</span>
          </div>
          <PriceScatterChart products={products} />
        </motion.div>
      )}

      {products.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="p-4 border-b border-white/5">
            <span className="text-[10px] font-medium uppercase tracking-widest opacity-50">Price Matrix</span>
            <span className="ml-2 text-[10px] opacity-30">{products.length} entries</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Product', 'Vendor', 'Total Price', 'Cost ($)', 'Per Month', 'Duration', 'Tier', 'Posted'].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider opacity-40 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 max-w-[180px]">
                      <div className="truncate font-medium" title={p.productName}>{p.productName}</div>
                    </td>
                    <td className="py-3 px-4 text-xs">{p.vendor}</td>
                    <td className="py-3 px-4 font-mono text-xs font-semibold">{fmtPrice(p.priceKrw)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{fmtPriceUsd(p.priceKrw)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{fmtPrice(p.pricePerMonthKrw)}</td>
                    <td className="py-3 px-4 text-xs">{p.durationMonths != null ? `${p.durationMonths}mo` : '—'}</td>
                    <td className="py-3 px-4 text-xs">{p.planTier ?? '—'}</td>
                    <td className="py-3 px-4 text-xs opacity-50">{fmtDate(p.postedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {products.length === 0 && !loading && (
        <div className="p-12 rounded-2xl border border-white/10 bg-white/5 text-center text-sm opacity-40">No pricing data available</div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CompetitorIntelPage() {
  const intel = useCompetIntel();
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Competitor Intelligence</h2>
          <p className="text-sm opacity-40 mt-1">Track competitor pricing, product offerings, and posting activity</p>
        </div>
        <TabBar active={activeTab} onChange={setActiveTab} />
      </div>

      <button onClick={intel.refreshAll} className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium flex items-center gap-2">
        <Eye className="w-4 h-4" /> Refresh Data
      </button>

      {activeTab === 'overview' && <VendorOverviewTab intel={intel} />}
      {activeTab === 'records' && <AdRecordsTab intel={intel} />}
      {activeTab === 'pricing' && <PricingTab intel={intel} />}
    </div>
  );
}
