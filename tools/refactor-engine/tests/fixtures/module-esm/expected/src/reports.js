// >>> refactor-engine:parts BEGIN — generated; do not edit
import { colIndexToLetter } from './parts/palette.js';
export { BG } from './parts/palette.js';
export { buildTextRule } from './parts/builders.js';
export { formatAll } from './parts/formatting.js';
import { createReport } from './parts/reports.js';
export { createReport } from './parts/reports.js';
// <<< refactor-engine:parts END

export default function render(rows) {
    return createReport(rows).lines.join('\n');
}

export { colIndexToLetter as letter };
