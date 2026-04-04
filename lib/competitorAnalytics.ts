import type { ActivityLog, Post } from "../contracts/models.js";

export type AnalyticsBucket = "hour" | "day" | "week";

export type NewPostEvent = {
  postKey: string;
  author: string;
  title: string;
  views: number;
  isNotice: boolean;
  firstSeenAtMs: number;
  postDateParsedMs: number | null;
};

export type CompetitorAnalyticsQuery = {
  fromMs: number;
  toMs: number;
  bucket: AnalyticsBucket;
  excludeNotices: boolean;
  authorFilter: string[] | null;
};

export type DataHealthStrip = {
  snapshotCount: number;
  medianGapHours: number | null;
  largeGapWarning: boolean;
  fromIso: string;
  toIso: string;
  bucket: AnalyticsBucket;
};

export type AuthorSummaryRow = {
  author: string;
  postsInRange: number;
  postsPerDay: number;
  totalViews: number;
  rank: number;
};

export type HeatmapCell = {
  dayOfWeek: number;
  hour: number;
  count: number;
};

export type HeatmapBlock = {
  mode: "post_date_parsed" | "snapshot_hour_only";
  cells: HeatmapCell[];
};

export type BotLikenessTier = "low" | "medium" | "high";

export type AuthorBotSignals = {
  author: string;
  postCount: number;
  interArrivalCv: number | null;
  clockAlignmentScore: number;
  hourEntropy: number;
  circadianUniformity: number;
  burstMaxIn6h: number;
  burstRatio: number;
  heuristicTier: BotLikenessTier;
};

export type CompetitorAnalyticsPayload = {
  dataHealth: DataHealthStrip;
  timeSeries: Record<string, string | number>[];
  seriesAuthors: string[];
  summary: AuthorSummaryRow[];
  heatmap: HeatmapBlock;
  botSignals: AuthorBotSignals[];
  disclaimer: string;
};

function postKey(p: Post): string {
  return `${p.title}::${p.author}`;
}

/** Try to interpret board `Post.date` for heatmap; fall back to null (use snapshot time only). */
export function parsePostBoardDate(dateStr: string, snapshotMs: number): number | null {
  if (!dateStr?.trim()) return null;
  const t = dateStr.trim();
  const snap = new Date(snapshotMs);
  const isoTry = Date.parse(t);
  if (!Number.isNaN(isoTry)) return isoTry;

  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const m = parseInt(hm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const d = new Date(snap);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    }
  }

  const mdhm = t.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (mdhm) {
    const month = parseInt(mdhm[1], 10) - 1;
    const day = parseInt(mdhm[2], 10);
    const h = parseInt(mdhm[3], 10);
    const min = parseInt(mdhm[4], 10);
    const d = new Date(snap.getFullYear(), month, day, h, min, 0, 0);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }

  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function extractNewPostEvents(
  logs: ActivityLog[],
  fromMs: number,
  toMs: number,
  excludeNotices: boolean
): NewPostEvent[] {
  const sorted = logs
    .filter((l) => l.status !== "error" && Array.isArray(l.all_posts))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const events: NewPostEvent[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const currTs = Date.parse(curr.timestamp);
    if (currTs < fromMs || currTs > toMs) continue;

    const prevKeys = new Set((prev.all_posts ?? []).map((p) => postKey(p)));
    for (const p of curr.all_posts ?? []) {
      if (excludeNotices && p.isNotice) continue;
      if (prevKeys.has(postKey(p))) continue;
      events.push({
        postKey: postKey(p),
        author: p.author,
        title: p.title,
        views: p.views,
        isNotice: p.isNotice,
        firstSeenAtMs: currTs,
        postDateParsedMs: parsePostBoardDate(p.date, currTs)
      });
    }
  }

  return events;
}

function bucketStartMs(ms: number, bucket: AnalyticsBucket): number {
  const d = new Date(ms);
  if (bucket === "hour") {
    d.setMinutes(0, 0, 0);
    return d.getTime();
  }
  if (bucket === "day") {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketLabel(ms: number, bucket: AnalyticsBucket): string {
  const d = new Date(ms);
  if (bucket === "hour") {
    return d.toISOString().slice(0, 13).replace("T", " ");
  }
  if (bucket === "day") {
    return d.toISOString().slice(0, 10);
  }
  return `Wk ${d.toISOString().slice(0, 10)}`;
}

function computeBotSignalsForAuthor(author: string, events: NewPostEvent[]): AuthorBotSignals {
  const times = events.map((e) => e.firstSeenAtMs).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i] - times[i - 1]) / (1000 * 60 * 60));
  }

  let interArrivalCv: number | null = null;
  if (gaps.length >= 3) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
    const sd = Math.sqrt(variance);
    interArrivalCv = mean > 1e-6 ? sd / mean : null;
  }

  let round5 = 0;
  for (const t of times) {
    if (new Date(t).getMinutes() % 5 === 0) round5++;
  }
  const clockAlignmentScore = times.length ? round5 / times.length : 0;

  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const t of times) {
    hourCounts[new Date(t).getHours()]++;
  }
  const hourEntropy = shannonEntropy(hourCounts);
  const maxEnt = Math.log2(24);
  const circadianUniformity = maxEnt > 0 ? hourEntropy / maxEnt : 0;

  let burstMaxIn6h = 0;
  for (let i = 0; i < times.length; i++) {
    let c = 1;
    for (let j = i + 1; j < times.length && times[j] - times[i] <= 6 * 60 * 60 * 1000; j++) {
      c++;
    }
    burstMaxIn6h = Math.max(burstMaxIn6h, c);
  }
  const burstRatio = times.length ? burstMaxIn6h / times.length : 0;

  let score = 0;
  if (interArrivalCv !== null && interArrivalCv < 0.35 && times.length >= 4) score += 2;
  if (circadianUniformity > 0.88 && times.length >= 5) score += 2;
  if (clockAlignmentScore > 0.55 && times.length >= 4) score += 1;
  if (burstRatio > 0.45 && times.length >= 5) score += 1;

  let heuristicTier: BotLikenessTier = "low";
  if (score >= 4) heuristicTier = "high";
  else if (score >= 2) heuristicTier = "medium";

  return {
    author,
    postCount: times.length,
    interArrivalCv,
    clockAlignmentScore,
    hourEntropy,
    circadianUniformity,
    burstMaxIn6h,
    burstRatio,
    heuristicTier
  };
}

const DISCLAIMER =
  "Heuristic indicators only—not proof of automation. Regular humans, campaigns, or timezone effects can mimic bot-like patterns. Snapshot timing limits precision.";

export function buildCompetitorAnalyticsPayload(
  logs: ActivityLog[],
  query: CompetitorAnalyticsQuery
): CompetitorAnalyticsPayload {
  const { fromMs, toMs, bucket, excludeNotices, authorFilter } = query;

  const sortedWindow = logs
    .filter((l) => {
      const t = Date.parse(l.timestamp);
      return (
        t >= fromMs &&
        t <= toMs &&
        l.status !== "error" &&
        Array.isArray(l.all_posts) &&
        (l.all_posts?.length ?? 0) > 0
      );
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const gapHours: number[] = [];
  for (let i = 1; i < sortedWindow.length; i++) {
    gapHours.push((Date.parse(sortedWindow[i].timestamp) - Date.parse(sortedWindow[i - 1].timestamp)) / 3600000);
  }
  const med = median(gapHours);
  const medianGapHours = med;
  const largeGapWarning = med !== null && med > 8;

  let events = extractNewPostEvents(logs, fromMs, toMs, excludeNotices);
  if (authorFilter && authorFilter.length > 0) {
    const set = new Set(authorFilter.map((a) => a.trim().toLowerCase()));
    events = events.filter((e) => set.has(e.author.trim().toLowerCase()));
  }

  const authorTotals = new Map<string, number>();
  const authorViews = new Map<string, number>();
  for (const e of events) {
    authorTotals.set(e.author, (authorTotals.get(e.author) ?? 0) + 1);
    authorViews.set(e.author, (authorViews.get(e.author) ?? 0) + e.views);
  }

  const topAuthors = [...authorTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([a]) => a);

  const rangeDays = Math.max(1, (toMs - fromMs) / (24 * 60 * 60 * 1000));

  const summary: AuthorSummaryRow[] = [...authorTotals.entries()]
    .map(([author, postsInRange]) => ({
      author,
      postsInRange,
      postsPerDay: Number((postsInRange / rangeDays).toFixed(3)),
      totalViews: authorViews.get(author) ?? 0,
      rank: 0
    }))
    .sort((a, b) => b.postsInRange - a.postsInRange)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const bucketMap = new Map<number, Map<string, number>>();

  for (const e of events) {
    const start = bucketStartMs(e.firstSeenAtMs, bucket);
    if (!bucketMap.has(start)) bucketMap.set(start, new Map());
    const m = bucketMap.get(start)!;
    const seriesAuthor = topAuthors.includes(e.author) ? e.author : "_other";
    m.set(seriesAuthor, (m.get(seriesAuthor) ?? 0) + 1);
  }

  const allStarts = [...bucketMap.keys()].sort((a, b) => a - b);
  const timeSeries: Record<string, string | number>[] = [];
  for (const start of allStarts) {
    const row: Record<string, string | number> = { bucket: bucketLabel(start, bucket) };
    let total = 0;
    const inner = bucketMap.get(start)!;
    for (const a of topAuthors) {
      const c = inner.get(a) ?? 0;
      row[a] = c;
      total += c;
    }
    const other = inner.get("_other") ?? 0;
    row._other = other;
    total += other;
    row._total = total;
    timeSeries.push(row);
  }

  const seriesAuthors = [...topAuthors, "_other"];

  let parsedForHeat = 0;
  const heatParsed = new Map<string, number>();
  const heatSnap = new Map<string, number>();

  for (const e of events) {
    const refMs = e.postDateParsedMs ?? e.firstSeenAtMs;
    const d = new Date(refMs);
    const dow = d.getDay();
    const hour = d.getHours();
    const k = `${dow},${hour}`;
    if (e.postDateParsedMs !== null) {
      parsedForHeat++;
      heatParsed.set(k, (heatParsed.get(k) ?? 0) + 1);
    }
    {
      const ds = new Date(e.firstSeenAtMs);
      const ks = `${ds.getDay()},${ds.getHours()}`;
      heatSnap.set(ks, (heatSnap.get(ks) ?? 0) + 1);
    }
  }

  const useParsed = events.length > 0 && parsedForHeat / events.length >= 0.4;
  const sourceMap = useParsed ? heatParsed : heatSnap;
  const heatmap: HeatmapBlock = {
    mode: useParsed ? "post_date_parsed" : "snapshot_hour_only",
    cells: [...sourceMap.entries()].map(([k, count]) => {
      const [dow, hour] = k.split(",").map(Number);
      return { dayOfWeek: dow, hour, count };
    })
  };

  const byAuthor = new Map<string, NewPostEvent[]>();
  for (const e of events) {
    if (!byAuthor.has(e.author)) byAuthor.set(e.author, []);
    byAuthor.get(e.author)!.push(e);
  }

  const botAuthors = [...authorTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([a]) => a);

  const botSignals = botAuthors.map((a) => computeBotSignalsForAuthor(a, byAuthor.get(a) ?? []));

  return {
    dataHealth: {
      snapshotCount: sortedWindow.length,
      medianGapHours,
      largeGapWarning,
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
      bucket
    },
    timeSeries,
    seriesAuthors,
    summary,
    heatmap,
    botSignals,
    disclaimer: DISCLAIMER
  };
}

export function parseAnalyticsQuery(req: {
  query: Record<string, string | string[] | undefined>;
}): CompetitorAnalyticsQuery | { error: string } {
  const now = Date.now();
  const defaultFrom = now - 30 * 24 * 60 * 60 * 1000;

  const rawFrom = req.query.from;
  const rawTo = req.query.to;
  const fromStr = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  const toStr = Array.isArray(rawTo) ? rawTo[0] : rawTo;

  const fromMs = fromStr ? Date.parse(fromStr) : defaultFrom;
  const toMs = toStr ? Date.parse(toStr) : now;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { error: "Invalid from/to date" };
  }
  if (fromMs > toMs) {
    return { error: "from must be before to" };
  }

  const rawBucket = req.query.bucket;
  const b = Array.isArray(rawBucket) ? rawBucket[0] : rawBucket;
  const bucket: AnalyticsBucket = b === "hour" || b === "week" || b === "day" ? b : "day";

  const rawEx = req.query.excludeNotices;
  const exStr = Array.isArray(rawEx) ? rawEx[0] : rawEx;
  const excludeNotices = exStr === "1" || exStr === "true";

  const rawAuthors = req.query.authors;
  const aStr = Array.isArray(rawAuthors) ? rawAuthors[0] : rawAuthors;
  const authorFilter =
    aStr && aStr.trim().length > 0
      ? aStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

  return { fromMs, toMs, bucket, excludeNotices, authorFilter };
}
