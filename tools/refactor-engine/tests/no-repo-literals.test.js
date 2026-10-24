'use strict';

// Portability: nothing in the toolkit names the repository it was built in, or the files it was first used on.
// The patterns are assembled from fragments so that this file does not match itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOOLKIT = path.resolve(__dirname, '..');
const EXCLUDED = new Set(['node_modules'].map((name) => path.join(TOOLKIT, name)));
const FORBIDDEN = [
    ['subscr', 'iption'],
    ['share', 'plan'],
    ['30', '01'],
    ['apps', '/', 'server'],
    ['ledger', 'Service'],
    ['purchase', 'Service'],
    ['google', 'Sheets'],
].map((parts) => parts.join(''));
const PATTERN = new RegExp(FORBIDDEN.join('|'), 'i');

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (EXCLUDED.has(full)) continue;
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full;
    }
}

test('toolkit contains no repository-specific literal', () => {
    const hits = [];
    let files = 0;
    for (const file of walk(TOOLKIT)) {
        files += 1;
        const relative = path.relative(TOOLKIT, file);
        if (PATTERN.test(relative)) hits.push(`${relative} (path)`);
        if (relative === 'package-lock.json') continue; // registry metadata, not toolkit code
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
            const match = line.match(PATTERN);
            if (match) hits.push(`${relative}:${index + 1} "${match[0]}"`);
        });
    }
    assert.ok(files > 0, 'walked no files');
    assert.deepEqual(hits, []);
});

test('the pattern catches each literal, case-insensitively', () => {
    for (const literal of FORBIDDEN) {
        assert.match(`x ${literal.toUpperCase()} x`, PATTERN);
    }
});
