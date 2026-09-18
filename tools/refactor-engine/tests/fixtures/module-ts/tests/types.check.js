'use strict';

// Compiles every .ts file under src/ with the toolkit's TypeScript (linked into node_modules by the test) under
// isolatedModules + noEmit and fails on any diagnostic: type-only names must be re-exported with `export type`.

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.name.endsWith('.ts')) yield full;
    }
}

const files = [...walk(path.join(__dirname, '..', 'src'))].sort();
const program = ts.createProgram(files, {
    isolatedModules: true,
    noEmit: true,
    strict: true,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ES2020,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
    process.exit(1);
}
console.log(`types.check: ok (${files.length} files)`);
