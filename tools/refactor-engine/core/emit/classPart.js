'use strict';

// One split-class part (contracts/generated-code.md §1 / §2) and the shared declarations part. Member and declaration
// spans are copied verbatim; only the scaffold around them is generated.

const { partHeader, sharedHeader } = require('./blocks');

// imports[]: { text } already rebased. members[]: { text }. declarations[]: { text }.
function emitClassPart({ language, useStrict, indent, newline, sourceBasename, recipeName, host, hostExport, facadeDisplay, facadeSpecifier, part, base, imports, hostBinding, shared, declarations, members }) {
    const esm = language === 'esm';
    const lines = [];
    if (useStrict && !esm) lines.push("'use strict';", '');
    lines.push(...partHeader({ sourceBasename, recipeName, host, facadeDisplay }));
    for (const imp of imports) lines.push(imp.text);
    if (hostBinding) {
        if (!esm) lines.push(`const ${host} = require('${facadeSpecifier}');`);
        else if (hostExport === 'named') lines.push(`import { ${host} } from '${facadeDisplay}';`);
        else lines.push(`import ${host} from '${facadeDisplay}';`);
    }
    if (shared && shared.names.length > 0) {
        lines.push(esm ? `import { ${shared.names.join(', ')} } from '${shared.display}';` : `const { ${shared.names.join(', ')} } = require('${shared.specifier}');`);
    }
    lines.push('');
    for (const declaration of declarations) lines.push(declaration.text, '');
    const heritage = base ? ` extends ${base}` : '';
    lines.push(`${esm ? 'export default ' : ''}class ${part}${heritage} {`);
    lines.push(members.map((m) => m.text).join(`${newline}${newline}`));
    lines.push('}');
    if (!esm) lines.push('', `module.exports = ${part};`);
    return lines.join(newline) + newline;
}

function emitSharedPart({ language, useStrict, newline, sourceBasename, recipeName, imports, declarations, exportNames }) {
    const esm = language === 'esm';
    const lines = [];
    if (useStrict && !esm) lines.push("'use strict';", '');
    lines.push(...sharedHeader({ sourceBasename, recipeName }));
    for (const imp of imports) lines.push(imp.text);
    lines.push('');
    for (const declaration of declarations) lines.push(declaration.text, '');
    lines.push(esm ? `export { ${exportNames.join(', ')} };` : `module.exports = { ${exportNames.join(', ')} };`);
    return lines.join(newline) + newline;
}

module.exports = { emitClassPart, emitSharedPart };
