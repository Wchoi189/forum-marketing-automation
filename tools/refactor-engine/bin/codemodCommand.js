'use strict';

// `refactor-engine codemod run|test|list|new`, split from the bin so the bin stays a parser and a dispatch table.
// Arguments were validated by the bin's parseArgs; `prepare`, `withConfig` and `report` are the bin's own.

const fs = require('node:fs');
const path = require('node:path');
const { EXIT, ToolkitError } = require('../core/errors');

async function codemodCommand(parsed, { prepare, withConfig, report }) {
    const [sub, ...rest] = parsed.positionals;
    const codemodCore = require('../core/codemod');
    const reportLines = require('../core/report');
    const o = parsed.options;

    if (sub === 'test') {
        let dirs = rest;
        let root;
        if (dirs.length === 0) {
            // The whole catalog, which is what CI runs: an invalid entry is a usage error, never a skipped codemod.
            const context = withConfig(parsed);
            root = context.root;
            const { loadCatalog } = require('../core/codemodCatalog');
            const catalog = loadCatalog(root, context.config, require('../core/config').defaultReader(root));
            if (catalog.invalid.length > 0) throw new ToolkitError(`codemod test: invalid catalog entries:\n${catalog.invalid.map((i) => `  ${i.dir}  ${i.error}`).join('\n')}`, EXIT.USAGE);
            if (catalog.entries.length === 0) throw new ToolkitError('codemod test: no <codemod-dir> given and the host config\'s "codemods" catalog is empty', EXIT.USAGE);
            dirs = catalog.entries.map((c) => c.dir);
        } else {
            root = prepare(parsed).root;
        }
        const binding = require('../core/grit').loadGrit();
        const results = [];
        for (const dir of dirs) results.push(...(await codemodCore.testCodemod(binding, root, codemodCore.loadCodemod(dir, { root }))));
        const failed = results.filter((r) => !r.ok).length;
        report(parsed, [...reportLines.codemodFixtureLines(results), `codemod test: ${results.length} fixtures, ${failed} failed`], { command: 'codemod test', fixtures: results });
        return failed > 0 ? EXIT.FINDING : EXIT.OK;
    }

    const context = withConfig(parsed);
    if (sub === 'list') {
        const { loadCatalog, listRows } = require('../core/codemodCatalog');
        const { defaultReader } = require('../core/config');
        const catalog = loadCatalog(context.root, context.config, defaultReader(context.root));
        const rows = listRows(context.root, context.config, catalog);
        report(parsed, reportLines.codemodListLines(rows, catalog.invalid), { command: 'codemod list', codemods: rows, invalid: catalog.invalid });
        return catalog.invalid.length > 0 ? EXIT.USAGE : EXIT.OK;
    }
    if (sub === 'new') {
        const { scaffoldCodemod } = require('../core/codemodScaffold');
        const created = scaffoldCodemod({ root: context.root, config: context.config, dirArg: rest[0], ratchet: o.ratchet });
        report(parsed, reportLines.codemodNewLines(created), { command: 'codemod new', ...created });
        return EXIT.OK;
    }

    const codemod = codemodCore.loadCodemod(rest[0], { root: context.root });
    const result = await codemodCore.runCodemod({ root: context.root, config: context.config, baseline: context.baseline, codemod, paths: rest.slice(1), staged: Boolean(o.staged), write: Boolean(o.write) });
    if (o.patch !== undefined) fs.writeFileSync(path.resolve(context.root, o.patch), result.patch);
    if (o.receipt !== undefined && result.written.length > 0) {
        const receipt = codemodCore.buildCodemodReceipt({ codemod, result });
        fs.writeFileSync(path.resolve(context.root, o.receipt), `${JSON.stringify(receipt, null, 2)}\n`);
    }
    const lines = reportLines.codemodRunLines(codemod, result, { write: Boolean(o.write), patchFile: o.patch ?? null, json: parsed.json });
    report(parsed, lines, { command: 'codemod run', codemod: codemod.id, ...result, patch: undefined, receipt: o.receipt ?? null });
    const refused = result.files.some((f) => f.status === 'refused');
    const failedFixture = result.fixtures.some((f) => !f.ok);
    const pending = o.check && result.files.some((f) => f.status === 'changed');
    const residual = result.postconditions.some((pc) => pc.hits.length > 0);
    return failedFixture || refused || pending || residual ? EXIT.FINDING : EXIT.OK;
}

module.exports = { codemodCommand };
