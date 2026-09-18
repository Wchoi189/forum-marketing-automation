'use strict';

// Text-level passes around an engine rewrite: the line hunks between two versions of a file, the indentation
// restore, the introduced-syntax-error check and the unified patch. Line hunks come from `git diff --no-index`, so
// the patch the dry run prints is exactly what `git apply` accepts from the root.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { usageError } = require('./errors');
const { loadTs, scriptKindOf } = require('./parser');

const MAX_BUFFER = 256 * 1024 * 1024;

function withPair(relPath, before, after, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-engine-diff-'));
    try {
        for (const [side, text] of [['a', before], ['b', after]]) {
            const full = path.join(dir, side, relPath);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, text);
        }
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function gitDiff(dir, relPath, context) {
    const result = spawnSync(
        'git',
        ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-prefix', `-U${context}`, '--', path.join('a', relPath), path.join('b', relPath)],
        { cwd: dir, encoding: 'utf8', maxBuffer: MAX_BUFFER },
    );
    if (result.error) throw usageError(`git could not be run: ${result.error.message}`);
    if (result.status !== 0 && result.status !== 1) throw usageError(`git diff --no-index exited ${result.status}: ${result.stderr.trim()}`);
    return result.stdout;
}

// Unified patch with `a/<relPath>` / `b/<relPath>` headers, applicable with `git apply` at the root. '' when equal.
function unifiedPatch(relPath, before, after, context = 3) {
    if (before === after) return '';
    return withPair(relPath, before, after, (dir) => gitDiff(dir, relPath, context));
}

// Changed lines grouped by hunk, from a diff with `context` lines: [{ removed: [oldIndex…], added: [newIndex…] }],
// 0-based. Hunks closer than 2 × context lines merge, so a line the rewrite moved past a short unchanged run is
// still grouped with its original.
function changedLineGroups(relPath, before, after, context = 3) {
    const groups = [];
    let group = null;
    let oldAt = 0;
    let newAt = 0;
    for (const line of unifiedPatch(relPath, before, after, context).split('\n')) {
        const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (m) {
            group = { removed: [], added: [] };
            groups.push(group);
            // A zero-length side reports the line BEFORE the hunk; the first body line consumes nothing on that side.
            oldAt = Math.max(Number(m[1]) - 1, 0);
            newAt = Math.max(Number(m[2]) - 1, 0);
            continue;
        }
        if (group === null || line.startsWith('\\')) continue;
        if (line.startsWith('-')) group.removed.push(oldAt++);
        else if (line.startsWith('+')) group.added.push(newAt++);
        else if (line.startsWith(' ')) {
            oldAt += 1;
            newAt += 1;
        }
    }
    return groups;
}

const leading = (line) => /^[ \t]*/.exec(line)[0];

// Longest common subsequence of two arrays of keys, as index pairs.
function lcsPairs(a, b) {
    const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const pairs = [];
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
        if (a[i] === b[j]) pairs.push([i++, j++]);
        else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
        else j += 1;
    }
    return pairs;
}

// Inside each changed hunk, a line the rewrite carried over (same text once leading whitespace is ignored) gets its
// original leading whitespace back. Only leading whitespace of such lines ever changes. That is also the safe
// direction inside a multi-line template literal: the carried line's bytes become the original bytes again.
// Candidates are only lines whose text occurs on the other side WITH DIFFERENT indentation: a carried line that
// kept its column must not win the pairing over the displaced one (measured: a hoisted multi-line SQL string tied
// with the loop header it was moved above, and the header lost).
function restoreIndentation(relPath, before, after) {
    if (before === after) return { text: after, restored: 0 };
    const oldLines = before.split('\n');
    const newLines = after.split('\n');
    let restored = 0;
    for (const group of changedLineGroups(relPath, before, after)) {
        const indentsOf = (lines, indexes) => {
            const map = new Map();
            for (const index of indexes) {
                const text = lines[index].trimStart();
                if (text === '') continue;
                if (!map.has(text)) map.set(text, new Set());
                map.get(text).add(leading(lines[index]));
            }
            return map;
        };
        const oldIndents = indentsOf(oldLines, group.removed);
        const newIndents = indentsOf(newLines, group.added);
        const displaced = (lines, index, otherSide) => {
            const text = lines[index].trimStart();
            return text !== '' && otherSide.has(text) && [...otherSide.get(text)].some((indent) => indent !== leading(lines[index]));
        };
        const removed = group.removed.filter((i) => displaced(oldLines, i, newIndents));
        const added = group.added.filter((i) => displaced(newLines, i, oldIndents));
        if (removed.length === 0 || added.length === 0) continue;
        const keys = (lines, indexes) => indexes.map((i) => lines[i].trimStart());
        for (const [i, j] of lcsPairs(keys(oldLines, removed), keys(newLines, added))) {
            const original = oldLines[removed[i]];
            const rewritten = newLines[added[j]];
            if (leading(original) !== leading(rewritten)) {
                newLines[added[j]] = leading(original) + rewritten.trimStart();
                restored += 1;
            }
        }
    }
    return { text: newLines.join('\n'), restored };
}

const CJS_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'];

// The first syntax error in `text`, or null. CommonJS JavaScript is compiled by V8 inside the module wrapper, which
// also reports early errors such as a redeclared `const`; anything else (ES modules, TypeScript, TSX) is checked by
// the TypeScript parser's syntactic diagnostics.
function syntaxError(relPath, text) {
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.js' || ext === '.cjs') {
        try {
            vm.compileFunction(text.replace(/^#!.*/, ''), CJS_PARAMS, { filename: relPath });
            return null;
        } catch (error) {
            if (!(error instanceof SyntaxError)) return null;
            if (!/import|export|module/i.test(error.message)) return error.message;
        }
    }
    const ts = loadTs();
    const kind = scriptKindOf(relPath);
    const { diagnostics } = ts.transpileModule(text, {
        fileName: relPath,
        reportDiagnostics: true,
        compilerOptions: { allowJs: kind === ts.ScriptKind.JS || kind === ts.ScriptKind.JSX, jsx: ts.JsxEmit.Preserve },
    });
    const first = (diagnostics || []).find((d) => d.category === ts.DiagnosticCategory.Error);
    return first ? ts.flattenDiagnosticMessageText(first.messageText, '\n') : null;
}

module.exports = { unifiedPatch, restoreIndentation, syntaxError, changedLineGroups };
