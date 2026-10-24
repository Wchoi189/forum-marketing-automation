'use strict';

// RAT-001 … RAT-005 (data-model.md §5) over measured metrics against the baseline. Pure: no I/O, no git.
// A path absent from the baseline counts as 0 for every pattern and as "not grandfathered" for lines.

const RULES = Object.freeze({
    'RAT-001': 'file growth',
    'RAT-002': 'new oversized file',
    'RAT-003': 'pattern growth',
    'RAT-004': 'function growth',
    'RAT-005': 'stale baseline',
});

const number = (n) => n.toLocaleString('en-US');

function remedy(rule, relPath) {
    const raise = `raise: refactor-engine baseline --raise ${relPath} --reason "…"`;
    if (rule === 'RAT-003') return `fix the new match (narrow the rule if it is a false positive) or ${raise}`;
    if (rule === 'RAT-004') return `split the function or ${raise}`;
    return `split it (refactor-engine inventory ${relPath}) or ${raise}`;
}

function finding(rule, relPath, metric, from, to, ceiling, baseline, extra = {}) {
    return { rule, path: relPath, metric, from, to, ceiling, baseline, ...extra, remedy: remedy(rule, relPath) };
}

function evaluate({ measured, baseline, limits, fullRun = false, existing = new Set() }) {
    const findings = [];
    const warnings = [];
    const entries = baseline.files;

    for (const [relPath, metrics] of measured) {
        const entry = entries[relPath] ?? null;
        const baseLines = entry ? entry.lines : null;

        if (entry && entry.lines > limits.fileLines) {
            if (metrics.lines > entry.lines) {
                findings.push(finding('RAT-001', relPath, 'lines', entry.lines, metrics.lines, limits.fileLines, baseLines));
            }
        } else if (metrics.lines > limits.fileLines) {
            findings.push(finding('RAT-002', relPath, 'lines', baseLines ?? 0, metrics.lines, limits.fileLines, baseLines));
        }

        for (const [id, count] of Object.entries(metrics.patterns)) {
            const allowed = entry ? (entry.patterns[id] ?? 0) : 0;
            if (count > allowed) findings.push(finding('RAT-003', relPath, id, allowed, count, 0, entry ? allowed : null));
        }

        if (metrics.maxFunction) {
            const allowed = entry && entry.maxFunction ? entry.maxFunction.lines : 0;
            if (metrics.maxFunction.lines > limits.functionLines && metrics.maxFunction.lines > allowed) {
                findings.push(
                    finding('RAT-004', relPath, 'maxFunction', allowed, metrics.maxFunction.lines, limits.functionLines, entry && entry.maxFunction ? allowed : null, {
                        function: metrics.maxFunction,
                    }),
                );
            }
        }
    }

    if (fullRun) {
        for (const [relPath, entry] of Object.entries(entries)) {
            if (!existing.has(relPath)) {
                warnings.push({ rule: 'RAT-005', path: relPath, message: 'baselined path no longer exists or is out of scope; lower with: refactor-engine baseline --write' });
                continue;
            }
            const metrics = measured.get(relPath);
            if (!metrics) continue;
            const above = [];
            if (entry.lines > metrics.lines) above.push(`lines ${number(entry.lines)} > ${number(metrics.lines)}`);
            if (entry.maxFunction && entry.maxFunction.lines > (metrics.maxFunction ? metrics.maxFunction.lines : 0)) {
                above.push(`maxFunction ${number(entry.maxFunction.lines)} > ${number(metrics.maxFunction ? metrics.maxFunction.lines : 0)}`);
            }
            for (const [id, count] of Object.entries(entry.patterns)) {
                const now = metrics.patterns[id] ?? 0;
                if (count > now) above.push(`${id} ${number(count)} > ${number(now)}`);
            }
            if (above.length > 0) {
                warnings.push({ rule: 'RAT-005', path: relPath, message: `baseline above measured (${above.join(', ')}); lower with: refactor-engine baseline --write` });
            }
        }
    }

    return { findings, warnings };
}

// The two-line block of contracts/cli.md `audit`.
function formatFinding(f) {
    const ceiling = f.ceiling ? `ceiling ${number(f.ceiling)}, ` : '';
    const baseline = f.baseline === null ? 'not in baseline' : `baseline ${number(f.baseline)}`;
    const where = f.function ? `  ${f.function.name}:${f.function.line}` : '';
    const rewrites = (f.codemods ?? []).map((c) => `\n        rewrite: ${c.command}`).join('');
    return `${f.rule} ${f.path}  ${f.metric} ${number(f.from)} → ${number(f.to)} (${ceiling}${baseline})${where}${rewrites}\n        ${f.remedy}`;
}

const formatWarning = (w) => `WARN ${w.rule} ${w.path}  ${w.message}`;

module.exports = { RULES, evaluate, formatFinding, formatWarning };
