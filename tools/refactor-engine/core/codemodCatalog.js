'use strict';

// The codemod catalog: every directory the host config's `codemods` globs match that holds a codemod.json. Only
// codemod.json is read — never a pattern, never the GritQL binding — so `audit` can consult it inside the pre-commit
// hook at no engine cost. `readFile` is the caller's reader: under `audit --staged`, the git index.

const fs = require('node:fs');
const path = require('node:path');
const { ToolkitError, EXIT } = require('./errors');
const { listFiles } = require('./repo');
const { inScope, patternApplies } = require('./scope');
const { requireFromToolkit } = require('./deps');
const { readCodemodMeta } = require('./codemod');

function catalogMatcher(config) {
    if (config.codemods.length === 0) return () => false;
    return requireFromToolkit('picomatch')(config.codemods, { dot: true });
}

function catalogDirs(root, config) {
    const inCatalog = catalogMatcher(config);
    const dirs = listFiles(root)
        .filter((p) => path.posix.basename(p) === 'codemod.json')
        .map((p) => path.posix.dirname(p))
        .filter(inCatalog);
    return [...new Set(dirs)].sort();
}

// { entries, invalid }. An entry that does not validate is reported with its first message line, never dropped.
function loadCatalog(root, config, readFile) {
    const entries = [];
    const invalid = [];
    const ids = new Map();
    for (const dir of catalogDirs(root, config)) {
        if (readFile(path.posix.join(dir, 'codemod.json')) === null) continue; // listed, but absent from this reader
        try {
            const meta = readCodemodMeta(dir, readFile);
            if (ids.has(meta.id)) throw new ToolkitError(`codemod ${dir}/codemod.json: id "${meta.id}" is also ${ids.get(meta.id)}`, EXIT.USAGE);
            if (meta.ratchet !== null && !config.patterns.some((p) => p.id === meta.ratchet)) {
                throw new ToolkitError(`codemod ${dir}/codemod.json: ratchet "${meta.ratchet}" is not a pattern in the host config`, EXIT.USAGE);
            }
            ids.set(meta.id, dir);
            entries.push(meta);
        } catch (error) {
            if (!(error instanceof ToolkitError)) throw error;
            invalid.push({ dir, error: error.message.split('\n')[0] });
        }
    }
    return { entries, invalid };
}

const runCommand = (dir, relPath) => `refactor-engine codemod run ${dir}${relPath ? ` ${relPath}` : ''}`;

// A RAT-003 finding gains `codemods` when a catalog entry burns that pattern and selects that path.
function annotateFindings(findings, catalog) {
    for (const finding of findings) {
        if (finding.rule !== 'RAT-003') continue;
        const fixes = catalog.entries.filter((c) => c.ratchet === finding.metric && patternApplies(finding.path, c));
        if (fixes.length > 0) finding.codemods = fixes.map((c) => ({ id: c.id, dir: c.dir, command: runCommand(c.dir, finding.path) }));
    }
    return findings;
}

function countDirectories(full) {
    return fs.existsSync(full) ? fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isDirectory()).length : 0;
}

// One `codemod list` row per entry. `ratchetMatches` counts the declared pattern in the in-scope files the codemod
// selects: its reach, not a promise that every match is one the pattern can rewrite.
function listRows(root, config, catalog) {
    const { measure } = require('./metrics');
    const files = listFiles(root).filter((p) => inScope(p, config) && fs.existsSync(path.join(root, p)));
    return catalog.entries.map((c) => {
        let ratchetMatches = null;
        if (c.ratchet !== null) {
            const rule = config.patterns.find((p) => p.id === c.ratchet);
            ratchetMatches = 0;
            for (const relPath of files.filter((p) => patternApplies(p, c) && patternApplies(p, rule))) {
                const text = fs.readFileSync(path.join(root, relPath), 'utf8');
                ratchetMatches += measure(relPath, text, { ...config, patterns: [rule] }).patterns[rule.id] ?? 0;
            }
        }
        return {
            id: c.id,
            dir: c.dir,
            why: c.why,
            ratchet: c.ratchet,
            ratchetMatches,
            fixtures: countDirectories(path.join(root, c.dir, 'fixtures')),
            postconditions: c.postconditions.length,
            review: c.review.length,
        };
    });
}

module.exports = { catalogMatcher, catalogDirs, loadCatalog, annotateFindings, listRows, runCommand };
