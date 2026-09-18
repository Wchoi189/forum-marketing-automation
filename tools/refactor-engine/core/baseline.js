'use strict';

// The committed, path-keyed baseline (contracts/recipe-and-config.md "Baseline"). Three writers:
//   --init   creates it, grandfathering every in-scope file above a limit or with a non-zero pattern count;
//            refuses when the file already exists — the only way an entry is ever created without a reason.
//   --write  lowers: decreases and removals only. It never raises and never adds (a new oversized file is
//            RAT-002's business), so a regeneration diff shows nothing but real reductions.
//   --raise  sets one path to its measured values with the operator's reason.
// Keys are sorted at every level and the file ends in a newline, so two writes of the same state are
// byte-identical.

const fs = require('node:fs');
const path = require('node:path');
const { usageError } = require('./errors');
const { BASELINE_SCHEMA } = require('./config');
const { inScope } = require('./scope');
const { measure } = require('./metrics');
const { inScopeFiles, worktreeReader, normalizePath } = require('./audit');

const number = (n) => n.toLocaleString('en-US');

function sortedJson(value) {
    if (Array.isArray(value)) return value.map(sortedJson);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
    }
    return value;
}

const serialize = (baseline) => `${JSON.stringify(sortedJson(baseline), null, 2)}\n`;

function nonZero(patterns) {
    return Object.fromEntries(Object.entries(patterns).filter(([, count]) => count > 0));
}

function qualifies(metrics, limits) {
    return (
        metrics.lines > limits.fileLines ||
        (metrics.maxFunction !== null && metrics.maxFunction.lines > limits.functionLines) ||
        Object.values(metrics.patterns).some((count) => count > 0)
    );
}

function entryFrom(metrics, reason) {
    return { lines: metrics.lines, maxFunction: metrics.maxFunction, patterns: nonZero(metrics.patterns), reason };
}

// Local date, in the zone of TZ or the system — the toolkit never assumes UTC (data-model.md, receipts).
function localDate(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function measureAll(root, config) {
    const read = worktreeReader(root);
    const measured = new Map();
    const warnings = [];
    for (const relPath of inScopeFiles(root, config)) {
        const metrics = measure(relPath, read(relPath), config);
        warnings.push(...metrics.warnings);
        measured.set(relPath, metrics);
    }
    return { measured, warnings };
}

function writeBaseline(root, config, files) {
    const document = { $schema: BASELINE_SCHEMA, limits: config.limits, files };
    const target = path.resolve(root, config.baseline);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialize(document));
    return document;
}

function init({ root, config, baseline }) {
    if (baseline.exists) throw usageError(`${config.baseline} already exists; use --write to lower it or --raise <path> to raise one entry`);
    const { measured, warnings } = measureAll(root, config);
    const reason = `baseline ${localDate()}`;
    const files = {};
    for (const [relPath, metrics] of measured) {
        if (qualifies(metrics, config.limits)) files[relPath] = entryFrom(metrics, reason);
    }
    writeBaseline(root, config, files);
    return { changes: [`wrote ${Object.keys(files).length} entries to ${config.baseline} (${reason})`], warnings };
}

function write({ root, config, baseline }) {
    const { measured, warnings } = measureAll(root, config);
    const changes = [];
    const files = {};
    for (const [relPath, entry] of Object.entries(baseline.files)) {
        const metrics = measured.get(relPath);
        if (!metrics) {
            changes.push(`removed ${relPath} (no longer exists or is out of scope)`);
            continue;
        }
        const next = { ...entry, patterns: { ...entry.patterns } };
        if (metrics.lines < entry.lines) {
            changes.push(`${relPath}  lines ${number(entry.lines)} → ${number(metrics.lines)}`);
            next.lines = metrics.lines;
        }
        const measuredFn = metrics.maxFunction ? metrics.maxFunction.lines : 0;
        if (entry.maxFunction && entry.maxFunction.lines > measuredFn) {
            changes.push(`${relPath}  maxFunction ${number(entry.maxFunction.lines)} → ${number(measuredFn)}`);
            next.maxFunction = metrics.maxFunction;
        }
        for (const [id, count] of Object.entries(entry.patterns)) {
            const now = metrics.patterns[id] ?? 0;
            if (now < count) {
                changes.push(`${relPath}  ${id} ${number(count)} → ${number(now)}`);
                if (now === 0) delete next.patterns[id];
                else next.patterns[id] = now;
            }
        }
        // An entry lowered below every limit with no pattern left has nothing to grandfather.
        const stillQualifies =
            next.lines > config.limits.fileLines ||
            (next.maxFunction !== null && next.maxFunction.lines > config.limits.functionLines) ||
            Object.keys(next.patterns).length > 0;
        if (!stillQualifies) {
            changes.push(`removed ${relPath} (within every limit)`);
            continue;
        }
        files[relPath] = next;
    }
    writeBaseline(root, config, files);
    return { changes, warnings };
}

function raise({ root, config, baseline, target, reason }) {
    if (typeof reason !== 'string' || reason.trim() === '') throw usageError('baseline --raise requires a non-empty --reason');
    const relPath = normalizePath(root, target);
    if (!inScope(relPath, config)) throw usageError(`${relPath} is not in scope`);
    const text = worktreeReader(root)(relPath);
    if (text === null) throw usageError(`${relPath} does not exist`);
    const metrics = measure(relPath, text, config);
    const files = { ...baseline.files, [relPath]: entryFrom(metrics, reason.trim()) };
    writeBaseline(root, config, files);
    const fn = metrics.maxFunction ? `, maxFunction ${number(metrics.maxFunction.lines)}` : '';
    const patterns = Object.entries(nonZero(metrics.patterns)).map(([id, count]) => `, ${id} ${number(count)}`).join('');
    return { changes: [`${relPath}  lines ${number(metrics.lines)}${fn}${patterns}  reason: ${reason.trim()}`], warnings: metrics.warnings };
}

module.exports = { init, write, raise, serialize, sortedJson, qualifies, entryFrom, localDate };
