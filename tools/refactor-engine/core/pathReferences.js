'use strict';

// Every file that names the source (research R10): by a directory-qualified path suffix, by a require/import
// specifier that resolves to it, or by its bare basename when cited (`basename`, basename:<line>, basename line(s)
// <n>). Classified test / document / code by extension and location; a require/import from code needs no action —
// the facade keeps the path. Also the importer scan `verify` uses for V-6 (research R13).

const fs = require('node:fs');
const path = require('node:path');
const { listFiles } = require('./repo');
const { TOOLKIT_DIR } = require('./deps');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SPECIFIER = /(?:require(?:\.resolve)?\(\s*|import\(\s*|\bfrom\s+|^\s*import\s+)(['"])([^'"\n]+)\1/g;
const MAX_BYTES = 4 * 1024 * 1024;

function kindOf(relPath) {
    const ext = path.posix.extname(relPath).toLowerCase();
    if (['.md', '.markdown', '.yaml', '.yml', '.txt', '.rst'].includes(ext)) return 'document';
    if (/(^|\/)(tests?|__tests__)\//.test(relPath) || /\.(test|spec)\./.test(path.posix.basename(relPath))) return 'test';
    return 'code';
}

const isPathChar = (c) => /[A-Za-z0-9_.@$~-]/.test(c);

// The set of paths a specifier written in `fromFile` may denote: as written, with each extension, as an index.
function resolvesTo(specifier, fromFile, target) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    if (resolved === target) return true;
    const ext = path.posix.extname(target);
    if (`${resolved}${ext}` === target) return true;
    return path.posix.join(resolved, `index${ext}`) === target;
}

function readable(root, relPath) {
    const full = path.join(root, relPath);
    let stat;
    try {
        stat = fs.statSync(full);
    } catch {
        return null;
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const buffer = fs.readFileSync(full);
    if (buffer.subarray(0, 1024).includes(0)) return null;
    return buffer.toString('utf8');
}

function scanTargets(root) {
    const toolkit = path.relative(root, TOOLKIT_DIR).split(path.sep).join('/');
    const insideToolkit = (p) => !toolkit.startsWith('..') && !path.isAbsolute(toolkit) && (p === toolkit || p.startsWith(`${toolkit}/`));
    return listFiles(root).filter((p) => !p.split('/').includes('node_modules') && !insideToolkit(p));
}

// References to `source` (repo-relative POSIX path) from every other listed file.
function findPathReferences({ root, source, files = scanTargets(root) }) {
    const basename = path.posix.basename(source);
    const segments = source.split('/');
    const suffixes = new Set();
    for (let i = 0; i < segments.length - 1; i += 1) suffixes.add(segments.slice(i).join('/'));
    const basenameRe = new RegExp(escape(basename), 'g');
    const out = [];
    for (const file of files) {
        if (file === source) continue;
        const text = readable(root, file);
        if (text === null) continue;
        const kind = kindOf(file);
        const lines = text.split('\n');
        lines.forEach((line, index) => {
            const lineNo = index + 1;
            const seen = new Set();
            const push = (form, action, column) => {
                const key = `${form}:${action}:${column}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push({ file, line: lineNo, column: column + 1, kind, form, action, text: line.trim().slice(0, 160) });
            };
            // require / import specifiers that resolve to the source
            SPECIFIER.lastIndex = 0;
            let spec;
            const specifierColumns = [];
            while ((spec = SPECIFIER.exec(line)) !== null) {
                if (resolvesTo(spec[2], file, source)) {
                    push('path', 'none', spec.index);
                    specifierColumns.push(spec.index);
                }
            }
            // path suffixes and cited basenames
            basenameRe.lastIndex = 0;
            let match;
            while ((match = basenameRe.exec(line)) !== null) {
                const start = match.index;
                const end = start + basename.length;
                if (end < line.length && /[A-Za-z0-9_]/.test(line[end])) continue; // orders.json vs orders.js
                let prefixStart = start;
                while (prefixStart > 0 && (isPathChar(line[prefixStart - 1]) || line[prefixStart - 1] === '/')) prefixStart -= 1;
                const candidate = line.slice(prefixStart, end);
                if (candidate.includes('/')) {
                    const normalized = candidate.replace(/^(\.\/|\.\.\/)+/, '');
                    if (suffixes.has(normalized) || normalized === source) {
                        if (!specifierColumns.some((column) => column <= start && start <= column + 200 && kind !== 'document')) push('path', 'reconcile', prefixStart);
                    }
                    continue;
                }
                const after = line.slice(end);
                const before = line.slice(0, start);
                if (/^:\d+/.test(after) || /^`?\s+lines?\s+~?\d+/.test(after)) push('line', 'reconcile', start);
                else if (before.endsWith('`') && after.startsWith('`')) push('basename', 'reconcile', start);
            }
        });
    }
    return out;
}

// Files other than `except` that require/import any of `targets` (repo-relative POSIX paths): { file, line, target }.
function findImporters({ root, targets, except = [], files = scanTargets(root) }) {
    const skip = new Set(except);
    const out = [];
    for (const file of files) {
        if (skip.has(file) || targets.includes(file)) continue;
        if (kindOf(file) === 'document') continue;
        const text = readable(root, file);
        if (text === null) continue;
        text.split('\n').forEach((line, index) => {
            SPECIFIER.lastIndex = 0;
            let spec;
            while ((spec = SPECIFIER.exec(line)) !== null) {
                for (const target of targets) {
                    if (resolvesTo(spec[2], file, target)) out.push({ file, line: index + 1, target });
                }
            }
        });
    }
    return out;
}

module.exports = { findPathReferences, findImporters, kindOf, resolvesTo, scanTargets };
