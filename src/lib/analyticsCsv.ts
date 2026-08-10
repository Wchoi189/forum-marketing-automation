import type { AuthorSummaryRow } from '../../lib/analytics/index';

function csvQuote(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(rows: AuthorSummaryRow[], from: string, to: string): { csv: string; filename: string } {
  const headers = ['Rank', 'Author', 'Posts', 'Active Days', 'Posts/Active Day', 'Avg Views/Post', 'Avg Views Count'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([r.rank, r.author, r.postsInRange, r.activeDays, r.postsPerActiveDay, r.avgViewsPerPost, r.avgViewsPostCount].map(csvQuote).join(','));
  }
  return { csv: lines.join('\n'), filename: `competitors-${from}-${to}.csv` };
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
