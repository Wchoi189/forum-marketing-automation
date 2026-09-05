import type { AuthorSummaryRow } from '../../lib/analytics/index';

export function formatGap(hours: number | null): string {
  if (hours === null) return 'n/a';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

export function formatPostsPerActiveDay(row: AuthorSummaryRow): string {
  const v = row.postsPerActiveDay;
  const display = v.toFixed(1);
  if (row.activeDays >= 7) {
    const weekly = Math.round(v * 7);
    return `${display}/day · ~${weekly}/wk`;
  }
  return `${display}/day`;
}
