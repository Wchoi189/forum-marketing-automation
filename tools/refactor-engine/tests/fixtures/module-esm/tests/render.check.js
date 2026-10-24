// Behaviour and export surface before and after the split; the default export stays in the facade verbatim.

import assert from 'node:assert/strict';
import render, * as reports from '../src/reports.js';

const rows = [{ label: 'a', state: 'ok', column: 0 }, { label: 'b', state: 'warn', column: 1 }];

assert.deepEqual(Object.keys(reports), ['BG', 'buildTextRule', 'createReport', 'default', 'formatAll', 'letter']);
assert.equal(reports.default, render);
assert.equal(reports.letter(2), 'C');
assert.deepEqual(reports.buildTextRule(1, 'warn'), { column: 'B', value: 'warn', bg: 'amber' });
assert.deepEqual(reports.formatAll(rows), ['     a green', '     b amber']);
assert.deepEqual(reports.createReport(rows), { lines: ['     a green', '     b amber'] });
assert.equal(render(rows), '     a green\n     b amber');
console.log('render.check: ok');
