'use strict';

// RAT-001 … RAT-005 (data-model.md §5) on a git copy of tests/fixtures/ratchet/. Every case runs on its own
// `fs.cpSync` copy with `git init` and one commit, so the fixture on disk is never touched. Exit codes are read
// from the child's own status, never through a pipe.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLKIT = path.resolve(__dirname, '..');
const BIN = path.join(TOOLKIT, 'bin', 'refactor-engine.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'ratchet');
const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function git(root, ...args) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: GIT_ENV });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
    return result.stdout;
}

// A throwaway git repository holding the fixture, committed once.
function makeRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-engine-ratchet-'));
    fs.cpSync(FIXTURE, root, { recursive: true });
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fixture');
    return root;
}

function withRepo(fn) {
    const root = makeRepo();
    try {
        return fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function engine(root, ...args) {
    return spawnSync(process.execPath, [BIN, ...args, '--root', root, '-c', 'config.json'], { cwd: TOOLKIT, encoding: 'utf8', env: GIT_ENV });
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const write = (root, rel, text) => fs.writeFileSync(path.join(root, rel), text);
const append = (root, rel, text) => fs.appendFileSync(path.join(root, rel), text);

function expectExit(result, status, ...stderrIncludes) {
    assert.equal(result.status, status, `expected exit ${status}, got ${result.status}\n${result.stderr}`);
    for (const needle of stderrIncludes) {
        assert.ok(result.stderr.includes(needle), `stderr lacks "${needle}":\n${result.stderr}`);
    }
}

const lines = (n, prefix) => Array.from({ length: n }, (_, i) => `const ${prefix}${i + 1} = ${i + 1};`).join('\n') + '\n';

test('the committed fixture audits clean', () =>
    withRepo((root) => {
        expectExit(engine(root, 'audit'), 0, 'audit: 5 files, 0 findings, 0 warnings');
    }));

test('RAT-001: a grandfathered file that grows by one line is blocked, naming the numbers', () =>
    withRepo((root) => {
        append(root, 'src/big.js', 'const extra = 1;\n');
        const result = engine(root, 'audit');
        expectExit(result, 2, 'RAT-001 src/big.js  lines 60 → 61 (ceiling 40, baseline 60)', 'baseline --raise src/big.js --reason');
    }));

test('a grandfathered file that shrinks passes', () =>
    withRepo((root) => {
        write(root, 'src/big.js', read(root, 'src/big.js').replace('const big57 = 57;\n', ''));
        expectExit(engine(root, 'audit'), 0, '0 findings');
    }));

test('RAT-002: a new file over the ceiling is blocked; one at the ceiling passes', () =>
    withRepo((root) => {
        write(root, 'src/forty.js', lines(40, 'f'));
        expectExit(engine(root, 'audit'), 0, '6 files, 0 findings');
        write(root, 'src/fortyone.js', lines(41, 'g'));
        expectExit(engine(root, 'audit'), 2, 'RAT-002 src/fortyone.js  lines 0 → 41 (ceiling 40, not in baseline)');
    }));

test('RAT-003 regex: a third COALESCE(? in a baselined file, or one in a new file, is blocked', () =>
    withRepo((root) => {
        append(root, 'src/sql.js', "const UPDATE_TAG = 'UPDATE t SET tag = COALESCE(?, tag)';\n");
        expectExit(engine(root, 'audit'), 2, 'RAT-003 src/sql.js  coalesce-param 2 → 3 (baseline 2)');
        git(root, 'checkout', '--', 'src/sql.js');
        write(root, 'src/fresh.js', "const q = 'COALESCE(?, x)';\n");
        expectExit(engine(root, 'audit'), 2, 'RAT-003 src/fresh.js  coalesce-param 0 → 1 (not in baseline)');
    }));

test('RAT-003 ast-grep: a second db.prepare inside items.forEach((i) => …) is blocked', () =>
    withRepo((root) => {
        append(root, 'src/loop.js', "\nfunction touch(db, items) {\n    items.forEach((i) => db.prepare('SELECT 1').get(i));\n}\n");
        expectExit(engine(root, 'audit'), 2, 'RAT-003 src/loop.js  prepare-in-loop 1 → 2 (baseline 1)');
    }));

test('RAT-003 ast-grep negative cases count 0: each in a new file passes', () =>
    withRepo((root) => {
        const negatives = {
            'src/neg-map-receiver.js': "function names(db) {\n    return db.prepare('SELECT name FROM t').all().map((r) => r.name);\n}\n",
            'src/neg-run-in-transaction.js':
                "function insertAll(db, items) {\n    const insertStmt = db.prepare('INSERT INTO t VALUES (?)');\n    db.transaction(() => {\n        for (const item of items) insertStmt.run(item);\n    })();\n}\n",
            'src/neg-run-not-statement.js': 'function runChecks(db, checks) {\n    for (const check of checks) check.run(db);\n}\n',
        };
        for (const [rel, text] of Object.entries(negatives)) {
            write(root, rel, text);
            expectExit(engine(root, 'audit', rel), 0, '1 files, 0 findings');
            fs.rmSync(path.join(root, rel));
        }
        // The positive counterpart of the transaction case, so the negative is not vacuous.
        write(root, 'src/pos-run.js', "function insertAll(db, items) {\n    const insertStmt = db.prepare('INSERT INTO t VALUES (?)');\n    for (const item of items) insertStmt.run(item);\n}\n");
        expectExit(engine(root, 'audit', 'src/pos-run.js'), 2, 'RAT-003 src/pos-run.js  run-outside-transaction 0 → 1');
    }));

test('RAT-004: a grandfathered function that grows 15 → 16 is blocked; a new 9-line function passes', () =>
    withRepo((root) => {
        write(root, 'src/fn.js', read(root, 'src/fn.js').replace('    return total;\n', '    total += 12;\n    return total;\n'));
        expectExit(engine(root, 'audit'), 2, 'RAT-004 src/fn.js  maxFunction 15 → 16 (ceiling 10, baseline 15)  fifteen:3');
        git(root, 'checkout', '--', 'src/fn.js');
        write(root, 'src/nine.js', 'function nine(a) {\n    let t = a;\n    t += 1;\n    t += 2;\n    t += 3;\n    t += 4;\n    t += 5;\n    return t;\n}\n');
        expectExit(engine(root, 'audit'), 0, '6 files, 0 findings');
        write(root, 'src/eleven.js', 'function eleven(a) {\n    let t = a;\n    t += 1;\n    t += 2;\n    t += 3;\n    t += 4;\n    t += 5;\n    t += 6;\n    t += 7;\n    return t;\n}\n');
        expectExit(engine(root, 'audit'), 2, 'RAT-004 src/eleven.js  maxFunction 0 → 11 (ceiling 10, not in baseline)');
    }));

test('RAT-005: a deleted baselined path is a WARN in a full run only, exit 0', () =>
    withRepo((root) => {
        fs.rmSync(path.join(root, 'src/sql.js'));
        const full = engine(root, 'audit');
        expectExit(full, 0, 'WARN RAT-005 src/sql.js', '4 files, 0 findings, 1 warnings');
        const partial = engine(root, 'audit', 'src/big.js');
        expectExit(partial, 0, '1 files, 0 findings, 0 warnings');
        assert.ok(!partial.stderr.includes('RAT-005'), partial.stderr);
    }));

test('RAT-005: a baseline value above the measured one is a WARN, never a block', () =>
    withRepo((root) => {
        write(root, 'src/big.js', read(root, 'src/big.js').replace('const big57 = 57;\n', ''));
        expectExit(engine(root, 'audit'), 0, 'WARN RAT-005 src/big.js  baseline above measured (lines 60 > 59)');
    }));

test('--json emits files, findings, warnings and elapsedMs on stdout', () =>
    withRepo((root) => {
        append(root, 'src/big.js', 'const extra = 1;\n');
        const result = engine(root, 'audit', '--json');
        assert.equal(result.status, 2);
        const body = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(body).sort(), ['elapsedMs', 'files', 'findings', 'warnings']);
        assert.equal(body.files, 5);
        assert.equal(body.findings.length, 1);
        assert.equal(body.findings[0].rule, 'RAT-001');
        assert.equal(body.findings[0].to, 61);
    }));

// ── --staged: the index is the only thing judged (read-this-first #8) ──────────────────────────────────────

test('--staged (a): the worktree grows big.js but the staged blob does not → exit 0', () =>
    withRepo((root) => {
        write(root, 'src/big.js', read(root, 'src/big.js').replace('const big1 = 1;', 'const big1 = 100;'));
        git(root, 'add', 'src/big.js');
        append(root, 'src/big.js', 'const extra = 1;\n');
        expectExit(engine(root, 'audit'), 2, 'RAT-001 src/big.js');
        expectExit(engine(root, 'audit', '--staged'), 0, '1 files, 0 findings');
    }));

test('--staged (b): the staged blob grows → exit 2', () =>
    withRepo((root) => {
        append(root, 'src/big.js', 'const extra = 1;\n');
        git(root, 'add', 'src/big.js');
        expectExit(engine(root, 'audit', '--staged'), 2, 'RAT-001 src/big.js  lines 60 → 61');
    }));

test('--staged (c): a growth staged together with a baseline raise for it → exit 0', () =>
    withRepo((root) => {
        append(root, 'src/big.js', 'const extra = 1;\n');
        expectExit(engine(root, 'baseline', '--raise', 'src/big.js', '--reason', 'fixture: one line more'), 0);
        git(root, 'add', 'src/big.js', 'baseline.json');
        expectExit(engine(root, 'audit', '--staged'), 0, '1 files, 0 findings');
        // The raise is read from the INDEX: put the committed baseline back in the worktree (index untouched) and
        // --staged still passes, while a worktree audit of the same bytes is blocked.
        write(root, 'baseline.json', git(root, 'show', 'HEAD:baseline.json'));
        assert.equal(JSON.parse(read(root, 'baseline.json')).files['src/big.js'].lines, 60);
        expectExit(engine(root, 'audit', '--staged'), 0, '1 files, 0 findings');
        expectExit(engine(root, 'audit'), 2, 'RAT-001 src/big.js  lines 60 → 61');
    }));

test('--staged (d): a staged deletion produces no finding', () =>
    withRepo((root) => {
        git(root, 'rm', '-q', 'src/sql.js');
        expectExit(engine(root, 'audit', '--staged'), 0, '0 files, 0 findings, 0 warnings');
    }));
