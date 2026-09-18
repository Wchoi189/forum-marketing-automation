#!/usr/bin/env node
'use strict';

// Portability proof (US4). A script, not a `*.test.js`: `node --test tests/` must not collect it, because it runs
// `npm ci` and takes tens of seconds. Copies the toolkit (without node_modules) and one fixture project into a
// temporary directory outside the repository, installs the copy from its own lockfile, and drives the COPIED bin
// from the project directory with no --root and no -c. Every command must exit 0.
//
//     node tools/refactor-engine/tests/verify-portability.js; echo "exit=$?"

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TOOLKIT, FIXTURES } = require('./support');

const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// The config the copied bin finds at its default path. Limits sit low enough that the fixture's source is already
// over the file ceiling, so `baseline --init` records a real entry and `apply` must carry it to the facade.
const CONFIG = {
    scope: { include: ['src/**/*.js'], exclude: ['**/node_modules/**'] },
    limits: { fileLines: 40, functionLines: 10 },
    patterns: [
        {
            id: 'no-console-log',
            kind: 'regex',
            why: 'library code reports through return values, not the console',
            regex: 'console\\.log\\(',
        },
    ],
    baseline: 'refactor-engine.baseline.json',
    receipts: 'receipts',
    verify: { commands: [{ name: 'check', argv: ['node', 'tests/ledger.check.js'] }] },
};

function realpath(dir) {
    return fs.realpathSync.native(dir);
}

function repositoryRoot() {
    const result = spawnSync('git', ['-C', TOOLKIT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    return result.status === 0 ? realpath(result.stdout.trim()) : realpath(TOOLKIT);
}

function run(label, command, args, options) {
    const started = Date.now();
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`${label.padEnd(44)} exit=${result.status} (${seconds} s)\n`);
    if (result.status !== 0) {
        const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
        throw new Error(`${label} failed with exit ${result.status}\n${detail}`);
    }
    return result;
}

function main() {
    const started = Date.now();
    const tmp = realpath(fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-portability-')));
    try {
        const repo = repositoryRoot();
        if (tmp === repo || tmp.startsWith(repo + path.sep)) {
            throw new Error(`temporary directory ${tmp} is inside the repository ${repo}; the proof would be void`);
        }

        const toolkit = path.join(tmp, 'toolkit');
        fs.cpSync(TOOLKIT, toolkit, {
            recursive: true,
            filter: (source) => path.basename(source) !== 'node_modules',
        });
        run('npm ci (copied toolkit)', NPM, ['ci', '--no-audit', '--no-fund'], { cwd: toolkit });

        const project = path.join(tmp, 'project');
        fs.cpSync(path.join(FIXTURES, 'class-cjs'), project, { recursive: true });
        fs.rmSync(path.join(project, 'expected'), { recursive: true, force: true });
        fs.rmSync(path.join(project, 'config.json'), { force: true });
        const configFile = path.join(project, 'docs', 'architecture', 'refactor-engine.config.json');
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify(CONFIG, null, 2) + '\n');
        for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
            run(`git ${args[0]}`, 'git', args, { cwd: project, env: GIT_ENV });
        }

        const bin = path.join(toolkit, 'bin', 'refactor-engine.js');
        for (const args of [
            ['baseline', '--init'],
            ['inventory', 'src/ledger.js'],
            ['plan', 'recipe.json'],
            ['apply', 'recipe.json'],
            ['verify', 'recipe.json'],
            ['audit'],
        ]) {
            run(`refactor-engine ${args.join(' ')}`, process.execPath, [bin, ...args], { cwd: project });
        }

        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        process.stdout.write(`verify-portability: ok in ${seconds} s (${tmp})\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`verify-portability: ${error.message}\n`);
        return 1;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

process.exitCode = main();
