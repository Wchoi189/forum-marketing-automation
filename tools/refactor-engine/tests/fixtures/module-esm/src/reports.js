import { pad } from './util/format.js';

// ─── Palette ─────────────────────────────────────────────────────────────────
export const BG = { ok: 'green', warn: 'amber' };

function colIndexToLetter(index) {
    return String.fromCharCode(65 + index);
}

// ─── Rule builders ───────────────────────────────────────────────────────────
export function buildTextRule(column, value) {
    return { column: colIndexToLetter(column), value, bg: BG[value] };
}

// ─── Formatting ──────────────────────────────────────────────────────────────
export function formatAll(rows) {
    return rows.map((row) => formatRow(row));
}

function formatRow(row) {
    return pad(row.label, 6) + ' ' + buildTextRule(row.column, row.state).bg;
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export function createReport(rows) {
    return { lines: formatAll(rows) };
}

export default function render(rows) {
    return createReport(rows).lines.join('\n');
}

export { colIndexToLetter as letter };
