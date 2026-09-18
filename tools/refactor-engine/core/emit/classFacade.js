'use strict';

// The facade is the source text with every moved span REMOVED (with the blank line that preceded it, so blank lines
// never accumulate) and the generated blocks INSERTED. Edits are applied from the end of the file backwards so no
// offset moves under another edit.

const { partsBlockCjs, partsBlockEsm, importsBlockEsm, sharedBlockCjs } = require('./blocks');

// Removal range for a span: the span's lines through their terminating newline, plus one preceding blank line.
function removalRange(text, span) {
    let { start, end } = span;
    if (text[end] === '\r') end += 1;
    if (text[end] === '\n') end += 1;
    let before = start;
    if (text[before - 1] === '\n') {
        before -= 1;
        if (text[before - 1] === '\r') before -= 1;
        if (text[before - 1] === '\n') start = before; // the preceding line is blank: take it
    }
    return { start, end };
}

// removals[]: spans; inserts[]: { at, text }. Two inserts at the same offset keep their given order.
function splice(text, removals, inserts) {
    const edits = [
        ...removals.map((span) => ({ ...removalRange(text, span), text: '' })),
        ...inserts.map((ins, order) => ({ start: ins.at, end: ins.at, text: ins.text, order })),
    ].sort((a, b) => b.start - a.start || (b.order ?? 0) - (a.order ?? 0));
    let out = text;
    for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    // A block inserted at the top of the file, above a removed first statement, is followed by that statement's
    // own blank line as well as the insert's: keep exactly one blank line after a generated block.
    return out.replace(/(\/\/ <<< refactor-engine:\w+ END)(\r?\n)(?:\r?\n){2,}/g, '$1$2$2');
}

// blocks: the generated block texts for the receipt (name → text), and the facade text.
function emitClassFacade({ language, text, indent, newline, host, classEnd, importsAnchor, removals, parts, hasStatic, shared }) {
    const esm = language === 'esm';
    const blocks = {};
    const inserts = [];
    if (esm) {
        blocks.imports = importsBlockEsm({ parts, shared, newline });
        blocks.parts = partsBlockEsm({ host, parts, hasStatic, indent, newline });
        inserts.push({ at: importsAnchor.at, text: importsAnchor.leading + blocks.imports + importsAnchor.trailing });
    } else {
        blocks.parts = partsBlockCjs({ host, parts, hasStatic, indent, newline });
        if (shared && shared.names.length > 0) {
            blocks.shared = sharedBlockCjs({ names: shared.names, specifier: shared.specifier, newline });
            inserts.push({ at: importsAnchor.at, text: importsAnchor.leading + blocks.shared + importsAnchor.trailing });
        }
    }
    inserts.push({ at: classEnd, text: `${newline}${newline}${blocks.parts}` });
    return { text: splice(text, removals, inserts), blocks };
}

module.exports = { emitClassFacade, removalRange, splice };
