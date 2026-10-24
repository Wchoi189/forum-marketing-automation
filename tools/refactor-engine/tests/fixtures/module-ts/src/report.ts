// ─── Types ───────────────────────────────────────────────────────────────────
export interface Row {
    label: string;
    state: Level;
    column: number;
}

export type Level = 'ok' | 'warn';

// ─── Palette ─────────────────────────────────────────────────────────────────
export const BG: Record<Level, string> = { ok: 'green', warn: 'amber' };

function colIndexToLetter(index: number): string {
    return String.fromCharCode(65 + index);
}

// ─── Rule builders ───────────────────────────────────────────────────────────
export function buildTextRule(column: number, value: Level): { column: string; bg: string } {
    return { column: colIndexToLetter(column), bg: BG[value] };
}

// ─── Formatting ──────────────────────────────────────────────────────────────
export function formatAll(rows: Row[]): string[] {
    return rows.map((row) => formatRow(row));
}

function formatRow(row: Row): string {
    return `${row.label} ${buildTextRule(row.column, row.state).bg}`;
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export function createReport(rows: Row[]): { lines: string[] } {
    return { lines: formatAll(rows) };
}
