'use strict';

// The split-module facade (contracts/generated-code.md §3 / §4): the source text with every moved span and every
// import only moved code used REMOVED, and one generated block INSERTED after the last kept import binding what
// the kept text reads from each destination and re-exporting (ESM/TS) what a moved declaration exported. The
// original export statement is kept verbatim, so the module object, its keys and their order are unchanged.

const { MARK } = require('./blocks');
const { splice } = require('./classFacade');

// bindings[]: { display, specifier, importNames, importTypeNames, exportNames, exportTypeNames } per destination.
function bindingsBlock({ language, bindings, newline }) {
    const lines = [MARK.importsBegin];
    for (const b of bindings) {
        if (language === 'cjs') {
            lines.push(b.importNames.length > 0 ? `const { ${b.importNames.join(', ')} } = require('${b.specifier}');` : `require('${b.specifier}');`);
            continue;
        }
        const from = language === 'esm' ? b.display : b.specifier;
        const before = lines.length;
        if (b.importNames.length > 0) lines.push(`import { ${b.importNames.join(', ')} } from '${from}';`);
        if (b.importTypeNames.length > 0) lines.push(`import type { ${b.importTypeNames.join(', ')} } from '${from}';`);
        if (b.exportNames.length > 0) lines.push(`export { ${b.exportNames.join(', ')} } from '${from}';`);
        if (b.exportTypeNames.length > 0) lines.push(`export type { ${b.exportTypeNames.join(', ')} } from '${from}';`);
        if (lines.length === before) lines.push(`import '${from}';`);
    }
    lines.push(MARK.partsEnd);
    return lines.join(newline);
}

function emitModuleFacade({ language, text, newline, importsAnchor, removals, bindings }) {
    const blocks = { parts: bindingsBlock({ language, bindings, newline }) };
    const inserts = [{ at: importsAnchor.at, text: importsAnchor.leading + blocks.parts + importsAnchor.trailing }];
    return { text: splice(text, removals, inserts), blocks };
}

module.exports = { emitModuleFacade, bindingsBlock };
