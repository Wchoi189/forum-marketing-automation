'use strict';

// Exit codes (contracts/cli.md) asserted from the child's own status, never through a pipe.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLKIT = path.resolve(__dirname, '..');
const BIN = path.join(TOOLKIT, 'bin', 'refactor-engine.js');
const CONFIGS = path.join(__dirname, 'fixtures', 'config');
const RECIPES = path.join(__dirname, 'fixtures', 'recipe');

function run(args, { cwd = TOOLKIT, bin = BIN } = {}) {
    return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
}

// Config-bearing commands run with --root at the config fixture directory, so ruleFile paths resolve there.
const withConfig = (file, ...args) => [...args, '-c', path.join(CONFIGS, file), '--root', CONFIGS];

function expectExit(result, status, stderrIncludes) {
    assert.equal(result.status, status, `expected exit ${status}, got ${result.status}\n${result.stderr}`);
    if (stderrIncludes) assert.ok(result.stderr.includes(stderrIncludes), `stderr lacks "${stderrIncludes}":\n${result.stderr}`);
}

test('--help exits 0', () => expectExit(run(['--help']), 0, 'usage: refactor-engine'));
test('no command exits 4', () => expectExit(run([]), 4, 'no command given'));
test('unknown command exits 4', () => expectExit(run(['frobnicate']), 4, 'unknown command frobnicate'));
test('unknown flag exits 4', () => expectExit(run(['audit', '--bogus']), 4, 'unknown option --bogus'));
test('flag of another command exits 4', () => expectExit(run(['audit', '--markdown']), 4, 'does not apply to audit'));
test('audit --staged with --since exits 4', () => expectExit(run(['audit', '--staged', '--since', 'HEAD']), 4, 'not both'));
test('baseline --raise without --reason exits 4', () => expectExit(run(['baseline', '--raise', 'a.js']), 4, 'non-empty --reason'));
test('baseline --raise with an empty --reason exits 4', () => expectExit(run(['baseline', '--raise', 'a.js', '--reason', ' ']), 4, 'non-empty --reason'));
test('baseline --reason without --raise exits 4', () => expectExit(run(['baseline', '--write', '--reason', 'x']), 4, 'only to baseline --raise'));
test('plan without a recipe exits 4', () => expectExit(run(['plan']), 4, 'plan requires <recipe>'));

test('missing config exits 4', () => expectExit(run(withConfig('does-not-exist.json', 'audit')), 4, 'config not found'));
test('unknown config key at any depth exits 4 and names it', () => expectExit(run(withConfig('unknown-key.json', 'audit')), 4, 'unknown key limits.fileLine'));
test('pattern without why exits 4', () => expectExit(run(withConfig('pattern-no-why.json', 'audit')), 4, '(coalesce-param).why'));
test('regex that does not compile exits 4', () => expectExit(run(withConfig('invalid-regex.json', 'audit')), 4, '.regex does not compile'));
test('pattern without kind exits 4', () => expectExit(run(withConfig('pattern-no-kind.json', 'audit')), 4, '.kind is required'));
test('ast-grep pattern with both rule and ruleFile exits 4', () => expectExit(run(withConfig('astgrep-both.json', 'audit')), 4, 'exactly one of rule / ruleFile'));

// @ast-grep/napi 0.45.3 THROWS on an unknown kind ("Rule contains invalid kind matcher") — measured 2026-09-15 before
// this case was written; it does not silently match nothing, so the unknown kind is the fixture.
test('ast-grep rule that does not compile exits 4', () => {
    const result = run(withConfig('astgrep-invalid.json', 'audit'));
    expectExit(result, 4, 'ast-grep rule prepare-in-loop does not compile for javascript');
    assert.match(result.stderr, /invalid kind/i);
});

test('a valid config with a regex and a ruleFile ast-grep rule is accepted', () => {
    expectExit(run(withConfig('valid.json', 'audit')), 0, 'audit: 0 files, 0 findings, 0 warnings');
});

test('recipe raise without a reason exits 4', () => {
    const result = run(withConfig('valid.json', 'plan', path.join(RECIPES, 'raise-no-reason.recipe.json')));
    expectExit(result, 4, 'raises[0].reason must be a non-empty string');
});

test('--json on an error prints one result object on stdout', () => {
    const result = run(['frobnicate', '--json']);
    assert.equal(result.status, 4);
    const body = JSON.parse(result.stdout);
    assert.equal(body.exitCode, 4);
    assert.match(body.error, /unknown command/);
});

test('toolkit without node_modules exits 3 and names the install command', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-engine-nodeps-'));
    try {
        for (const entry of ['bin', 'core']) fs.cpSync(path.join(TOOLKIT, entry), path.join(tmp, entry), { recursive: true });
        fs.copyFileSync(path.join(TOOLKIT, 'package.json'), path.join(tmp, 'package.json'));
        const result = run(['audit'], { cwd: tmp, bin: path.join(tmp, 'bin', 'refactor-engine.js') });
        expectExit(result, 3, `npm ci --prefix ${tmp}`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
