'use strict';

// The codemod catalog on a copy of tests/fixtures/codemod-catalog/: `codemod list`, audit's fix hints, `codemod new`
// and postconditions. Exit codes are read from the child's own status.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { copyFixture, engine, treeHash, expectExit } = require('./support');

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const write = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
};

test('codemod list shows every catalog entry with its reach, and nothing outside the globs', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const result = engine(root, 'codemod', 'list', '--json');
    expectExit(result, 0, ['rename-call  catalog/rename-call', 'ratchet old-call: 2 match(es)', 'codemod list: 2 codemod(s), 0 invalid']);
    assert.deepEqual(result.json.codemods.map((c) => c.id), ['rename-call', 'rename-call-strict']);
    const [rename, strict] = result.json.codemods;
    // src/app.js holds the call and the string literal (the regex counts both); src/legacy/ is excluded by the codemod.
    assert.equal(rename.ratchetMatches, 2);
    assert.equal(rename.fixtures, 2);
    assert.equal(strict.ratchet, null);
    assert.equal(strict.ratchetMatches, null);
    assert.equal(strict.postconditions, 1);
    assert.deepEqual(result.json.invalid, []);
});

test('an invalid catalog entry is listed as invalid and list exits 4', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    write(root, 'catalog/broken/codemod.json', '{ "$schema": "refactor-engine/codemod/1" }\n');
    const result = engine(root, 'codemod', 'list', '--json');
    expectExit(result, 4, ['INVALID catalog/broken', 'missing required key id']);
    assert.equal(result.json.codemods.length, 2);
});

test('a duplicate id and an unknown ratchet are invalid entries', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    write(root, 'catalog/zz-duplicate/codemod.json', read(root, 'catalog/rename-call/codemod.json'));
    write(root, 'catalog/zz-unknown/codemod.json', read(root, 'catalog/rename-call/codemod.json').replace('"rename-call"', '"zz-unknown"').replace('"old-call"', '"no-such-rule"'));
    const result = engine(root, 'codemod', 'list', '--json');
    expectExit(result, 4);
    assert.deepEqual(result.json.invalid.map((i) => i.dir), ['catalog/zz-duplicate', 'catalog/zz-unknown']);
    assert.match(result.json.invalid[0].error, /is also catalog\/rename-call/);
    assert.match(result.json.invalid[1].error, /"no-such-rule" is not a pattern/);
});

test('audit names the codemod that burns a pattern finding, only on paths the codemod selects', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const result = engine(root, 'audit', '--json');
    expectExit(result, 2, ['RAT-003 src/app.js', 'rewrite: refactor-engine codemod run catalog/rename-call src/app.js']);
    const byPath = Object.fromEntries(result.json.findings.map((f) => [f.path, f]));
    assert.deepEqual(byPath['src/app.js'].codemods, [
        { id: 'rename-call', dir: 'catalog/rename-call', command: 'refactor-engine codemod run catalog/rename-call src/app.js' },
    ]);
    assert.equal(byPath['src/legacy/old.js'].codemods, undefined, 'a hint for a path the codemod excludes');
});

test('audit warns on a broken catalog entry and still reports, never blocks on it alone', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    write(root, 'catalog/broken/codemod.json', '{\n');
    const result = engine(root, 'audit', '--json');
    expectExit(result, 2, ['WARN CM-CATALOG catalog/broken', 'rewrite: refactor-engine codemod run catalog/rename-call src/app.js']);
    // With the findings gone the broken entry is never read: a clean tree is not blocked by a codemod typo.
    write(root, 'src/app.js', 'module.exports = () => 1;\n');
    fs.rmSync(path.join(root, 'src/legacy'), { recursive: true });
    expectExit(engine(root, 'audit'), 0, '0 findings');
});

test('audit without a codemods key behaves as before', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const config = JSON.parse(read(root, 'config.json'));
    delete config.codemods;
    write(root, 'config.json', JSON.stringify(config));
    const result = engine(root, 'audit', '--json');
    expectExit(result, 2);
    assert.ok(result.json.findings.every((f) => f.codemods === undefined));
    assert.doesNotMatch(result.stderr, /rewrite:/);
});

test('codemod new scaffolds a codemod that loads only once its reason is written', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const created = engine(root, 'codemod', 'new', 'catalog/my-fix', '--ratchet', 'old-call', '--json');
    expectExit(created, 0, ['created catalog/my-fix/codemod.json', 'next: write "why"']);
    assert.equal(created.json.inCatalog, true);
    const meta = JSON.parse(read(root, 'catalog/my-fix/codemod.json'));
    assert.equal(meta.id, 'my-fix');
    assert.equal(meta.ratchet, 'old-call');
    assert.deepEqual(meta.include, ['src/**/*.js']);
    expectExit(engine(root, 'codemod', 'test', 'catalog/my-fix'), 4, 'why must be a non-empty string');
    write(root, 'catalog/my-fix/codemod.json', JSON.stringify({ ...meta, why: 'fixture: a reason' }));
    expectExit(engine(root, 'codemod', 'test', 'catalog/my-fix'), 0, 'codemod test: 2 fixtures, 0 failed');
});

test('codemod new refuses an existing directory, a bad name and an unknown ratchet; notes a directory outside the catalog', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const before = treeHash(root);
    expectExit(engine(root, 'codemod', 'new', 'catalog/rename-call'), 4, 'already exists');
    expectExit(engine(root, 'codemod', 'new', 'catalog/Not_Kebab'), 4, 'must be kebab-case');
    expectExit(engine(root, 'codemod', 'new', 'catalog/x', '--ratchet', 'nope'), 4, '--ratchet nope is not a pattern in the host config (old-call)');
    expectExit(engine(root, 'codemod', 'new', 'catalog/x', '--write'), 4, 'codemod new takes only --ratchet');
    expectExit(engine(root, 'codemod', 'list', 'extra'), 4, 'unexpected argument extra');
    expectExit(engine(root, 'codemod', 'run', 'catalog/rename-call', '--ratchet', 'old-call'), 4, '--ratchet applies only to codemod new');
    assert.equal(treeHash(root), before);
    expectExit(engine(root, 'codemod', 'new', 'elsewhere/stray'), 0, 'is not matched by the host config\'s "codemods" globs');
});

test('a postcondition residual blocks --write and exits 2, with every hit reported', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const before = treeHash(root);
    const result = engine(root, 'codemod', 'run', 'catalog/rename-call-strict', '--write', '--json');
    expectExit(result, 2, ['POSTCONDITION absent /\\boldCall\\b/: 1 residual(s)', "src/app.js:5  return 'oldCall(';", 'postconditions failed — nothing was written']);
    assert.deepEqual(result.json.written, []);
    assert.doesNotMatch(result.stderr, /wrote src\/app\.js|1 written/, 'a blocked write reported as written');
    assert.match(result.stderr, /would change src\/app\.js/);
    assert.deepEqual(result.json.postconditions[0].hits, [{ path: 'src/app.js', line: 5, text: "return 'oldCall(';" }]);
    assert.equal(treeHash(root), before);
});

test('a postcondition that holds lets --write proceed and is counted in the receipt', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    write(root, 'src/app.js', read(root, 'src/app.js').replace("return 'oldCall(';", 'return null;'));
    const result = engine(root, 'codemod', 'run', 'catalog/rename-call-strict', '--write', '--receipt', 'r.json', '--json');
    expectExit(result, 0, 'wrote src/app.js');
    assert.match(read(root, 'src/app.js'), /newCall\(item\);/);
    assert.deepEqual(JSON.parse(read(root, 'r.json')).postconditions, [{ absent: '\\boldCall\\b', hits: 0 }]);
});

test('an invalid postcondition is a usage error', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    const meta = JSON.parse(read(root, 'catalog/rename-call-strict/codemod.json'));
    meta.postconditions[0].absent = '(';
    write(root, 'catalog/rename-call-strict/codemod.json', JSON.stringify(meta));
    expectExit(engine(root, 'codemod', 'run', 'catalog/rename-call-strict'), 4, 'postconditions[0].absent does not compile');
});

test('codemod test with no directory tests the whole catalog, and refuses an invalid or empty one', () => {
    const root = copyFixture('codemod-catalog', { git: true });
    expectExit(engine(root, 'codemod', 'test'), 0, ['ok   rename-call/call (positive)', 'ok   rename-call-strict/lookalikes (negative)', 'codemod test: 4 fixtures, 0 failed']);
    write(root, 'catalog/broken/codemod.json', '{\n');
    expectExit(engine(root, 'codemod', 'test'), 4, ['invalid catalog entries', 'catalog/broken']);
    const config = JSON.parse(read(root, 'config.json'));
    delete config.codemods;
    write(root, 'config.json', JSON.stringify(config));
    expectExit(engine(root, 'codemod', 'test'), 4, 'catalog is empty');
});
