'use strict';

// Per-file metrics for the ratchet (data-model.md §5): physical lines, the longest OUTERMOST function-like,
// and one integer per pattern rule that admits the path. A file that does not parse still reports its lines
// and pattern counts, with `maxFunction: null` and a warning — never a crash, never a silent zero.

const path = require('node:path');
const { requireFromToolkit } = require('./deps');
const { loadTs, parse, lineOf, physicalLines } = require('./parser');
const { patternApplies } = require('./scope');
const { AST_GREP_LANGUAGES } = require('./config');

// Name as fnsizes measured it: the node's own name, else the variable it is assigned to, else (anon).
function functionName(ts, node) {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (node.name) return node.name.getText();
    if (node.parent && ts.isVariableDeclaration(node.parent)) return node.parent.name.getText();
    return '(anon)';
}

// Longest function-like with a body that has no enclosing function-like; class methods are outermost.
function longestOutermostFunction(fileName, text) {
    const ts = loadTs();
    const sourceFile = parse(fileName, text);
    let longest = null;
    (function walk(node, insideFunction) {
        const isFunction = ts.isFunctionLike(node) && Boolean(node.body);
        if (isFunction && !insideFunction) {
            const start = lineOf(sourceFile, node.getStart());
            const lines = lineOf(sourceFile, node.end) - start + 1;
            if (longest === null || lines > longest.lines) longest = { lines, name: functionName(ts, node), line: start };
        }
        ts.forEachChild(node, (child) => walk(child, insideFunction || isFunction));
    })(sourceFile, false);
    return longest;
}

function countRegex(source, text) {
    const regex = new RegExp(source, 'g');
    let count = 0;
    for (const line of text.split('\n')) count += (line.match(regex) || []).length;
    return count;
}

function astGrepLanguageOf(fileName) {
    switch (path.extname(fileName).toLowerCase()) {
        case '.ts':
        case '.mts':
        case '.cts':
            return 'typescript';
        case '.tsx':
            return 'tsx';
        default:
            return 'javascript';
    }
}

// `relPath` is the path the rules' include/exclude are matched against; `fileName` only decides the parser.
function measure(relPath, text, config) {
    const warnings = [];
    const lines = physicalLines(text);

    let maxFunction = null;
    try {
        maxFunction = longestOutermostFunction(relPath, text);
    } catch (error) {
        warnings.push(`${relPath}: could not parse for function length (${error.message}); maxFunction not measured`);
    }

    const patterns = {};
    const roots = new Map(); // ast-grep language -> parsed root, one parse per language however many rules share it
    for (const rule of config.patterns) {
        if (!patternApplies(relPath, rule)) continue;
        if (rule.kind === 'regex') {
            patterns[rule.id] = countRegex(rule.regex, text);
            continue;
        }
        const language = rule.language ?? astGrepLanguageOf(relPath);
        try {
            if (!roots.has(language)) {
                const napi = requireFromToolkit('@ast-grep/napi');
                roots.set(language, napi.parse(napi.Lang[AST_GREP_LANGUAGES[language]], text).root());
            }
            patterns[rule.id] = roots.get(language).findAll(rule.rule).length;
        } catch (error) {
            if (error && error.exitCode !== undefined) throw error; // a missing dependency is exit 3, not a warning
            warnings.push(`${relPath}: pattern ${rule.id} could not be evaluated (${error.message}); counted as 0`);
            patterns[rule.id] = 0;
        }
    }

    return { lines, maxFunction, patterns, warnings };
}

module.exports = { measure, astGrepLanguageOf };
