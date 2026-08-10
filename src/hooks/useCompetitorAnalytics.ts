import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompetitorAnalyticsPayload } from '../../lib/analytics/index';

export type AnalyticsBucket = 'hour' | 'day' | 'week';

export interface AnalyticsKpi {
  topAuthor: string;
  topRate: number;
  topActiveDays: number;
  avgMarket: number;
}

/**
 * Filter state and fetching for GET /api/analytics/competitors.
 * Reloads whenever any filter changes; the page owns nothing but view state.
 */
export function useCompetitorAnalytics() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [bucket, setBucket] = useState<AnalyticsBucket>('day');
  const [excludeNotices, setExcludeNotices] = useState(true);
  const [payload, setPayload] = useState<CompetitorAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('from', new Date(from + 'T00:00:00.000Z').toISOString());
    params.set('to', new Date(to + 'T23:59:59.999Z').toISOString());
    params.set('bucket', bucket);
    if (excludeNotices) params.set('excludeNotices', 'true');
    return `/api/analytics/competitors?${params.toString()}`;
  }, [from, to, bucket, excludeNotices]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(queryUrl);
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Request failed');
        setPayload(null);
        return;
      }
      setPayload(data as CompetitorAnalyticsPayload);
    } catch {
      setError('Network error');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [queryUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpi = useMemo<AnalyticsKpi | null>(() => {
    if (!payload || payload.summary.length === 0) return null;
    const top = payload.summary[0];
    const avgMarket =
      Math.round((payload.summary.reduce((s, r) => s + r.postsPerActiveDay, 0) / payload.summary.length) * 10) / 10;
    return { topAuthor: top.author, topRate: top.postsPerActiveDay, topActiveDays: top.activeDays, avgMarket };
  }, [payload]);

  return {
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
    reload: load,
  };
}
