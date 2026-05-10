import { useCallback, useEffect, useRef, useState } from "react";

// ── Types (mirroring lib/competitor-intel-ui.ts) ─────────────────────────────

export type OverviewPayload = {
  totalRecords: number;
  vendorCount: number;
  productCount: number;
  latestCapture: string | null;
  confidenceAvg: number | null;
  extractionSourceBreakdown: Array<{ source: string; count: number }>;
};

export type VendorSummary = {
  vendorId: string;
  authorName: string | null;
  totalPosts: number;
  firstSeen: string | null;
  lastSeen: string | null;
  products: string[];
  accountTypes: Array<{ type: string; count: number }>;
};

export type AdProduct = {
  name: string;
  plan_tier?: string;
  duration_months?: number;
  price_krw?: number;
  price_per_month_krw?: number;
  constraints?: string;
};

export type RecordListEntry = {
  recordId: string;
  runId: string;
  vendor: string;
  authorName: string | null;
  postUrl: string;
  postTitle: string | null;
  postedAt: string | null;
  capturedAt: string;
  productNames: string[];
  products: AdProduct[];
  extractionSource: string | null;
  confidence: number | null;
};

export type RecordDetail = RecordListEntry & {
  terms: Record<string, string> | null;
  accountType: string | null;
  region: string | null;
  bundle: string | null;
  promo: string | null;
  conditions: string | null;
  contact: string | null;
  notes: string | null;
};

export type ProductPriceRow = {
  productName: string;
  vendor: string;
  priceKrw: number | null;
  pricePerMonthKrw: number | null;
  durationMonths: number | null;
  planTier: string | null;
  constraints: string | null;
  postUrl: string;
  postedAt: string | null;
};

export type TimelineBucket = {
  date: string;
  vendor: string;
  count: number;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCompetIntel() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [records, setRecords] = useState<RecordListEntry[]>([]);
  const [recordDetail, setRecordDetail] = useState<RecordDetail | null>(null);
  const [products, setProducts] = useState<ProductPriceRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(0);
  const [filterVendor, setFilterVendor] = useState<string | undefined>(undefined);
  const [timelineDays, setTimelineDays] = useState(30);
  const recordPageRef = useRef(0);

  const RECORDS_PER_PAGE = 20;

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/competitor-intel/overview");
      if (res.ok) setOverview(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch("/api/competitor-intel/vendors");
      if (res.ok) setVendors(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchRecords = useCallback(async (page: number, vendor?: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(RECORDS_PER_PAGE),
        offset: String(page * RECORDS_PER_PAGE),
      });
      if (vendor) params.set("vendor", vendor);
      const res = await fetch(`/api/competitor-intel/records?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.entries);
        setRecordTotal(data.total);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  const fetchRecordDetail = useCallback(async (recordId: string) => {
    try {
      const res = await fetch(`/api/competitor-intel/records/${recordId}`);
      if (res.ok) {
        const data = await res.json();
        setRecordDetail(data);
        setSelectedRecordId(recordId);
      }
    } catch { /* silent */ }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/competitor-intel/products");
      if (res.ok) setProducts(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchTimeline = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/competitor-intel/timeline?days=${days}`);
      if (res.ok) setTimeline(await res.json());
    } catch { /* silent */ }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchOverview(),
      fetchVendors(),
      fetchProducts(),
      fetchTimeline(timelineDays),
      fetchRecords(recordPageRef.current, filterVendor),
    ]);
  }, [fetchOverview, fetchVendors, fetchProducts, fetchTimeline, fetchRecords, timelineDays, filterVendor]);

  // Initial load
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Re-fetch records when page or vendor filter changes
  useEffect(() => {
    fetchRecords(recordPage, filterVendor);
  }, [recordPage, filterVendor, fetchRecords]);

  // Re-fetch timeline when days change
  useEffect(() => {
    fetchTimeline(timelineDays);
  }, [timelineDays, fetchTimeline]);

  const closeRecordDetail = useCallback(() => {
    setRecordDetail(null);
    setSelectedRecordId(null);
  }, []);

  const goToRecordPage = useCallback((page: number) => {
    recordPageRef.current = page;
    setRecordPage(page);
  }, []);

  return {
    overview,
    vendors,
    records,
    recordDetail,
    products,
    timeline,
    loading,
    selectedRecordId,
    recordTotal,
    recordPage,
    filterVendor,
    timelineDays,
    refreshAll,
    fetchRecordDetail,
    closeRecordDetail,
    setFilterVendor,
    goToRecordPage,
    setTimelineDays,
    setRecordPage: goToRecordPage,
  };
}
