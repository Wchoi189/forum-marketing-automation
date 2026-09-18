'use strict';

// Shared helpers for the split tests: throwaway copies of a fixture, the bin as a child process (exit status read
// from the child, never through a pipe), a directory tree hash, and a runtime view of a class.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const TOOLKIT = path.resolve(__dirname, '..');
const BIN = path.join(TOOLKIT, 'bin', 'refactor-engine.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

// `typescript: true` links the toolkit's TypeScript into the copy's node_modules, for a fixture check that compiles.
function copyFixture(name, { git = false, typescript = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `refactor-engine-${name.replace(/\//g, '-')}-`));
    fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
    fs.rmSync(path.join(root, 'expected'), { recursive: true, force: true });
    if (typescript) {
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.symlinkSync(path.join(TOOLKIT, 'node_modules', 'typescript'), path.join(root, 'node_modules', 'typescript'), 'dir');
    }
    if (git) {
        for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
            const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: GIT_ENV });
            if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
        }
    }
    return root;
}

// `engine(root, 'plan', 'recipe.json', '--json')` → spawnSync result, plus `json` when --json produced one.
function engine(root, ...args) {
    const config = args.includes('-c') ? [] : ['-c', 'config.json'];
    const result = spawnSync(process.execPath, [BIN, ...args, ...config, '--root', root], { cwd: root, encoding: 'utf8' });
    if (args.includes('--json') && result.stdout.trim() !== '') {
        try {
            result.json = JSON.parse(result.stdout);
        } catch {
            result.json = null;
        }
    }
    return result;
}

function node(root, ...args) {
    return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full;
    }
}

function treeHash(root) {
    const hash = crypto.createHash('sha256');
    for (const file of [...walk(root)].sort()) {
        hash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
    }
    return hash.digest('hex');
}

// Own property names and descriptor kinds of a class's prototype and constructor, read in a child process so
// the module cache never leaks between the "before" and "after" views. Works for CommonJS and ESM.
const SHAPE_SCRIPT = `
const target = process.argv.at(-1);
import(target).then((m) => {
    const Host = m.default ?? m;
    const kinds = (obj) => Object.getOwnPropertyNames(obj).sort().map((name) => {
        const d = Object.getOwnPropertyDescriptor(obj, name);
        return [name, d.get || d.set ? 'accessor' : typeof d.value, d.enumerable];
    });
    process.stdout.write(JSON.stringify({ keys: Object.keys(Host.prototype), proto: kinds(Host.prototype), statics: kinds(Host) }));
}).catch((error) => { console.error(error); process.exit(1); });
`;

function classShape(root, relFile) {
    const target = require('node:url').pathToFileURL(path.join(root, relFile)).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', SHAPE_SCRIPT, '--', target], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`classShape failed:\n${result.stderr}`);
    return JSON.parse(result.stdout);
}

// Export keys of a module in a child process: CommonJS in `module.exports` order, ESM (import()) as the namespace lists them.
const KEYS_SCRIPT = `
const { createRequire } = require('node:module');
const target = process.argv.at(-1);
const esm = process.argv.at(-2) === 'esm';
if (!esm) process.stdout.write(JSON.stringify(Object.keys(createRequire(target)(target))));
else import(require('node:url').pathToFileURL(target).href).then((m) => process.stdout.write(JSON.stringify(Object.keys(m))));
`;

function moduleKeys(root, relFile, { esm = false } = {}) {
    const result = spawnSync(process.execPath, ['-e', KEYS_SCRIPT, '--', esm ? 'esm' : 'cjs', path.join(root, relFile)], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`moduleKeys failed:\n${result.stderr}`);
    return JSON.parse(result.stdout);
}

function expectExit(result, status, includes) {
    const assert = require('node:assert/strict');
    assert.equal(result.status, status, `expected exit ${status}, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    for (const text of [].concat(includes ?? [])) {
        assert.ok(result.stderr.includes(text) || result.stdout.includes(text), `output lacks "${text}":\n${result.stdout}\n${result.stderr}`);
    }
}

module.exports = { TOOLKIT, BIN, FIXTURES, copyFixture, engine, node, walk, treeHash, classShape, moduleKeys, expectExit };
