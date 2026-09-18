'use strict';

// Behaviour and export surface before and after the split, plus the call-time spy semantics (research R17):
// a replacement installed on the module object is seen by a consumer that reads the property at call time,
// and not by an internal call that goes through the module's own binding.

const assert = require('node:assert/strict');
const path = require('node:path');
const reports = require('../src/reports');
const consumer = require('./consumer');

const rows = [{ label: 'a', state: 'ok', column: 0 }, { label: 'b', state: 'warn', column: 1 }];

assert.deepEqual(Object.keys(reports), [
    'tokenPath', 'getAuthClient', 'getSheetsClient', 'getDriveClient', 'colIndexToLetter', 'buildTextRule',
    'buildRangeRule', 'formatAll', 'applyBanding', 'createReport', 'createColored', 'exportArchive',
]);
assert.equal(reports.tokenPath, path.join(__dirname, '..', 'src', 'token.json'), 'tokenPath resolves from the source directory');
assert.deepEqual(reports.getSheetsClient(), { kind: 'sheets', auth: { token: reports.tokenPath } });
assert.equal(reports.colIndexToLetter(2), 'C');
assert.deepEqual(reports.buildTextRule(1, 'warn'), { column: 'B', value: 'warn', bg: 'amber', fg: 'white' });
assert.deepEqual(reports.formatAll(rows), ['     a green', '     b amber']);
assert.deepEqual(reports.applyBanding(rows).map((r) => r.band), [0, 1]);
assert.deepEqual(reports.createReport(rows).lines, ['     a green', '     b amber']);
assert.deepEqual(reports.exportArchive(rows), { client: reports.getDriveClient(), rules: [{ column: 'A', min: 1, max: 9 }], count: 2 });

const original = reports.formatAll;
reports.formatAll = () => ['SPY'];
try {
    assert.deepEqual(consumer.render(rows), ['SPY'], 'a call-time reader sees the replacement');
    assert.deepEqual(reports.createColored(rows).lines, ['     a green', '     b amber'], 'an internal call does not');
} finally {
    reports.formatAll = original;
}
assert.deepEqual(consumer.render(rows), ['     a green', '     b amber']);
console.log('spy.check: ok');
