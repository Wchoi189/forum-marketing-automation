'use strict';

// `baseline --init | --write | --raise` on a copy of tests/fixtures/ratchet/ (no git needed: the copy is not a
// repository, so the toolkit walks the directory). --write only lowers; --init only creates; --raise needs a reason.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLKIT = path.resolve(__dirname, '..');
const BIN = path.join(TOOLKIT, 'bin', 'refactor-engine.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'ratchet');

function withCopy(fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-engine-baseline-'));
    fs.cpSync(FIXTURE, root, { recursive: true });
    try {
        return fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function engine(root, ...args) {
    return spawnSync(process.execPath, [BIN, ...args, '--root', root, '-c', 'config.json'], { cwd: TOOLKIT, encoding: 'utf8' });
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const write = (root, rel, text) => fs.writeFileSync(path.join(root, rel), text);
const baselineOf = (root) => JSON.parse(read(root, 'baseline.json'));

function expectExit(result, status, ...stderrIncludes) {
    assert.equal(result.status, status, `expected exit ${status}, got ${result.status}\n${result.stderr}`);
    for (const needle of stderrIncludes) {
        assert.ok(result.stderr.includes(needle), `stderr lacks "${needle}":\n${result.stderr}`);
    }
}

test('--write lowers a shrunken file, removes a deleted path, and leaves a risen value untouched and unmentioned', () =>
    withCopy((root) => {
        write(root, 'src/big.js', read(root, 'src/big.js').replace('const big56 = 56;\nconst big57 = 57;\n', ''));
        fs.rmSync(path.join(root, 'src/sql.js'));
        fs.appendFileSync(path.join(root, 'src/loop.js'), "\nfunction touch(db, items) {\n    items.forEach((i) => db.prepare('SELECT 1').get(i));\n}\n");
        const result = engine(root, 'baseline', '--write');
        expectExit(result, 0, 'baseline: src/big.js  lines 60 → 58', 'baseline: removed src/sql.js');
        assert.ok(!result.stderr.includes('src/loop.js'), `a risen value must print nothing:\n${result.stderr}`);
        const files = baselineOf(root).files;
        assert.equal(files['src/big.js'].lines, 58);
        assert.equal('src/sql.js' in files, false);
        assert.equal(files['src/loop.js'].patterns['prepare-in-loop'], 1, 'never raised by --write');
        assert.equal(files['src/loop.js'].reason, 'baseline 2026-09-15', 'reason preserved');
    }));

test('--write never adds an entry: a new oversized file stays RAT-002 business', () =>
    withCopy((root) => {
        write(root, 'src/huge.js', Array.from({ length: 45 }, (_, i) => `const h${i} = ${i};`).join('\n') + '\n');
        expectExit(engine(root, 'baseline', '--write'), 0, 'baseline: nothing to lower');
        assert.equal('src/huge.js' in baselineOf(root).files, false);
        expectExit(engine(root, 'audit'), 2, 'RAT-002 src/huge.js');
    }));

test('--write removes an entry lowered within every limit', () =>
    withCopy((root) => {
        write(root, 'src/sql.js', "'use strict';\n\nmodule.exports = {};\n");
        expectExit(engine(root, 'baseline', '--write'), 0, 'coalesce-param 2 → 0', 'removed src/sql.js (within every limit)');
        assert.equal('src/sql.js' in baselineOf(root).files, false);
    }));

test('--raise with an empty reason exits 4 and writes nothing', () =>
    withCopy((root) => {
        const before = read(root, 'baseline.json');
        expectExit(engine(root, 'baseline', '--raise', 'src/big.js', '--reason', ''), 4, 'non-empty --reason');
        assert.equal(read(root, 'baseline.json'), before);
    }));

test('--raise writes the measured values and the reason', () =>
    withCopy((root) => {
        fs.appendFileSync(path.join(root, 'src/big.js'), "const q = 'COALESCE(?, x)';\n");
        expectExit(engine(root, 'baseline', '--raise', 'src/big.js', '--reason', 'fixture: raised on purpose'), 0, 'baseline: src/big.js  lines 61, coalesce-param 1  reason: fixture: raised on purpose');
        const entry = baselineOf(root).files['src/big.js'];
        assert.deepEqual(entry, { lines: 61, maxFunction: null, patterns: { 'coalesce-param': 1 }, reason: 'fixture: raised on purpose' });
        expectExit(engine(root, 'audit'), 0, '0 findings');
    }));

test('--raise refuses a path outside the scope or missing', () =>
    withCopy((root) => {
        expectExit(engine(root, 'baseline', '--raise', 'config.json', '--reason', 'x'), 4, 'not in scope');
        expectExit(engine(root, 'baseline', '--raise', 'src/nope.js', '--reason', 'x'), 4, 'does not exist');
    }));

test('output keys are sorted and a second --write is byte-identical', () =>
    withCopy((root) => {
        expectExit(engine(root, 'baseline', '--write'), 0);
        const first = read(root, 'baseline.json');
        expectExit(engine(root, 'baseline', '--write'), 0);
        assert.equal(read(root, 'baseline.json'), first);
        const parsed = JSON.parse(first);
        assert.deepEqual(Object.keys(parsed), ['$schema', 'files', 'limits']);
        assert.deepEqual(Object.keys(parsed.files), [...Object.keys(parsed.files)].sort());
        for (const entry of Object.values(parsed.files)) assert.deepEqual(Object.keys(entry), ['lines', 'maxFunction', 'patterns', 'reason']);
        assert.ok(first.endsWith('}\n'));
    }));

test('--init refuses when the baseline already exists, exit 4', () =>
    withCopy((root) => {
        const before = read(root, 'baseline.json');
        expectExit(engine(root, 'baseline', '--init'), 4, 'already exists');
        assert.equal(read(root, 'baseline.json'), before);
    }));

test('--init writes every file above a limit or with a pattern match, dated, and nothing else', () =>
    withCopy((root) => {
        fs.rmSync(path.join(root, 'baseline.json'));
        expectExit(engine(root, 'baseline', '--init'), 0, 'baseline: wrote 4 entries to baseline.json (baseline ');
        const files = baselineOf(root).files;
        assert.deepEqual(Object.keys(files), ['src/big.js', 'src/fn.js', 'src/loop.js', 'src/sql.js'], 'small.js is within every limit');
        for (const entry of Object.values(files)) assert.match(entry.reason, /^baseline \d{4}-\d{2}-\d{2}$/);
        assert.equal(files['src/fn.js'].maxFunction.lines, 15);
        assert.equal(files['src/sql.js'].patterns['coalesce-param'], 2);
        assert.equal(read(root, 'baseline.json'), fs.readFileSync(path.join(FIXTURE, 'baseline.json'), 'utf8').replace(/baseline \d{4}-\d{2}-\d{2}/g, files['src/big.js'].reason));
    }));
