'use strict';

// One parser for every language the toolkit reads: the TypeScript compiler API. It is loaded lazily, so a
// usage error (exit 4) is still reported on a machine where the toolkit was never installed (exit 3).

const path = require('node:path');
const { requireFromToolkit } = require('./deps');

const loadTs = () => requireFromToolkit('typescript');

function scriptKindOf(fileName) {
    const ts = loadTs();
    switch (path.extname(fileName).toLowerCase()) {
        case '.ts':
        case '.mts':
        case '.cts':
            return ts.ScriptKind.TS;
        case '.tsx':
            return ts.ScriptKind.TSX;
        case '.jsx':
            return ts.ScriptKind.JSX;
        default:
            return ts.ScriptKind.JS;
    }
}

function parse(fileName, text) {
    const ts = loadTs();
    return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
}

function hasModuleSyntax(sourceFile) {
    const ts = loadTs();
    return sourceFile.statements.some(
        (st) =>
            ts.isImportDeclaration(st) ||
            ts.isExportDeclaration(st) ||
            ts.isExportAssignment(st) ||
            (ts.canHaveModifiers(st) && (ts.getModifiers(st) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
    );
}

// cjs | esm | ts | tsx. `.mjs` is always ESM and `.cjs` always CommonJS; plain `.js`/`.jsx` is ESM when it has
// top-level module syntax. A package.json "type" is not consulted: the question is how the file is written.
function languageOf(fileName, sourceFile) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.tsx') return 'tsx';
    if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts';
    if (ext === '.mjs') return 'esm';
    if (ext === '.cjs') return 'cjs';
    return hasModuleSyntax(sourceFile) ? 'esm' : 'cjs';
}

// 1-based line of a character position.
function lineOf(sourceFile, pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

// Physical lines as `wc -l` counts them for a file ending in a newline; a final unterminated line counts too.
function physicalLines(text) {
    if (text.length === 0) return 0;
    let count = 0;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count += 1;
    return text.endsWith('\n') ? count : count + 1;
}

module.exports = { loadTs, parse, languageOf, lineOf, physicalLines, scriptKindOf };
