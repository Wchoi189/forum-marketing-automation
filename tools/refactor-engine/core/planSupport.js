'use strict';

// What both strategies' planners share (data-model.md §3): specifier rebasing inside a carried import, where the
// generated imports block goes, and the tail of every plan — measured rows, the ratchet effect on the baseline,
// path references and the summary. Nothing here writes.

const path = require('node:path');
const { spanText } = require('./inventory');
const { rebaseSpecifier, relativeSpecifier } = require('./emit/blocks');
const { findPathReferences } = require('./pathReferences');
const { measure } = require('./metrics');
const { inScope } = require('./scope');
const { qualifies, entryFrom } = require('./baseline');
const { normalizePath } = require('./audit');
const { refusal } = require('./preconditions');

const posixDir = (p) => path.posix.dirname(p);
const resolveDir = (sourceDir, dir) => path.posix.normalize(path.posix.join(sourceDir, dir)).replace(/\/$/, '') || '.';

// Rebase every relative specifier inside one import/require statement's text.
function rebaseStatement(ts, sourceFile, text, record, sourceDir, partDir) {
    const statement = sourceFile.statements[record.index];
    const edits = [];
    (function walk(n) {
        if (ts.isCallExpression(n) && n.arguments.length === 1 && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
            const callee = n.expression;
            const isRequire = (ts.isIdentifier(callee) && callee.text === 'require') || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'require');
            if (isRequire) edits.push(n.arguments[0]);
        } else if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) edits.push(n.moduleSpecifier);
        ts.forEachChild(n, walk);
    })(statement);
    let out = spanText(text, record.span);
    for (const literal of edits.sort((a, b) => b.getStart(sourceFile) - a.getStart(sourceFile))) {
        const rebased = rebaseSpecifier(literal.text, sourceDir, partDir);
        if (rebased === literal.text) continue;
        const quote = text[literal.getStart(sourceFile)];
        const from = literal.getStart(sourceFile) - record.span.start;
        const to = literal.end - record.span.start;
        out = `${out.slice(0, from)}${quote}${rebased}${quote}${out.slice(to)}`;
    }
    return out;
}

// Where the generated imports/bindings block goes: after the last kept import, else after the directive, else at
// the top. ESM/TS join the block to the imports with one newline; CommonJS separates it with a blank line.
function importsAnchorFor({ keptImports, declarations, language, newline }) {
    const tight = language !== 'cjs';
    if (keptImports.length > 0) return { at: keptImports[keptImports.length - 1].span.end, leading: tight ? newline : `${newline}${newline}`, trailing: '' };
    if (declarations.length > 0 && declarations[0].directive) return { at: declarations[0].span.end, leading: `${newline}${newline}`, trailing: '' };
    return { at: declarations.length > 0 ? declarations[0].span.start : 0, leading: '', trailing: `${newline}${newline}` };
}

// rows[]: { destination, file, extra } in display order, the facade first; `files` holds every content.
function finishPlan({ root, config, baseline, recipe, sourceRel, inventory, text, ext, host, rowSpecs, files, refusals, moves, generated, receiptPath, withPathReferences }) {
    const sourceBasename = path.posix.basename(sourceRel);
    const rows = [];
    const measured = new Map();
    for (const spec of rowSpecs) {
        const content = files.get(spec.file);
        const metrics = inScope(spec.file, config) ? measure(spec.file, content, config) : null;
        const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
        measured.set(spec.file, metrics);
        rows.push({ destination: spec.destination, file: spec.file, lines, bytes: Buffer.byteLength(content), overLimit: lines > config.limits.fileLines, ...spec.extra });
    }

    const ratchetEffect = { inScope: inScope(sourceRel, config), removed: [], updated: [], added: [], raisesNeeded: [], files: { ...baseline.files } };
    if (ratchetEffect.inScope) {
        const sourceEntry = baseline.files[sourceRel] || null;
        const fallbackReason = sourceEntry ? sourceEntry.reason : `split of ${sourceBasename} by refactor-engine (recipe ${recipe.name})`;
        const facadeMetrics = measured.get(sourceRel);
        if (facadeMetrics && qualifies(facadeMetrics, config.limits)) {
            ratchetEffect.files[sourceRel] = entryFrom(facadeMetrics, fallbackReason);
            ratchetEffect.updated.push({ path: sourceRel, lines: facadeMetrics.lines, was: sourceEntry ? sourceEntry.lines : null });
        } else if (sourceEntry) {
            delete ratchetEffect.files[sourceRel];
            ratchetEffect.removed.push({ path: sourceRel, lines: sourceEntry.lines });
        }
        for (const [relFile, metrics] of measured) {
            if (relFile === sourceRel || !metrics) continue;
            const partName = path.posix.basename(relFile, ext);
            const raise = recipe.raises.find((r) => r.part === partName) || null;
            if (metrics.lines > config.limits.fileLines && !raise) {
                ratchetEffect.raisesNeeded.push({ part: partName, lines: metrics.lines });
                refusals.push(refusal('RF-RAISE-REQUIRED', partName, 0, `${relFile} would be ${metrics.lines} lines, over the ceiling of ${config.limits.fileLines}, and the recipe carries no raise for it`));
            }
            if (qualifies(metrics, config.limits)) {
                ratchetEffect.files[relFile] = entryFrom(metrics, raise ? raise.reason : fallbackReason);
                ratchetEffect.added.push({ path: relFile, lines: metrics.lines, raised: Boolean(raise) });
            }
        }
    }

    // The baseline is rewritten by apply and the recipe names its own source: neither needs reconciling.
    const selfReferential = new Set([normalizePath(root, config.baseline), normalizePath(root, recipe.path)]);
    const pathReferences = withPathReferences
        ? findPathReferences({ root, source: sourceRel }).map((ref) => (selfReferential.has(ref.file) ? { ...ref, action: 'none' } : ref))
        : [];
    const originalLines = inventory.lines;
    const totalLines = rows.reduce((n, r) => n + r.lines, 0);
    return {
        nothingToMove: false,
        recipe: recipe.name,
        strategy: recipe.strategy,
        host,
        language: inventory.language,
        source: { path: sourceRel, hash: inventory.sourceHash, lines: originalLines, bytes: inventory.bytes },
        rows,
        refusals,
        pathReferences,
        ratchetEffect,
        summary: { originalLines, facadeLines: rows[0].lines, partLines: totalLines - rows[0].lines, addedLines: totalLines - originalLines },
        files,
        moves,
        generated,
        receiptPath,
        sourceText: text,
    };
}

const displayOf = (sourceDir, file) => relativeSpecifier(sourceDir, file).replace(/^\.\//, '');

module.exports = { posixDir, resolveDir, rebaseStatement, importsAnchorFor, finishPlan, displayOf };
