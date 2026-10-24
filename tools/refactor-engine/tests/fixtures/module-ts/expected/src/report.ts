// >>> refactor-engine:parts BEGIN — generated; do not edit
import type { Row } from './parts/types';
export type { Row, Level } from './parts/types';
export { BG } from './parts/palette';
export { buildTextRule } from './parts/builders';
import { formatAll } from './parts/formatting';
export { formatAll } from './parts/formatting';
// <<< refactor-engine:parts END

// ─── Reports ─────────────────────────────────────────────────────────────────
export function createReport(rows: Row[]): { lines: string[] } {
    return { lines: formatAll(rows) };
}
