'use strict';

// `codemod test` and `codemod run` on a git copy of tests/fixtures/codemod/: the fixture harness, the dry run, the
// patch, --write with its receipt, --check, the refusals, --staged, the ratchet prediction, and the hermetic engine.
// Exit codes are read from the child's own status.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { copyFixture, engine, treeHash, expectExit } = require('./support');

const git = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('codemod test passes a codemod whose fixtures hold', () => {
    const root = copyFixture('codemod');
    expectExit(engine(root, 'codemod', 'test', 'codemods/rename-call', 'codemods/insert-marker', 'codemods/breaks-syntax'), 0, 'codemod test: 7 fixtures, 0 failed');
});

test('codemod test fails with the diff when an expected file does not match', () => {
    const root = copyFixture('codemod');
    const result = engine(root, 'codemod', 'test', 'codemods/wrong-expected');
    expectExit(result, 2, ['FAIL wrong-expected/call (positive)', '-somethingElse(1);', '+newCall(1);']);
});

test('a codemod without a negative fixture is a usage error', () => {
    const root = copyFixture('codemod');
    expectExit(engine(root, 'codemod', 'test', 'codemods/no-negative'), 4, 'needs at least one negative fixture');
});

test('a pattern without a language line is a usage error', () => {
    const root = copyFixture('codemod');
    expectExit(engine(root, 'codemod', 'test', 'codemods/no-language'), 4, 'must declare its grammar on a "language" line');
});

test('codemod usage errors exit 4', () => {
    const root = copyFixture('codemod');
    expectExit(engine(root, 'codemod', 'frob', 'codemods/rename-call'), 4, 'codemod takes run, test, list or new');
    expectExit(engine(root, 'codemod', 'run'), 4, 'codemod run requires <codemod-dir>');
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--receipt', 'r.json'), 4, '--receipt applies only with --write');
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--write', '--check'), 4, 'not both');
    expectExit(engine(root, 'codemod', 'test', 'codemods/rename-call', '--write'), 4, 'codemod test takes no options');
});

test('run is a dry run by default: nothing is written, the patch applies, ratchet counts are reported', () => {
    const root = copyFixture('codemod', { git: true });
    const before = treeHash(root);
    // The regex rule counts the string literal too, and the codemod rightly leaves the string alone: 2 → 1.
    const result = engine(root, 'codemod', 'run', 'codemods/rename-call', '--patch', 'out.patch', '--json');
    expectExit(result, 0, ['would change src/app.js', 'old-call 2 → 1', 'review: fixture review note']);
    assert.equal(result.json.files.length, 1);
    assert.deepEqual(result.json.ratchet, { id: 'old-call', before: 2, after: 1 });
    assert.deepEqual(result.json.written, []);
    const patch = read(root, 'out.patch');
    fs.rmSync(path.join(root, 'out.patch'));
    assert.equal(treeHash(root), before, 'a dry run changed the tree');
    fs.writeFileSync(path.join(root, '..', `${path.basename(root)}.patch`), patch);
    const apply = git(root, 'apply', path.join(root, '..', `${path.basename(root)}.patch`));
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(read(root, 'src/app.js'), /newCall\(item\);/);
    assert.match(read(root, 'src/app.js'), /return 'oldCall\(';/, 'a string literal was rewritten');
});

test('--check exits 2 while a rewrite is pending and 0 once it is applied', () => {
    const root = copyFixture('codemod', { git: true });
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--check'), 2);
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--write'), 0, 'wrote src/app.js');
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--check'), 0, '0 would change');
});

test('--write writes the files and a receipt of before/after hashes', () => {
    const root = copyFixture('codemod', { git: true });
    const original = read(root, 'src/app.js');
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--write', '--receipt', 'receipt.json'), 0);
    const receipt = JSON.parse(read(root, 'receipt.json'));
    assert.equal(receipt.$schema, 'refactor-engine/codemod-receipt/1');
    assert.equal(receipt.codemod, 'rename-call');
    assert.match(receipt.engine, /^@getgrit\/gritql@\d/);
    assert.equal(receipt.files.length, 1);
    const sha = (text) => 'sha256:' + require('node:crypto').createHash('sha256').update(text).digest('hex');
    assert.equal(receipt.files[0].before, sha(original));
    assert.equal(receipt.files[0].after, sha(read(root, 'src/app.js')));
});

test('indentation of a carried line is restored after a snippet newline', () => {
    const root = copyFixture('codemod', { git: true });
    expectExit(engine(root, 'codemod', 'run', 'codemods/insert-marker', '--write'), 0);
    assert.match(read(root, 'src/big.js'), /\n {4}if \(ok\) \{\n {8}before\(a\);\n {8}mark\(a\);\n/);
});

test('the ratchet findings a rewrite would cause are predicted in the dry run', () => {
    const root = copyFixture('codemod', { git: true });
    const result = engine(root, 'codemod', 'run', 'codemods/insert-marker', '--json');
    expectExit(result, 0, ['would fail audit with 1 finding', 'RAT-001 src/big.js']);
    assert.equal(result.json.ratchetFindings[0].rule, 'RAT-001');
    assert.equal(result.json.ratchetFindings[0].to, 14);
});

test('a rewrite that does not parse is refused and not written', () => {
    const root = copyFixture('codemod', { git: true });
    fs.writeFileSync(path.join(root, 'src/unbraced.js'), 'function f(ok) {\n    if (ok) mark(1);\n}\n');
    const before = read(root, 'src/unbraced.js');
    const result = engine(root, 'codemod', 'run', 'codemods/breaks-syntax', 'src/unbraced.js', '--write');
    expectExit(result, 2, ['REFUSED src/unbraced.js  CM-SYNTAX']);
    assert.equal(read(root, 'src/unbraced.js'), before);
});

test('failing fixtures stop a run before any file is read', () => {
    const root = copyFixture('codemod', { git: true });
    const before = treeHash(root);
    expectExit(engine(root, 'codemod', 'run', 'codemods/wrong-expected', '--write'), 2, 'fixtures failed — nothing was run');
    assert.equal(treeHash(root), before);
});

test('--staged reads the index, and refuses to write over a partially staged file', () => {
    const root = copyFixture('codemod', { git: true });
    const file = path.join(root, 'src/app.js');
    fs.writeFileSync(file, read(root, 'src/app.js').replace('oldCall(item);', 'oldCall(item, 1);'));
    assert.equal(git(root, 'add', 'src/app.js').status, 0);
    const dry = engine(root, 'codemod', 'run', 'codemods/rename-call', '--staged', '--json');
    expectExit(dry, 0, 'would change src/app.js');
    fs.appendFileSync(file, '// unstaged edit\n');
    expectExit(engine(root, 'codemod', 'run', 'codemods/rename-call', '--staged', '--write'), 2, 'CM-PARTIALLY-STAGED');
    assert.match(read(root, 'src/app.js'), /oldCall\(item, 1\);/);
});

test('a pattern that matches its own output is refused at maxPasses', async () => {
    const root = copyFixture('codemod');
    const { loadCodemod, transform } = require('../core/codemod');
    const { loadGrit } = require('../core/grit');
    const codemod = loadCodemod('codemods/never-settles', { root });
    const out = await transform(loadGrit(), codemod, 'x.js', 'grow(1);\n');
    assert.equal(out.status, 'refused');
    assert.equal(out.refusal.code, 'CM-NO-FIXPOINT');
    assert.equal(out.passes, 2);
});

// The no-network property itself was measured with networking removed (unshare -rn), recorded in the spec's research;
// what a test can hold is that a caller's GRIT_GLOBAL_DIR never replaces the toolkit's placeholder directory.
test('a GRIT_GLOBAL_DIR from the environment is ignored in favour of the toolkit placeholder', () => {
    const root = copyFixture('codemod');
    const result = spawnSync(process.execPath, [require('./support').BIN, 'codemod', 'test', 'codemods/rename-call', '-c', 'config.json', '--root', root], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GRIT_GLOBAL_DIR: path.join(root, 'does-not-exist'), HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' },
    });
    expectExit(result, 0, 'codemod test: 2 fixtures, 0 failed');
    assert.equal(fs.existsSync(path.join(root, 'does-not-exist')), false);
});
