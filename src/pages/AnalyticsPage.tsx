import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, ChevronLeft, RefreshCw } from 'lucide-react';
import { useCompetitorAnalytics, type AnalyticsBucket } from '../hooks/useCompetitorAnalytics';
import { formatGap } from '../lib/analyticsFormat';
import { AuthorDrawer } from '../components/analytics/AuthorDrawer';
import { BotIntelTab } from '../components/analytics/BotIntelTab';
import { KpiCard } from '../components/analytics/KpiCard';
import { MarketTab } from '../components/analytics/MarketTab';
import { RankingsTab } from '../components/analytics/RankingsTab';

type ActiveTab = 'market' | 'rankings' | 'bot-intel';

export function AnalyticsPage() {
  const {
    from,
    setFrom,
    to,
    setTo,
    bucket,
    setBucket,
    excludeNotices,
    setExcludeNotices,
    payload,
    error,
    loading,
    kpi,
    reload,
  } = useCompetitorAnalytics();

  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('market');
  const [tablePage, setTablePage] = useState(0);

  // A new payload renumbers the ranking, so the current page no longer means anything.
  useEffect(() => {
    setTablePage(0);
  }, [payload]);

  const tabs: { id: ActiveTab; label: string; count?: number }[] = [
    { id: 'market', label: 'Market' },
    { id: 'rankings', label: 'Rankings', count: payload?.summary.length },
    { id: 'bot-intel', label: 'Bot Intel', count: payload?.botSignals.length },
  ];

  const closeDrawer = useCallback(() => setSelectedAuthor(null), []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header — back nav + title + refresh only */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-40">
        <div className="px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Dashboard
            </Link>
            <div className="flex items-center gap-2 border-l border-white/10 pl-4">
              <BarChart3 className="w-5 h-5 text-orange-500" />
              <h1 className="text-lg font-bold tracking-tight">Competitor EDA</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            title="Refresh"
            className="p-2 rounded-full hover:bg-white/5 disabled:opacity-50 transition-colors text-white/60 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Two-column shell */}
      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {/* Sidebar — 240px, sticky */}
        <aside className="w-60 flex-shrink-0 border-r border-white/10 px-4 py-6 sticky top-14 self-start space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Date range</p>
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-xs text-white/50">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-white text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/50">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-white text-xs"
                />
              </label>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Bucket</p>
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value as AnalyticsBucket)}
              className="w-full px-2 py-1.5 rounded-md bg-[#1a1a1a] border border-white/10 text-white text-xs [&>option]:bg-[#1a1a1a]"
            >
              <option value="hour">Hourly</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeNotices}
              onChange={(e) => setExcludeNotices(e.target.checked)}
              className="accent-orange-500"
            />
            Exclude notices
          </label>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-6 py-6 space-y-5">
          {error && (
            <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm">{error}</div>
          )}

          {!payload && !error && loading && (
            <p className="text-sm opacity-50 flex items-center gap-2 pt-4">
              <Activity className="w-4 h-4 animate-pulse" /> Loading analytics…
            </p>
          )}

          {payload && (
            <>
              {/* KPI row — always visible */}
              {kpi && (
                <section className="flex flex-wrap gap-3">
                  <KpiCard
                    label="Most Active"
                    value={kpi.topAuthor}
                    sub={`${kpi.topRate.toFixed(1)}/day · ${kpi.topActiveDays} active days`}
                  />
                  <KpiCard
                    label="Market Avg Posts/Day"
                    value={kpi.avgMarket.toFixed(1)}
                    sub={`across ${payload.summary.length} authors`}
                  />
                  <KpiCard
                    label="Data Freshness"
                    value={
                      <span className={payload.dataHealth.largeGapWarning ? 'text-amber-400' : 'text-orange-400'}>
                        {formatGap(payload.dataHealth.medianGapHours)}
                      </span>
                    }
                    sub={
                      payload.dataHealth.largeGapWarning
                        ? '⚠ Wide gaps — rates approximate'
                        : `${payload.dataHealth.snapshotCount} snapshots`
                    }
                  />
                </section>
              )}

              {/* Tab bar */}
              <div className="flex gap-1 border-b border-white/10">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-2.5 text-sm font-medium transition-colors relative ${
                      activeTab === tab.id
                        ? 'text-white'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    {tab.label}
                    {tab.count !== undefined && (
                      <span className="ml-1.5 text-[10px] text-white/30">{tab.count}</span>
                    )}
                    {activeTab === tab.id && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t" />
                    )}
                  </button>
                ))}
              </div>

              {activeTab === 'market' && <MarketTab payload={payload} />}

              {activeTab === 'rankings' && (
                <RankingsTab
                  payload={payload}
                  from={from}
                  to={to}
                  selectedAuthor={selectedAuthor}
                  onSelectAuthor={setSelectedAuthor}
                  page={tablePage}
                  onPageChange={setTablePage}
                />
              )}

              {activeTab === 'bot-intel' && <BotIntelTab payload={payload} />}
            </>
          )}
        </main>
      </div>

      {/* Author detail drawer — overlays main content */}
      {payload && (
        <AuthorDrawer
          author={selectedAuthor}
          payload={payload}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
