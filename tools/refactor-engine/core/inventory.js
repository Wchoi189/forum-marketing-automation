'use strict';

// Inventory of one source file (data-model.md §1): top-level declarations, classes with their members and post-class
// statements, every span measured from the node's full start with leading blank lines trimmed and leading comments
// kept, and the references of each piece resolved through a single-file TypeScript program's TypeChecker.

const path = require('node:path');
const crypto = require('node:crypto');
const { loadTs, parse, languageOf, lineOf, physicalLines } = require('./parser');
const { blobHash } = require('./repo');
const { analyze, isAssignmentTarget } = require('./references');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function createChecker(fileName, text) {
    const ts = loadTs();
    const sourceFile = parse(fileName, text);
    const host = {
        getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => '',
        getDirectories: () => [],
        fileExists: (name) => name === fileName,
        readFile: (name) => (name === fileName ? text : undefined),
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
    };
    const program = ts.createProgram([fileName], { allowJs: true, checkJs: false, noResolve: true, noLib: true, target: ts.ScriptTarget.Latest }, host);
    return { ts, sourceFile, checker: program.getTypeChecker() };
}

const lineStartOf = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;

// Leading comments kept, leading blank lines trimmed; `comments: false` starts at the node's own line (imports, so
// a file header comment never travels with the first carried require); `trailingSemicolon` swallows a `;` that
// directly follows a member.
function spanOf(ts, sourceFile, text, node, { comments = true, trailingSemicolon = false } = {}) {
    const fullStart = node.getFullStart();
    let start = lineStartOf(text, node.getStart(sourceFile));
    if (comments) {
        // Only the comment block contiguous with the node: a blank line ends it, so a section header (or a
        // generated file header) above a blank line never travels with the member below it.
        const ranges = ts.getLeadingCommentRanges(text, fullStart) || [];
        let first = null;
        let boundary = node.getStart(sourceFile);
        for (let i = ranges.length - 1; i >= 0; i -= 1) {
            if (/\n[ \t]*\r?\n/.test(text.slice(ranges[i].end, boundary))) break;
            first = ranges[i];
            boundary = first.pos;
        }
        if (first) start = lineStartOf(text, first.pos);
    }
    start = Math.max(start, fullStart);
    let end = node.end;
    if (trailingSemicolon && text[end] === ';') end += 1;
    return { start, end, startLine: lineOf(sourceFile, start), endLine: lineOf(sourceFile, Math.max(start, end - 1)) };
}

function bindingNames(ts, name, out = []) {
    if (ts.isIdentifier(name)) out.push(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        for (const element of name.elements) if (ts.isBindingElement(element)) bindingNames(ts, element.name, out);
    }
    return out;
}

function isRequireCall(ts, node) {
    let n = node;
    while (ts.isPropertyAccessExpression(n)) n = n.expression;
    if (!ts.isCallExpression(n)) return false;
    const callee = n.expression;
    const requireLike = (ts.isIdentifier(callee) && callee.text === 'require') || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'require');
    return requireLike && n.arguments.length === 1 && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]));
}

// A call or `new` evaluated when the module loads: outside every function body, not require(<literal>), and
// not a call `isPureCall` vouches for (a `path.*` method on a binding imported from the path module).
function hasLoadTimeCall(ts, node, isPureCall = () => false) {
    let found = false;
    (function walk(n) {
        if (found) return;
        if (ts.isFunctionLike(n) && n.body) return;
        if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && !isRequireCall(ts, n) && !isPureCall(n)) {
            found = true;
            return;
        }
        ts.forEachChild(n, walk);
    })(node);
    return found;
}

// Modules whose every exported function is a pure string computation: a load-time `path.join(__dirname, …)` is
// the R4 case, and refusing it as a side effect would refuse every `__dirname`-relative constant.
const PURE_MODULES = new Set(['path', 'node:path', 'path/posix', 'path/win32', 'node:path/posix', 'node:path/win32']);

function specifierOf(ts, statement) {
    if (ts.isImportDeclaration(statement)) return ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
    if (!ts.isVariableStatement(statement)) return null;
    for (const d of statement.declarationList.declarations) {
        let n = d.initializer;
        while (n && ts.isPropertyAccessExpression(n)) n = n.expression;
        if (n && ts.isCallExpression(n) && n.arguments.length === 1) return n.arguments[0].text;
    }
    return null;
}

function importNames(ts, statement) {
    const names = [];
    const clause = statement.importClause;
    if (!clause) return names;
    if (clause.name) names.push(clause.name.text);
    if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
        else for (const element of clause.namedBindings.elements) names.push(element.name.text);
    }
    return names;
}

function isDirective(ts, statement) {
    return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
}

function hasModifier(ts, node, kind) {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) || []).some((m) => m.kind === kind);
}

function classifyStatement(ts, statement) {
    if (ts.isImportDeclaration(statement)) return { kind: 'import', names: importNames(ts, statement) };
    if (ts.isVariableStatement(statement)) {
        const declarations = statement.declarationList.declarations;
        const names = declarations.flatMap((d) => bindingNames(ts, d.name));
        const allRequire = declarations.every((d) => d.initializer && isRequireCall(ts, d.initializer));
        if (allRequire) return { kind: 'require', names };
        const flags = statement.declarationList.flags;
        const kind = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
        return { kind, names };
    }
    if (ts.isFunctionDeclaration(statement)) return { kind: 'function', names: statement.name ? [statement.name.text] : [] };
    if (ts.isClassDeclaration(statement)) return { kind: 'class', names: statement.name ? [statement.name.text] : [] };
    if (ts.isInterfaceDeclaration(statement)) return { kind: 'interface', names: [statement.name.text] };
    if (ts.isTypeAliasDeclaration(statement)) return { kind: 'type', names: [statement.name.text] };
    if (ts.isEnumDeclaration(statement)) return { kind: 'enum', names: [statement.name.text] };
    return { kind: 'statement', names: [] };
}

const TYPE_ONLY = new Set(['interface', 'type']);

// The module's export surface (tasks T060 V-3): CommonJS `module.exports = { … }` keys in order plus `exports.x`
// names; ESM named exports (modifier, `export { a as b }`, `export { x } from`) and whether there is a default.
// `names` is null when the surface cannot be read statically (a spread, `export * from`, `module.exports = expr`).
function moduleExportsOf(ts, sourceFile) {
    const names = [];
    let complete = true;
    let hasDefault = false;
    for (const statement of sourceFile.statements) {
        if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const { left, right } = statement.expression;
            const target = left.getText(sourceFile);
            if (target === 'module.exports') {
                names.length = 0;
                if (!ts.isObjectLiteralExpression(right)) complete = false;
                else {
                    for (const property of right.properties) {
                        if (ts.isSpreadAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) complete = false;
                        else names.push(property.name.text);
                    }
                }
            } else {
                const match = target.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/);
                if (match && !names.includes(match[1])) names.push(match[1]);
            }
        } else if (ts.isExportAssignment(statement)) hasDefault = true;
        else if (ts.isExportDeclaration(statement)) {
            if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) complete = false;
            else for (const element of statement.exportClause.elements) names.push(element.name.text);
        } else if (ts.canHaveModifiers(statement) && hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword)) {
            if (hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword)) hasDefault = true;
            else names.push(...classifyStatement(ts, statement).names);
        }
    }
    return { names: complete ? names : null, hasDefault };
}

function memberName(ts, member) {
    if (ts.isConstructorDeclaration(member)) return 'constructor';
    const name = member.name;
    if (!name) return '(anonymous)';
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return `[${name.getText()}]`;
}

function memberKind(ts, member) {
    if (ts.isConstructorDeclaration(member)) return 'constructor';
    if (ts.isGetAccessor(member)) return 'get';
    if (ts.isSetAccessor(member)) return 'set';
    if (ts.isPropertyDeclaration(member)) return 'field';
    if (ts.isMethodDeclaration(member)) return 'method';
    return 'other';
}

function detectIndent(text) {
    const match = text.match(/^(\t+| +)\S/m);
    return match ? match[1] : '    ';
}

// CommonJS: `module.exports = X` / `module.exports = { … }` / `exports.x = …`. ESM: default and named exports.
function exportShapeOf(ts, sourceFile, checker, classNodes) {
    const kinds = new Set();
    let exportedClass = null;
    let hostExport = null;
    const classOf = (expr) => {
        if (ts.isClassExpression(expr) && expr.name) return expr.name.text;
        if (!ts.isIdentifier(expr)) return null;
        const symbol = checker.getSymbolAtLocation(expr);
        const declaration = symbol && symbol.declarations && symbol.declarations[0];
        return declaration && classNodes.has(declaration) ? expr.text : null;
    };
    for (const statement of sourceFile.statements) {
        if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const { left, right } = statement.expression;
            const text = left.getText(sourceFile);
            if (text === 'module.exports') {
                const cls = classOf(right);
                if (cls) {
                    kinds.add('class');
                    exportedClass = cls;
                    hostExport = 'module.exports';
                } else kinds.add(ts.isObjectLiteralExpression(right) ? 'object' : 'other');
            } else if (/^(module\.)?exports\.[A-Za-z_$][\w$]*$/.test(text)) kinds.add('named');
        } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
            const cls = classOf(statement.expression);
            if (cls) {
                kinds.add('class');
                exportedClass = cls;
                hostExport = 'default';
            } else kinds.add('other');
        } else if (ts.isClassDeclaration(statement) && hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
            if (hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword)) {
                kinds.add('class');
                exportedClass = statement.name.text;
                hostExport = 'default';
            } else {
                kinds.add('named');
                if (!exportedClass) {
                    exportedClass = statement.name.text;
                    hostExport = 'named';
                }
            }
        } else if (ts.isExportDeclaration(statement)) {
            kinds.add('named');
            if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                for (const element of statement.exportClause.elements) {
                    const local = element.propertyName || element.name;
                    const cls = classOf(local);
                    if (cls && element.name.text === 'default') {
                        kinds.add('class');
                        exportedClass = cls;
                        hostExport = 'default';
                    } else if (cls && !exportedClass) {
                        exportedClass = cls;
                        hostExport = 'named';
                    }
                }
            }
        } else if (ts.canHaveModifiers(statement) && hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword)) {
            kinds.add('named');
        }
    }
    let exportShape = 'none';
    if (kinds.size === 1) exportShape = [...kinds][0];
    else if (kinds.size > 1) exportShape = 'mixed';
    return { exportShape, exportedClass, hostExport };
}

// Inventory of `text` parsed as `fileName`. Hashing is the caller's business (see inventoryFile).
function inventoryText(fileName, text) {
    const { ts, sourceFile, checker } = createChecker(fileName, text);
    const statements = sourceFile.statements;
    const classNodes = new Set(statements.filter((s) => ts.isClassDeclaration(s) && s.name));
    const { exportShape, exportedClass, hostExport } = exportShapeOf(ts, sourceFile, checker, classNodes);

    // Declaration records, one per top-level statement, indexed by statement position.
    const byStatement = new Map();
    const declarations = statements.map((statement, index) => {
        const { kind, names } = classifyStatement(ts, statement);
        const directive = isDirective(ts, statement);
        const isImport = kind === 'import' || kind === 'require';
        const record = {
            index,
            names,
            kind,
            directive,
            span: spanOf(ts, sourceFile, text, statement, { comments: !isImport && !directive }),
            reassigned: false,
            sideEffect: false,
            specifier: isImport ? specifierOf(ts, statement) : null,
            typeOnly: TYPE_ONLY.has(kind),
            exported: ts.canHaveModifiers(statement) && hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword) && !hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword),
        };
        record.lines = record.span.endLine - record.span.startLine + 1;
        byStatement.set(statement, record);
        return record;
    });
    const moduleExports = moduleExportsOf(ts, sourceFile);

    const topStatementOf = (node) => {
        let n = node;
        while (n.parent && n.parent !== sourceFile) n = n.parent;
        return n;
    };
    const makeResolver = (hostNode) => (symbol) => {
        const declaration = symbol.declarations && symbol.declarations[0];
        if (!declaration) return null;
        const statement = topStatementOf(declaration);
        if (hostNode && statement === hostNode) return declaration === hostNode ? { kind: 'host' } : null;
        const record = byStatement.get(statement);
        if (!record || !record.names.includes(symbol.name)) return null;
        if (declaration === statement && ts.isClassDeclaration(statement)) return { kind: 'declaration', declaration: record };
        return { kind: 'declaration', declaration: record };
    };

    // Reassignment: any assignment or update anywhere in the file whose target resolves to a top-level binding.
    const resolveAny = makeResolver(null);
    const isPureCall = (call) => {
        const callee = call.expression;
        if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
        let symbol;
        try {
            symbol = checker.getSymbolAtLocation(callee.expression);
        } catch {
            return false;
        }
        const target = symbol && resolveAny(symbol);
        return Boolean(target && target.kind === 'declaration' && PURE_MODULES.has(target.declaration.specifier));
    };
    for (const record of declarations) {
        const statement = statements[record.index];
        if (record.directive || record.kind === 'import' || record.kind === 'require') continue;
        record.sideEffect = record.kind === 'statement' ? !isPureStatement(ts, statement, isPureCall) : hasLoadTimeCall(ts, statement, isPureCall);
    }
    (function walk(n) {
        if (ts.isIdentifier(n) && isAssignmentTarget(ts, n)) {
            let symbol;
            try {
                symbol = checker.getSymbolAtLocation(n);
            } catch {
                symbol = undefined;
            }
            const target = symbol && resolveAny(symbol);
            if (target && target.kind === 'declaration') target.declaration.reassigned = true;
        }
        ts.forEachChild(n, walk);
    })(sourceFile);

    const hostNode = exportedClass ? statements.find((s) => ts.isClassDeclaration(s) && s.name && s.name.text === exportedClass) : null;
    const context = { ts, checker, sourceFile, resolve: makeResolver(hostNode) };

    for (const record of declarations) {
        const refs = analyze(statements[record.index], context);
        refs.topLevelRefs = refs.topLevelRefs.filter((ref) => ref.declaration !== record.index);
        Object.assign(record, refs);
    }

    const classes = [];
    for (const statement of statements) {
        if (!classNodes.has(statement)) continue;
        const ownContext = statement === hostNode ? context : { ...context, resolve: makeResolver(statement) };
        const heritage = (statement.heritageClauses || []).find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
        const base = heritage ? heritage.types[0].expression.getText(sourceFile) : null;
        const baseRefs = heritage ? analyze(heritage, ownContext) : null;
        const members = statement.members
            .filter((member) => !ts.isSemicolonClassElement(member))
            .map((member, index) => {
                const span = spanOf(ts, sourceFile, text, member, { trailingSemicolon: true });
                return {
                    index,
                    name: memberName(ts, member),
                    kind: memberKind(ts, member),
                    static: hasModifier(ts, member, ts.SyntaxKind.StaticKeyword),
                    private: Boolean(member.name && ts.isPrivateIdentifier(member.name)),
                    span,
                    lines: span.endLine - span.startLine + 1,
                    ...analyze(member, ownContext),
                };
            });
        const classIndex = byStatement.get(statement).index;
        const postStatements = declarations.filter((d) => d.index > classIndex && d.kind === 'statement' && !d.directive && d.hostRefs && statement === hostNode).map((d) => d.index);
        classes.push({
            name: statement.name.text,
            index: classIndex,
            base,
            baseRefs: baseRefs ? baseRefs.topLevelRefs : [],
            exported: statement === hostNode,
            span: spanOf(ts, sourceFile, text, statement),
            bodyEnd: statement.end,
            members,
            postStatements,
        });
    }

    const inventory = {
        file: fileName,
        language: languageOf(fileName, sourceFile),
        lines: physicalLines(text),
        useStrict: statements.length > 0 && isDirective(ts, statements[0]) && statements[0].expression.text === 'use strict',
        indent: detectIndent(text),
        newline: text.includes('\r\n') ? '\r\n' : '\n',
        exportShape,
        exportedClass,
        hostExport,
        moduleExports,
        declarations,
        classes,
    };
    return { inventory, text, sourceFile, ts, checker };
}

// A top-level non-declaration statement is pure only when it is an assignment with no load-time call (e.g.
// `module.exports = Host`, `Host.toMinor = (n) => …`); anything else (if, for, a bare call) is a side effect.
function isPureStatement(ts, statement, isPureCall) {
    if (ts.isExportDeclaration(statement)) return true;
    if (ts.isExportAssignment(statement)) return !hasLoadTimeCall(ts, statement.expression, isPureCall);
    if (!ts.isExpressionStatement(statement)) return false;
    const expression = statement.expression;
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    return !hasLoadTimeCall(ts, expression, isPureCall);
}

function inventoryFile(root, relPath, text) {
    const result = inventoryText(relPath, text);
    result.inventory.sourceHash = blobHash(root, relPath);
    result.inventory.bytes = Buffer.byteLength(text);
    return result;
}

// The JSON form printed by `inventory --json` (functions and AST nodes stripped by construction).
function toJson(inventory, affinity = null) {
    const declaration = (d) => ({ index: d.index, names: d.names, kind: d.kind, span: d.span, lines: d.lines, reassigned: d.reassigned, sideEffect: d.sideEffect, exported: d.exported, topLevelRefs: d.topLevelRefs.map((r) => r.name), loadTimeRefs: d.topLevelRefs.filter((r) => r.loadTime).map((r) => r.name), hostRefs: d.hostRefs, locationSensitive: d.locationSensitive });
    const member = (m) => ({
        name: m.name, kind: m.kind, static: m.static, private: m.private, span: m.span, lines: m.lines,
        thisRefs: [...new Set(m.thisRefs.map((r) => r.name))], hostRefs: m.hostRefs, topLevelRefs: m.topLevelRefs.map((r) => r.name),
        locationSensitive: m.locationSensitive, dynamic: m.dynamic, computedThis: m.computedThis, privateNames: m.privateNames.map((p) => p.name),
    });
    return {
        file: inventory.file,
        language: inventory.language,
        sourceHash: inventory.sourceHash,
        lines: inventory.lines,
        exportShape: inventory.exportShape,
        exportedClass: inventory.exportedClass,
        moduleExports: inventory.moduleExports,
        declarations: inventory.declarations.filter((d) => !d.directive).map(declaration),
        classes: inventory.classes.map((c) => ({ name: c.name, base: c.base, exported: c.exported, members: c.members.map(member), postStatements: c.postStatements.map((i) => inventory.declarations[i].span.startLine) })),
        ...(affinity ? { affinity } : {}),
    };
}

const spanText = (text, span) => text.slice(span.start, span.end);

module.exports = { inventoryText, inventoryFile, toJson, spanOf, spanText, sha256, createChecker };
