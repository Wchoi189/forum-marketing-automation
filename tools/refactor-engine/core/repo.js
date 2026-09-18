'use strict';

// Everything the toolkit asks git. Every call is an argv array (no shell) and its exit status is read from the
// child directly. Paths returned are POSIX and relative to the root.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { usageError } = require('./errors');

const MAX_BUFFER = 256 * 1024 * 1024;

function findRoot(start) {
    let dir = path.resolve(start);
    for (;;) {
        if (fs.existsSync(path.join(dir, '.git'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return path.resolve(start);
        dir = parent;
    }
}

const isGitRepo = (root) => fs.existsSync(path.join(root, '.git'));

function git(root, args, { allowFailure = false } = {}) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
    if (result.error) throw usageError(`git could not be run: ${result.error.message}`);
    if (result.status !== 0 && !allowFailure) {
        throw usageError(`git ${args.join(' ')} exited ${result.status}: ${result.stderr.trim()}`);
    }
    return result;
}

const splitZ = (out) => out.split('\0').filter(Boolean);
const toPosix = (p) => p.split(path.sep).join('/');

function walk(root, dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(root, full, out);
        else if (entry.isFile()) out.push(toPosix(path.relative(root, full)));
    }
    return out;
}

// Under git: tracked files plus untracked files that are not ignored — a new file the ratchet must see before it
// is staged. Otherwise every file on disk except node_modules and .git. A path deleted from the worktree but
// still in the index is listed; callers that read content check existence.
function listFiles(root) {
    if (!isGitRepo(root)) return walk(root, root, []).sort();
    return splitZ(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout).sort();
}

// The staged (index) content of a path, or null when the path has no index entry.
function readIndex(root, relPath) {
    const staged = git(root, ['ls-files', '-z', '--cached', '--', relPath]).stdout;
    if (!splitZ(staged).includes(relPath)) return null;
    return git(root, ['show', `:${relPath}`]).stdout;
}

const stagedPaths = (root) =>
    splitZ(git(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).stdout);

function changedSince(root, ref) {
    const verify = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true });
    if (verify.status !== 0) throw usageError(`--since: ${ref} is not a commit`);
    return splitZ(git(root, ['diff', '--name-only', '-z', '--diff-filter=ACMR', ref]).stdout);
}

// Git blob hash of the file's current bytes (what `git hash-object` prints), or `sha256:` when not under git.
function blobHash(root, relPath) {
    if (!isGitRepo(root)) {
        const crypto = require('node:crypto');
        return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relPath))).digest('hex');
    }
    return git(root, ['hash-object', '--', relPath]).stdout.trim();
}

module.exports = { findRoot, isGitRepo, listFiles, readIndex, stagedPaths, changedSince, blobHash, git, toPosix };
