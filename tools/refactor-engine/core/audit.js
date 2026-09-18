'use strict';

// `audit`: select files, measure them, apply the ratchet. Under --staged every byte comes from the git index —
// the files, and (in the bin) the config and baseline too — so a commit is judged against what it stages.

const fs = require('node:fs');
const path = require('node:path');
const { usageError } = require('./errors');
const { listFiles, readIndex, stagedPaths, changedSince, toPosix } = require('./repo');
const { inScope } = require('./scope');
const { measure } = require('./metrics');
const { evaluate } = require('./ratchet');

const worktreeReader = (root) => (relPath) => {
    try {
        return fs.readFileSync(path.resolve(root, relPath), 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw usageError(`cannot read ${relPath}: ${error.message}`);
    }
};

function normalizePath(root, given) {
    const absolute = path.resolve(root, given);
    const relative = toPosix(path.relative(root, absolute));
    if (relative === '' || relative.startsWith('..')) throw usageError(`${given} is outside the root ${root}`);
    return relative;
}

// Every in-scope file that exists on disk. `git ls-files` still lists a path deleted from the worktree but not
// from the index; such a path is not measured and counts as missing for RAT-005.
function inScopeFiles(root, config) {
    return listFiles(root).filter((relPath) => inScope(relPath, config) && fs.existsSync(path.join(root, relPath)));
}

function selectFiles({ root, config, staged = false, since = null, paths = [] }) {
    if (staged) {
        return { files: stagedPaths(root).filter((p) => inScope(p, config)), read: (p) => readIndex(root, p), fullRun: false };
    }
    const read = worktreeReader(root);
    if (since !== null) {
        return { files: changedSince(root, since).filter((p) => inScope(p, config) && fs.existsSync(path.join(root, p))), read, fullRun: false };
    }
    if (paths.length > 0) {
        const files = paths.map((given) => normalizePath(root, given));
        for (const relPath of files) {
            if (!fs.existsSync(path.join(root, relPath))) throw usageError(`${relPath} does not exist`);
        }
        return { files: files.filter((p) => inScope(p, config)), read, fullRun: false };
    }
    return { files: inScopeFiles(root, config), read, fullRun: true };
}

function measureFiles(files, read, config) {
    const measured = new Map();
    const warnings = [];
    for (const relPath of files) {
        const text = read(relPath);
        if (text === null) continue;
        const metrics = measure(relPath, text, config);
        warnings.push(...metrics.warnings.map((message) => ({ rule: 'MEASURE', path: relPath, message })));
        measured.set(relPath, { lines: metrics.lines, maxFunction: metrics.maxFunction, patterns: metrics.patterns });
    }
    return { measured, warnings };
}

function runAudit({ root, config, baseline, staged = false, since = null, paths = [] }) {
    const started = process.hrtime.bigint();
    const { files, read, fullRun } = selectFiles({ root, config, staged, since, paths });
    const { measured, warnings: measureWarnings } = measureFiles(files, read, config);
    const { findings, warnings } = evaluate({
        measured,
        baseline,
        limits: config.limits,
        fullRun,
        existing: new Set(measured.keys()),
    });
    // Fix hints: only when a pattern finding exists, through the same reader as the files (the index under --staged).
    const catalogWarnings = [];
    if (config.codemods.length > 0 && findings.some((f) => f.rule === 'RAT-003')) {
        const { loadCatalog, annotateFindings } = require('./codemodCatalog');
        const catalog = loadCatalog(root, config, read);
        annotateFindings(findings, catalog);
        catalogWarnings.push(...catalog.invalid.map((i) => ({ rule: 'CM-CATALOG', path: i.dir, message: `not used for fix hints: ${i.error}` })));
    }
    const elapsedMs = Number((process.hrtime.bigint() - started) / 1000000n);
    return { files: measured.size, findings, warnings: [...measureWarnings, ...warnings, ...catalogWarnings], elapsedMs };
}

module.exports = { runAudit, selectFiles, measureFiles, inScopeFiles, worktreeReader, normalizePath };
