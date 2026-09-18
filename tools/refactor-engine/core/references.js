'use strict';

// What one node reaches for (data-model.md §1 members[]): `this.` members, the host class, top-level declarations,
// location-sensitive values, dynamic specifiers, computed `this[expr]` access and #private names. Identifiers are
// resolved through the TypeChecker, so a shadowing local never counts as a reference to a top-level binding and a
// property name never counts as anything. `this` stops binding to the instance inside nested non-arrow functions
// and nested classes.

const LOCATION_GLOBALS = new Set(['__dirname', '__filename']);

function isAssignmentTarget(ts, node) {
    const parent = node.parent;
    if (ts.isBinaryExpression(parent) && parent.left === node) {
        const kind = parent.operatorToken.kind;
        return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
    }
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
        return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
    }
    return false;
}

// Identifier positions that name a property rather than reference a binding.
function isPropertyNamePosition(ts, node) {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
    if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
    if (ts.isImportSpecifier(parent) && parent.propertyName === node) return true;
    if (ts.isExportSpecifier(parent)) {
        // `export { a as b }`: `a` is the local binding, `b` only a name; `export { x } from '…'` names no local at all.
        if (parent.parent.parent.moduleSpecifier) return true;
        return parent.propertyName ? parent.name === node : false;
    }
    if (ts.isQualifiedName(parent) && parent.right === node) return true;
    if (
        (ts.isMethodDeclaration(parent) ||
            ts.isPropertyDeclaration(parent) ||
            ts.isGetAccessor(parent) ||
            ts.isSetAccessor(parent) ||
            ts.isPropertySignature(parent) ||
            ts.isMethodSignature(parent) ||
            ts.isEnumMember(parent)) &&
        parent.name === node
    ) {
        return true;
    }
    return false;
}

function rebindsThis(ts, node) {
    return (
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node) ||
        ts.isConstructorDeclaration(node)
    );
}

const isStringArgument = (ts, arg) => Boolean(arg) && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg));

// `resolve(symbol)` → { kind: 'host' } | { kind: 'declaration', declaration } | null, supplied by the inventory.
function analyze(node, { ts, checker, sourceFile, resolve }) {
    const out = { thisRefs: [], hostRefs: false, topLevelRefs: [], locationSensitive: [], dynamic: [], computedThis: [], privateNames: [] };
    const seen = new Map(); // "<declaration>:<name>" -> the topLevelRefs entry
    const lineOf = (n) => sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile)).line + 1;

    // The binder gives `require` (and other globals in JS files) a synthetic symbol with no declarations.
    const isGlobal = (n) => {
        const symbol = symbolOf(n);
        return !symbol || !symbol.declarations || symbol.declarations.length === 0;
    };

    function symbolOf(n) {
        try {
            if (ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n) return checker.getShorthandAssignmentValueSymbol(n.parent);
            if (ts.isExportSpecifier(n.parent)) return checker.getExportSpecifierLocalTargetSymbol(n.parent);
            return checker.getSymbolAtLocation(n);
        } catch {
            return undefined;
        }
    }

    // A reference is load-time when it sits outside every function body (a top-level initializer, a class
    // `extends`, a static block, a computed key); inside a function body it is call-time (tasks T059).
    (function walk(n, thisIsInstance, inBody) {
        if (n !== node && rebindsThis(ts, n)) thisIsInstance = false;
        if (ts.isFunctionLike(n) && n.body) inBody = true;
        if (n.kind === ts.SyntaxKind.ThisKeyword) {
            const parent = n.parent;
            if (thisIsInstance && ts.isPropertyAccessExpression(parent) && parent.expression === n) {
                const grand = parent.parent;
                out.thisRefs.push({
                    name: parent.name.text,
                    line: lineOf(parent),
                    call: ts.isCallExpression(grand) && grand.expression === parent,
                    write: isAssignmentTarget(ts, parent),
                });
            } else if (thisIsInstance && ts.isElementAccessExpression(parent) && parent.expression === n) {
                out.computedThis.push({ text: parent.getText(sourceFile), line: lineOf(parent) });
            }
        } else if (ts.isPrivateIdentifier(n)) {
            out.privateNames.push({ name: n.text, line: lineOf(n) });
        } else if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
            const parent = n.parent;
            if (ts.isPropertyAccessExpression(parent) && parent.expression === n && ['url', 'dirname', 'filename', 'resolve'].includes(parent.name.text)) {
                out.locationSensitive.push({ text: `import.meta.${parent.name.text}`, line: lineOf(parent) });
            }
        } else if (ts.isCallExpression(n)) {
            const callee = n.expression;
            const arg = n.arguments[0];
            if (ts.isIdentifier(callee) && callee.text === 'require' && isGlobal(callee)) {
                if (!isStringArgument(ts, arg)) out.dynamic.push({ text: n.getText(sourceFile), line: lineOf(n) });
            } else if (callee.kind === ts.SyntaxKind.ImportKeyword) {
                if (!isStringArgument(ts, arg)) out.dynamic.push({ text: n.getText(sourceFile), line: lineOf(n) });
            } else if (
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === 'require' &&
                callee.name.text === 'resolve' &&
                isGlobal(callee.expression)
            ) {
                if (isStringArgument(ts, arg) && arg.text.startsWith('.')) out.locationSensitive.push({ text: n.getText(sourceFile), line: lineOf(n) });
                else if (!isStringArgument(ts, arg)) out.dynamic.push({ text: n.getText(sourceFile), line: lineOf(n) });
            }
        } else if (ts.isIdentifier(n) && !isPropertyNamePosition(ts, n)) {
            const symbol = symbolOf(n);
            if (LOCATION_GLOBALS.has(n.text) && isGlobal(n)) {
                out.locationSensitive.push({ text: n.text, line: lineOf(n) });
            } else if (symbol) {
                const target = resolve(symbol);
                if (target && target.kind === 'host') out.hostRefs = true;
                else if (target && target.kind === 'declaration') {
                    const key = `${target.declaration.index}:${n.text}`;
                    if (!seen.has(key)) {
                        const ref = { name: n.text, declaration: target.declaration.index, line: lineOf(n), loadTime: !inBody };
                        seen.set(key, ref);
                        out.topLevelRefs.push(ref);
                    } else if (!inBody) seen.get(key).loadTime = true;
                }
            }
        }
        ts.forEachChild(n, (child) => walk(child, thisIsInstance, inBody));
    })(node, true, false);

    return out;
}

module.exports = { analyze, isAssignmentTarget, isPropertyNamePosition };
